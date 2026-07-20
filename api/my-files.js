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
/** Stay under Vercel Hobby ~4.5MB request body limit. */
const MAX_UPLOAD_BYTES = 3_500_000;

export const config = {
  api: {
    bodyParser: false,
  },
  maxDuration: 60,
};

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

function json(response, status, body, origin) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  return response.status(status).json(body);
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

function readRawBody(request, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(Object.assign(new Error('payload-too-large'), { code: 'payload-too-large' }));
        try { request.destroy(); } catch { /* ignore */ }
        return;
      }
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

/** Prefer already-buffered body (Vercel Node); else read the stream. */
async function getUploadBuffer(request, limitBytes) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > limitBytes) {
    throw Object.assign(new Error('payload-too-large'), { code: 'payload-too-large' });
  }

  const body = request.body;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body && typeof body === 'object' && Array.isArray(body.data)) {
    return Buffer.from(body.data);
  }
  if (body instanceof Uint8Array) return Buffer.from(body);

  return readRawBody(request, limitBytes);
}

async function handleUpload(request, response, origin, account) {
  let buffer;
  try {
    buffer = await getUploadBuffer(request, MAX_UPLOAD_BYTES);
  } catch (err) {
    if (err?.code === 'payload-too-large' || err?.message === 'payload-too-large') {
      return json(response, 413, { error: 'payload-too-large', maxBytes: MAX_UPLOAD_BYTES }, origin);
    }
    throw err;
  }

  if (!buffer.length) {
    return json(response, 400, { error: 'empty-body' }, origin);
  }

  const rawName = String(request.headers['x-file-name'] || '').trim();
  let fileName = 'file';
  if (rawName) {
    try {
      fileName = decodeURIComponent(rawName).slice(0, 180) || 'file';
    } catch {
      fileName = rawName.slice(0, 180) || 'file';
    }
  }

  const fileId = String(request.headers['x-file-id'] || '').trim()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const folderId = String(request.headers['x-folder-id'] || '').trim() || null;
  const contentType = String(
    request.headers['x-content-type']
    || request.headers['content-type']
    || 'application/octet-stream',
  ).split(';')[0].trim() || 'application/octet-stream';

  const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  const storageToken = await getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]);
  const objectPath = `users/${account.uid}/files/${fileId}/${safeStorageFileName(fileName)}`;
  const downloadUrl = await uploadToStorage(storageToken, objectPath, buffer, contentType);

  return json(response, 200, {
    id: fileId,
    name: fileName,
    type: contentType,
    size: buffer.length,
    downloadUrl,
    storagePath: objectPath,
    ...(folderId ? { folderId } : {}),
  }, origin);
}

export default async function handler(request, response) {
  const origin = request.headers.origin || '';
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-File-Name, X-File-Id, X-Folder-Id, X-Content-Type',
    );
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    return response.status(204).end();
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST, OPTIONS');
    return json(response, 405, { error: 'method-not-allowed' }, origin);
  }
  if (!allowOrigin(origin)) return json(response, 403, { error: 'forbidden' }, origin);
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const account = idToken ? await verifyUser(idToken) : null;
  if (!account) return json(response, 403, { error: 'forbidden' }, origin);

  if (request.method === 'POST') {
    try {
      return await handleUpload(request, response, origin, account);
    } catch (error) {
      console.error('my-files upload failed', error);
      return json(response, 500, {
        error: 'upload-failed',
        details: error instanceof Error ? error.message : String(error),
      }, origin);
    }
  }

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
