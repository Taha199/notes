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
  resolveDownloadUrl,
  resolveStoragePath,
  safeStorageFileName,
  storagePathFromDownloadUrl,
  uploadToStorage,
  STORAGE_SCOPE,
} from './_lib/storageFiles.js';

/** Read a node, distinguishing "empty" (null, ok) from a real failure (throws). */
async function readNodeStrict(accessToken, path) {
  const url = `${FB_DB_URL}${path}.json?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rtdb-read-failed:${res.status}`);
  return res.json();
}

/**
 * Background migrate only — keep each call small so Hobby functions stay under
 * the time limit. List requests must NEVER wait on these uploads.
 */
const MAX_MIGRATIONS_PER_CALL = 5;

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

/** Always expose a usable storagePath so the client SDK can getBlob / download. */
function toClientFile(file, uid) {
  const stripped = stripBlob(file);
  const storagePath = resolveStoragePath(stripped, uid)
    || (stripped.downloadUrl ? storagePathFromDownloadUrl(stripped.downloadUrl) : undefined)
    || (uid && stripped.id && stripped.name
      ? `users/${uid}/files/${stripped.id}/${safeStorageFileName(stripped.name)}`
      : undefined);
  return storagePath ? { ...stripped, storagePath } : stripped;
}

function toListEntry(file, uid) {
  // Never ship base64 blobs to the browser — that hung Chrome on /files.
  if (file.dataUrl && !file.downloadUrl) {
    return { ...toClientFile(file, uid), inlinePending: true };
  }
  return toClientFile(file, uid);
}

/** Ensure every Storage-backed row has a working downloadUrl; persist when minted. */
async function enrichFileUrls(files, uid, storageToken, dbToken) {
  return Promise.all(
    files.map(async (file) => {
      const entry = toListEntry(file, uid);
      const path = resolveStoragePath(entry, uid)
        || (entry.storagePath ? entry.storagePath : undefined);
      if (entry.downloadUrl && entry.storagePath) return entry;
      if (!path || !storageToken) return entry;
      try {
        const { downloadUrl } = await resolveDownloadUrl(
          storageToken,
          path,
          file.type || 'application/octet-stream',
          !entry.downloadUrl,
        );
        const enriched = { ...entry, downloadUrl, storagePath: path };
        if (dbToken && downloadUrl && downloadUrl !== file.downloadUrl) {
          await writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, {
            ...stripBlob(file),
            downloadUrl,
            storagePath: path,
          });
        }
        return enriched;
      } catch {
        return entry;
      }
    }),
  );
}

async function migrateLegacyBatch(files, uid, dbToken, storageToken) {
  let migrated = 0;
  const updatedById = new Map();
  for (const file of files) {
    if (!(file.dataUrl && !file.downloadUrl) || migrated >= MAX_MIGRATIONS_PER_CALL) continue;
    try {
      const { buffer, contentType } = dataUrlToBuffer(file.dataUrl);
      const objectPath = resolveStoragePath(file, uid)
        || `users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`;
      const downloadUrl = await uploadToStorage(storageToken, objectPath, buffer, contentType || file.type);
      const clean = { ...stripBlob(file), downloadUrl, storagePath: objectPath };
      const ok = await writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, clean);
      if (ok) {
        migrated += 1;
        updatedById.set(file.id, clean);
      }
    } catch {
      /* keep legacy inline for a later pass */
    }
  }
  const remaining = files.some((file) => {
    if (updatedById.has(file.id)) return false;
    return !!(file.dataUrl && !file.downloadUrl);
  });
  return { migrated, updatedById, remaining };
}

function allowOrigin(origin) {
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return isAllowedOrigin(origin) || localDev;
}

export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    return response.status(204).end();
  }
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS');
    return response.status(405).json({ error: 'method-not-allowed' });
  }
  if (!allowOrigin(origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const account = idToken ? await verifyUser(idToken) : null;
  if (!account) return response.status(403).json({ error: 'forbidden' });

  const doMigrate = String(request.query?.migrate || '') === '1';

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const uid = account.uid;

    // Fast list: metadata only + fresh download URLs when missing.
    if (!doMigrate) {
      const [dbToken, storageToken] = await Promise.all([
        getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
        getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
      ]);
      const [filesRaw, foldersRaw] = await Promise.all([
        readNodeStrict(dbToken, `/users/${uid}/files`),
        readNodeStrict(dbToken, `/users/${uid}/fileFolders`),
      ]);
      const files = normalizeList(filesRaw);
      const folders = normalizeList(foldersRaw);
      const out = await enrichFileUrls(files, uid, storageToken, dbToken);
      const migratedRemaining = files.some((f) => f.dataUrl && !f.downloadUrl);
      return response.status(200).json({ files: out, folders, migratedRemaining });
    }

    // Background migrate: small batches after the list has already painted.
    const [dbToken, storageToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
    ]);
    const [filesRaw, foldersRaw] = await Promise.all([
      readNodeStrict(dbToken, `/users/${uid}/files`),
      readNodeStrict(dbToken, `/users/${uid}/fileFolders`),
    ]);
    const files = normalizeList(filesRaw);
    const folders = normalizeList(foldersRaw);
    const { updatedById, remaining } = await migrateLegacyBatch(files, uid, dbToken, storageToken);
    const merged = files.map((file) => updatedById.get(file.id) || file);
    const out = await enrichFileUrls(merged, uid, storageToken, dbToken);
    return response.status(200).json({ files: out, folders, migratedRemaining: remaining });
  } catch (error) {
    console.error('my-files failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
