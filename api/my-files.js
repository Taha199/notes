import {
  FB_DB_URL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
  writeRtdb,
} from './_lib/firebaseAdmin.js';
import {
  STORAGE_SCOPE,
  resolveStoragePath,
  storagePathFromDownloadUrl,
  uploadToStorage,
} from './_lib/storageFiles.js';

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

/** Always expose a usable storagePath so the client SDK can getBytes. */
function toClientFile(file, uid) {
  const stripped = stripBlob(file);
  const storagePath = resolveStoragePath(stripped, uid)
    || (stripped.downloadUrl ? storagePathFromDownloadUrl(stripped.downloadUrl) : undefined);
  return storagePath ? { ...stripped, storagePath } : stripped;
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
          const objectPath = resolveStoragePath(file, uid) || `users/${uid}/files/${file.id}/${file.name}`;
          const downloadUrl = await uploadToStorage(storageToken, objectPath, buffer, contentType || file.type);
          const clean = { ...stripBlob(file), downloadUrl, storagePath: objectPath };
          const ok = await writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, clean);
          if (ok) {
            migrated += 1;
            out.push(toClientFile(clean, uid));
            continue;
          }
        } catch {
          /* fall through: keep the file usable via inline dataUrl this round */
        }
      }
      // Never ship base64 blobs to the browser; keep a marker so the client knows it's inline.
      if (file.dataUrl && !file.downloadUrl) {
        out.push({ ...toClientFile(file, uid), inlinePending: true });
      } else {
        out.push(toClientFile(file, uid));
      }
    }

    return response.status(200).json({ files: out, folders, migratedRemaining: migrated >= MAX_MIGRATIONS_PER_CALL });
  } catch (error) {
    console.error('my-files failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
