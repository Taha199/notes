import { randomUUID } from 'node:crypto';
import {
  FB_DB_URL,
  STORAGE_BUCKET,
  getGoogleAccessToken,
  isAllowedOrigin,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
  writeRtdb,
} from './lib/firebaseAdmin.js';

const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** Read a node, distinguishing "empty" (null, ok) from a real failure (throws). */
async function readNodeStrict(accessToken, path) {
  const url = `${FB_DB_URL}${path}.json?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rtdb-read-failed:${res.status}`);
  return res.json();
}
// Cap server-side migrations per request so the function never times out.
const MAX_MIGRATIONS_PER_CALL = 40;

function normalizeList(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter((x) => x && typeof x === 'object' && 'id' in x);
  if (typeof data === 'object') return Object.values(data).filter((x) => x && typeof x === 'object' && 'id' in x);
  return [];
}

function stripBlob(file) {
  const { dataUrl, ...rest } = file;
  void dataUrl;
  return rest;
}

function dataUrlToBuffer(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const meta = comma === -1 ? '' : dataUrl.slice(5, comma);
  const payload = comma === -1 ? '' : dataUrl.slice(comma + 1);
  const contentType = meta.split(';')[0] || 'application/octet-stream';
  const isBase64 = /;base64/i.test(meta);
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { buffer, contentType };
}

async function uploadToStorage(storageToken, objectPath, buffer, contentType) {
  const token = randomUUID();
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${storageToken}`, 'Content-Type': contentType || 'application/octet-stream' },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error('storage-upload-failed');
  // Attach a Firebase download token so the client can fetch it like a normal upload.
  const patchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${storageToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType, metadata: { firebaseStorageDownloadTokens: token } }),
  });
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method-not-allowed' });
  }
  if (!isAllowedOrigin(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }
  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const account = idToken ? await verifyUser(idToken) : null;
  if (!account) return response.status(403).json({ error: 'forbidden' });

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const [dbToken, storageToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
    ]);

    const uid = account.uid;
    // Throw on real read failures so the client falls back to a direct DB read.
    const [filesRaw, foldersRaw] = await Promise.all([
      readNodeStrict(dbToken, `/users/${uid}/files`),
      readNodeStrict(dbToken, `/users/${uid}/fileFolders`),
    ]);
    const files = normalizeList(filesRaw);
    const folders = normalizeList(foldersRaw);

    // Migrate legacy inline (base64) files to Storage so future loads stay light.
    let migrated = 0;
    const out = [];
    for (const file of files) {
      if (file.dataUrl && !file.downloadUrl && migrated < MAX_MIGRATIONS_PER_CALL) {
        try {
          const { buffer, contentType } = dataUrlToBuffer(file.dataUrl);
          const objectPath = file.storagePath || `users/${uid}/files/${file.id}/${file.name}`;
          const downloadUrl = await uploadToStorage(storageToken, objectPath, buffer, contentType || file.type);
          const clean = { ...stripBlob(file), downloadUrl, storagePath: objectPath };
          const ok = await writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, clean);
          if (ok) {
            migrated += 1;
            out.push(clean);
            continue;
          }
        } catch {
          /* fall through: keep the file usable via inline dataUrl this round */
        }
      }
      // Never ship base64 blobs to the browser; keep a marker so the client knows it's inline.
      if (file.dataUrl && !file.downloadUrl) {
        out.push({ ...stripBlob(file), inlinePending: true });
      } else {
        out.push(stripBlob(file));
      }
    }

    return response.status(200).json({ files: out, folders, migratedRemaining: migrated >= MAX_MIGRATIONS_PER_CALL });
  } catch (error) {
    console.error('my-files failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
