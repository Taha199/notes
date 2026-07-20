import {
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
} from './_lib/firebaseAdmin.js';
import {
  downloadFromStorage,
  resolveDownloadUrl,
  resolveStoragePath,
  STORAGE_SCOPE,
} from './_lib/storageFiles.js';

/** Stay under Vercel Hobby ~4.5MB response limit. */
const MAX_PROXY_BYTES = 3_500_000;

function allowOrigin(origin) {
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return isAllowedOrigin(origin) || localDev;
}

function json(response, status, body, origin) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  return response.status(status).json(body);
}

function contentDisposition(format, fileName) {
  const raw = String(fileName || 'file').slice(0, 180);
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') || 'file';
  const encoded = encodeURIComponent(raw);
  const type = format === 'attachment' ? 'attachment' : 'inline';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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

  const fileId = String(request.query?.fileId || '').trim();
  if (!fileId) {
    return json(response, 400, { error: 'missing-file-id' }, origin);
  }

  // Default to attachment for safety; explicit json for URL-only clients.
  const rawFormat = String(request.query?.format || 'attachment').toLowerCase();
  const format = rawFormat === 'inline' || rawFormat === 'json' ? rawFormat : 'attachment';

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

    // Ownership: path is scoped to verified UID — never trust client-supplied uid.
    const file = await readRtdb(dbToken, `/users/${account.uid}/files/${fileId}`);
    if (!file || typeof file !== 'object') {
      return json(response, 404, { error: 'file-not-found' }, origin);
    }

    const storagePath = resolveStoragePath(file, account.uid);
    if (!storagePath) {
      return json(response, 404, {
        error: 'no-storage-path',
        details: 'File metadata has no storagePath or recoverable path',
      }, origin);
    }

    const contentType = file.type || 'application/octet-stream';
    const fileName = file.name || 'file';

    if (format === 'json') {
      const { downloadUrl } = await resolveDownloadUrl(
        storageToken,
        storagePath,
        contentType,
        false,
      );
      return json(response, 200, {
        downloadUrl,
        storagePath,
        name: fileName,
        type: contentType,
        size: typeof file.size === 'number' ? file.size : undefined,
      }, origin);
    }

    // inline | attachment → stream bytes (authenticated, same-origin).
    const declaredSize = typeof file.size === 'number' ? file.size : 0;
    if (declaredSize > MAX_PROXY_BYTES) {
      const { downloadUrl } = await resolveDownloadUrl(
        storageToken,
        storagePath,
        contentType,
        false,
      );
      return json(response, 413, {
        error: 'too-large-for-proxy',
        size: declaredSize,
        downloadUrl,
        storagePath,
      }, origin);
    }

    let buffer;
    let detected;
    try {
      ({ buffer, contentType: detected } = await downloadFromStorage(storageToken, storagePath));
    } catch (err) {
      return json(response, 502, {
        error: 'storage-download-failed',
        details: err instanceof Error ? err.message : String(err),
        storagePath,
      }, origin);
    }

    if (buffer.length > MAX_PROXY_BYTES) {
      const { downloadUrl } = await resolveDownloadUrl(
        storageToken,
        storagePath,
        contentType,
        false,
      );
      return json(response, 413, {
        error: 'too-large-for-proxy',
        size: buffer.length,
        downloadUrl,
        storagePath,
      }, origin);
    }

    const mime = detected || contentType;
    response.setHeader('Content-Type', mime);
    response.setHeader('Content-Disposition', contentDisposition(format, fileName));
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('Content-Length', String(buffer.length));
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    return response.status(200).send(buffer);
  } catch (error) {
    console.error('file-download failed', error);
    return json(response, 500, {
      error: 'request-failed',
      details: error instanceof Error ? error.message : String(error),
    }, origin);
  }
}
