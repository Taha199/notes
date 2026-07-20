import {
  FB_DB_URL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
} from './_lib/firebaseAdmin.js';
import {
  resolveStoragePath,
  safeStorageFileName,
  storagePathFromDownloadUrl,
} from './_lib/storageFiles.js';

export const config = {
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

/**
 * Metadata-only list entry. Never ship base64 to the browser.
 * Inline RTDB files (dataUrl, no downloadUrl) stay as inlinePending — do NOT invent
 * a Storage path that does not exist (Friday ≤7MB path).
 */
function toListEntry(file, uid) {
  const stripped = stripBlob(file);
  if (file.dataUrl && !file.downloadUrl) {
    return { ...stripped, inlinePending: true };
  }
  const storagePath = resolveStoragePath(stripped, uid)
    || (stripped.downloadUrl ? storagePathFromDownloadUrl(stripped.downloadUrl) : undefined)
    || (uid && stripped.id && stripped.name
      ? `users/${uid}/files/${stripped.id}/${safeStorageFileName(stripped.name)}`
      : undefined);
  return storagePath ? { ...stripped, storagePath } : stripped;
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
    // Disabled: broken server GCS proxy. Client uses Friday dual-path upload.
    return json(response, 501, {
      error: 'proxy-upload-disabled',
      details: 'Use client dual-path upload (dataUrl ≤7MB, Storage for larger)',
    }, origin);
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const uid = account.uid;

    // Fast list only. Inline dataUrl files are intentional (Friday ≤7MB) — do not migrate.
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
      migratedRemaining: false,
    });
  } catch (error) {
    console.error('my-files failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
