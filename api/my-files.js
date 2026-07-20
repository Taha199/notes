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
  dataUrlToBuffer,
  resolveStoragePath,
  safeStorageFileName,
  storagePathFromDownloadUrl,
  uploadToStorage,
} from './_lib/storageFiles.js';

const MAX_MIGRATIONS_PER_CALL = 5;

async function readNodeStrict(accessToken, path) {
  const url = `${FB_DB_URL}${path}.json?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`rtdb-read-failed:${res.status}`);
  return res.json();
}

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

function allowOrigin(origin) {
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return isAllowedOrigin(origin) || localDev;
}

/** Always expose a usable storagePath; never ship base64 blobs to the browser. */
function toListEntry(file, uid) {
  const stripped = stripBlob(file);
  const storagePath = resolveStoragePath(stripped, uid)
    || (stripped.downloadUrl ? storagePathFromDownloadUrl(stripped.downloadUrl) : undefined)
    || (uid && stripped.id && stripped.name
      ? `users/${uid}/files/${stripped.id}/${safeStorageFileName(stripped.name)}`
      : undefined);
  const base = storagePath ? { ...stripped, storagePath } : stripped;
  if (file.dataUrl && !file.downloadUrl) {
    return { ...base, inlinePending: true };
  }
  return base;
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
      if (await writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, clean)) {
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
  return { updatedById, remaining };
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
  if (!allowOrigin(origin)) return response.status(403).json({ error: 'forbidden' });
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const account = idToken ? await verifyUser(idToken) : null;
  if (!account) return response.status(403).json({ error: 'forbidden' });

  const doMigrate = String(request.query?.migrate || '') === '1';

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const uid = account.uid;

    // Fast list: metadata only — never block the UI on Storage uploads.
    if (!doMigrate) {
      const dbToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
      const [filesRaw, foldersRaw] = await Promise.all([
        readNodeStrict(dbToken, `/users/${uid}/files`),
        readNodeStrict(dbToken, `/users/${uid}/fileFolders`),
      ]);
      const files = normalizeList(filesRaw);
      const folders = normalizeList(foldersRaw);
      return response.status(200).json({
        files: files.map((f) => toListEntry(f, uid)),
        folders,
        migratedRemaining: files.some((f) => f.dataUrl && !f.downloadUrl),
      });
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
    return response.status(200).json({
      files: files.map((file) => toListEntry(updatedById.get(file.id) || file, uid)),
      folders,
      migratedRemaining: remaining,
    });
  } catch (error) {
    console.error('my-files failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
