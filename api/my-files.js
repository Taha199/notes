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

const MAX_MIGRATIONS_PER_CALL = 5;

function allowOrigin(origin) {
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return isAllowedOrigin(origin) || localDev;
}

function json(response, status, body, origin) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  return response.status(status).json(body);
}

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
  if (file.dataUrl && !file.downloadUrl) {
    return { ...toClientFile(file, uid), inlinePending: true };
  }
  return toClientFile(file, uid);
}

/**
 * Enrich downloadUrl when missing. Never throw — mark broken rows with accessError
 * so one bad file cannot wipe the whole list.
 */
async function enrichFileUrls(files, uid, storageToken, dbToken) {
  return Promise.all(
    files.map(async (file) => {
      try {
        const entry = toListEntry(file, uid);
        if (entry.downloadUrl && entry.storagePath) return entry;

        const path = resolveStoragePath(entry, uid) || entry.storagePath;
        if (!path || !storageToken) {
          return {
            ...entry,
            accessError: entry.inlinePending ? 'inline-pending' : 'missing-storage-path',
          };
        }

        try {
          const { downloadUrl } = await resolveDownloadUrl(
            storageToken,
            path,
            file.type || 'application/octet-stream',
            false,
          );
          const enriched = { ...entry, downloadUrl, storagePath: path };
          delete enriched.accessError;
          if (dbToken && downloadUrl && downloadUrl !== file.downloadUrl) {
            // Persist in background — don't fail the list if write fails.
            void writeRtdb(dbToken, `/users/${uid}/files/${file.id}`, {
              ...stripBlob(file),
              downloadUrl,
              storagePath: path,
            });
          }
          return enriched;
        } catch (err) {
          return {
            ...entry,
            storagePath: path,
            accessError: err instanceof Error ? err.message : 'url-enrich-failed',
          };
        }
      } catch (err) {
        return {
          ...stripBlob(file),
          accessError: err instanceof Error ? err.message : 'enrich-failed',
        };
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
      /* keep legacy for a later pass */
    }
  }
  const remaining = files.some((file) => {
    if (updatedById.has(file.id)) return false;
    return !!(file.dataUrl && !file.downloadUrl);
  });
  return { migrated, updatedById, remaining };
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
    return json(response, 405, { error: 'method-not-allowed' }, origin);
  }
  if (!allowOrigin(origin)) {
    return json(response, 403, { error: 'forbidden', details: 'origin-not-allowed' }, origin);
  }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!idToken) {
    return json(response, 401, { error: 'unauthorized', details: 'missing-bearer-token' }, origin);
  }

  const account = await verifyUser(idToken);
  if (!account?.uid) {
    return json(response, 401, { error: 'unauthorized', details: 'invalid-token' }, origin);
  }

  const doMigrate = String(request.query?.migrate || '') === '1';
  const uid = account.uid;

  try {
    let serviceAccount;
    try {
      serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    } catch (err) {
      return json(response, 500, {
        error: 'missing-service-account',
        details: err instanceof Error ? err.message : String(err),
      }, origin);
    }

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

    if (!doMigrate) {
      const out = await enrichFileUrls(files, uid, storageToken, dbToken);
      const migratedRemaining = files.some((f) => f.dataUrl && !f.downloadUrl);
      return json(response, 200, { files: out, folders, migratedRemaining }, origin);
    }

    const { updatedById, remaining } = await migrateLegacyBatch(files, uid, dbToken, storageToken);
    const merged = files.map((file) => updatedById.get(file.id) || file);
    const out = await enrichFileUrls(merged, uid, storageToken, dbToken);
    return json(response, 200, { files: out, folders, migratedRemaining: remaining }, origin);
  } catch (error) {
    console.error('my-files failed', error);
    return json(response, 500, {
      error: 'request-failed',
      details: error instanceof Error ? error.message : String(error),
    }, origin);
  }
}
