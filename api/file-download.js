import {
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
} from './_lib/firebaseAdmin.js';
import {
  resolveDownloadUrl,
  resolveStoragePath,
  STORAGE_SCOPE,
} from './_lib/storageFiles.js';

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

  const fileId = String(request.query?.fileId || '').trim();
  if (!fileId) return response.status(400).json({ error: 'missing-file-id' });

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

    const { downloadUrl } = await resolveDownloadUrl(
      storageToken,
      storagePath,
      file.type || 'application/octet-stream',
      false,
    );

    return response.status(200).json({
      downloadUrl,
      storagePath,
      name: file.name || 'file',
      type: file.type || 'application/octet-stream',
    });
  } catch (error) {
    console.error('file-download failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
