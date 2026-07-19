import {
  getGoogleAccessToken,
  isAllowedOrigin,
  readServiceAccount,
  readRtdb,
  RTDB_SCOPES,
  verifyUser,
  writeRtdb,
} from './_lib/firebaseAdmin.js';
import {
  STORAGE_SCOPE,
  downloadFromStorage,
  mintDownloadToken,
  resolveStoragePath,
  storagePathFromDownloadUrl,
} from './_lib/storageFiles.js';

/** Hobby response budget — keep proxy under Vercel's ~4.5MB payload limit. */
const MAX_PROXY_BYTES = 3_500_000;

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

  const fileId = String(request.query?.fileId || '');
  const mode = String(request.query?.mode || 'json');
  const disposition = String(request.query?.disposition || '') === 'inline' ? 'inline' : 'attachment';
  if (!fileId) return response.status(400).json({ error: 'missing-file-id' });

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const [dbToken, storageToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
    ]);

    const uid = account.uid;
    const file = await readRtdb(dbToken, `/users/${uid}/files/${fileId}`);
    if (!file || typeof file !== 'object') {
      return response.status(404).json({ error: 'not-found' });
    }

    const storagePath = resolveStoragePath(file, uid);
    let downloadUrl = typeof file.downloadUrl === 'string' ? file.downloadUrl : '';
    const dataUrl = typeof file.dataUrl === 'string' && file.dataUrl.startsWith('data:')
      ? file.dataUrl
      : '';

    // Prefer refreshing a tokenized Firebase URL so the browser can fetch with CORS.
    if (storagePath) {
      try {
        downloadUrl = await mintDownloadToken(
          storageToken,
          storagePath,
          file.type || undefined,
        );
        const clean = {
          ...file,
          downloadUrl,
          storagePath,
        };
        delete clean.dataUrl;
        delete clean.inlinePending;
        await writeRtdb(dbToken, `/users/${uid}/files/${fileId}`, clean);
      } catch {
        /* keep existing downloadUrl / fall through */
      }
    }

    if (mode === 'proxy') {
      let buffer;
      let contentType = file.type || 'application/octet-stream';
      if (storagePath) {
        const downloaded = await downloadFromStorage(storageToken, storagePath);
        buffer = downloaded.buffer;
        contentType = downloaded.contentType || contentType;
      } else if (dataUrl) {
        const parsed = dataUrlToBuffer(dataUrl);
        buffer = parsed.buffer;
        contentType = parsed.contentType || contentType;
      } else {
        return response.status(404).json({ error: 'no-bytes' });
      }
      if (buffer.length > MAX_PROXY_BYTES) {
        // Too large for Hobby — hand the client a fresh URL instead.
        if (!downloadUrl) return response.status(413).json({ error: 'too-large' });
        return response.status(200).json({
          downloadUrl,
          storagePath: storagePath || storagePathFromDownloadUrl(downloadUrl),
          name: file.name,
          type: contentType,
          size: file.size,
          proxy: false,
        });
      }
      response.setHeader('Content-Type', contentType);
      response.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${String(file.name || 'download').replace(/"/g, '')}"`,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      return response.status(200).send(buffer);
    }

    if (mode === 'redirect') {
      if (!downloadUrl && dataUrl) {
        return response.status(200).json({ dataUrl, name: file.name, type: file.type, size: file.size });
      }
      if (!downloadUrl) return response.status(404).json({ error: 'no-url' });
      response.setHeader('Location', downloadUrl);
      return response.status(302).end();
    }

    // Default: small JSON the client can use with getBytes / fetch / <a>.
    if (!downloadUrl && !dataUrl && !storagePath) {
      return response.status(404).json({ error: 'no-url' });
    }
    return response.status(200).json({
      downloadUrl: downloadUrl || undefined,
      storagePath: storagePath || undefined,
      dataUrl: dataUrl || undefined,
      name: file.name,
      type: file.type,
      size: file.size,
    });
  } catch (error) {
    console.error('file-download failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
