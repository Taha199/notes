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
const MAX_INLINE_BYTES = 3_500_000;

function allowOrigin(origin) {
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');
  return isAllowedOrigin(origin) || localDev;
}

function asciiFallbackName(name) {
  const base = String(name || 'file').replace(/[^\x20-\x7E]/g, '_').trim() || 'file';
  return base.slice(0, 120);
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

  const fileId = String(request.query?.fileId || '').trim();
  if (!fileId) return response.status(400).json({ error: 'missing-file-id' });

  const format = String(request.query?.format || 'json').toLowerCase();

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const [dbToken, storageToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
    ]);

    const file = await readRtdb(dbToken, `/users/${account.uid}/files/${fileId}`);
    if (!file || typeof file !== 'object') {
      return response.status(404).json({ error: 'file-not-found' });
    }

    const storagePath = resolveStoragePath(file, account.uid);
    if (!storagePath) {
      return response.status(404).json({ error: 'no-storage-path' });
    }

    const contentType = file.type || 'application/octet-stream';
    const fileName = file.name || 'file';

    // Same-origin stream for preview (bypasses Chrome CORS + attachment disposition).
    if (format === 'inline' || format === 'attachment') {
      const size = typeof file.size === 'number' ? file.size : 0;
      if (size > MAX_INLINE_BYTES) {
        return response.status(413).json({ error: 'too-large-for-proxy', size });
      }

      const { buffer, contentType: detected } = await downloadFromStorage(storageToken, storagePath);
      if (buffer.length > MAX_INLINE_BYTES) {
        return response.status(413).json({ error: 'too-large-for-proxy', size: buffer.length });
      }

      const mime = detected || contentType;
      const disposition = format === 'attachment' ? 'attachment' : 'inline';
      const safeName = asciiFallbackName(fileName);
      response.setHeader('Content-Type', mime);
      response.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${safeName.replace(/"/g, '')}"`,
      );
      response.setHeader('Cache-Control', 'private, max-age=60');
      response.setHeader('Content-Length', String(buffer.length));
      return response.status(200).send(buffer);
    }

    const { downloadUrl } = await resolveDownloadUrl(
      storageToken,
      storagePath,
      contentType,
      false,
    );

    return response.status(200).json({
      downloadUrl,
      storagePath,
      name: fileName,
      type: contentType,
      size: typeof file.size === 'number' ? file.size : undefined,
    });
  } catch (error) {
    console.error('file-download failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
