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
  resolveDownloadUrl,
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

function safeFilename(name) {
  return String(name || 'download').replace(/[^\w.\- ()\u00C0-\u024F]+/g, '_').slice(0, 180) || 'download';
}

function guessContentType(name, fallback) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (/\.(png)$/.test(lower)) return 'image/png';
  if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
  if (/\.(gif)$/.test(lower)) return 'image/gif';
  if (/\.(webp)$/.test(lower)) return 'image/webp';
  if (/\.(txt|md|csv|log)$/.test(lower)) return 'text/plain';
  return fallback || 'application/octet-stream';
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
  const pathParam = String(request.query?.path || '');
  const mode = String(request.query?.mode || 'json');
  const disposition = String(request.query?.disposition || '') === 'inline' ? 'inline' : 'attachment';
  const forceRemint = String(request.query?.remint || '') === '1';
  if (!fileId && !pathParam) {
    return response.status(400).json({ error: 'missing-file-id' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const uid = account.uid;

    // Proxy: mint both Google tokens in parallel (preview hot path).
    // JSON: RTDB first; Storage token only when a download URL must be created.
    const dbTokenPromise = getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
    const storageTokenPromise = mode === 'proxy'
      ? getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE])
      : null;

    const dbToken = await dbTokenPromise;

    let file = null;
    if (fileId) {
      file = await readRtdb(dbToken, `/users/${uid}/files/${fileId}`);
      if (!file || typeof file !== 'object') {
        return response.status(404).json({ error: 'not-found' });
      }
    }

    // path= may be used alone (storage object under this user's tree) or to override.
    let storagePath = pathParam
      || (file ? resolveStoragePath(file, uid) : undefined);
    if (pathParam) {
      const expectedPrefix = `users/${uid}/files/`;
      if (!pathParam.startsWith(expectedPrefix)) {
        return response.status(403).json({ error: 'forbidden-path' });
      }
      storagePath = pathParam;
    }

    let downloadUrl = typeof file?.downloadUrl === 'string' ? file.downloadUrl : '';
    const dataUrl = typeof file?.dataUrl === 'string' && file.dataUrl.startsWith('data:')
      ? file.dataUrl
      : '';
    const fileName = file?.name || (storagePath ? storagePath.split('/').pop() : 'download');
    const fileType = file?.type || guessContentType(fileName, 'application/octet-stream');
    const fileSize = file?.size;

    if (mode === 'proxy') {
      const storageToken = storageTokenPromise ? await storageTokenPromise : null;
      let buffer;
      let contentType = fileType || 'application/octet-stream';
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

      // Prefer a real MIME for PDF preview (GCS often returns octet-stream).
      if (!contentType || contentType === 'application/octet-stream') {
        contentType = guessContentType(fileName, contentType);
      }

      if (buffer.length > MAX_PROXY_BYTES) {
        // Too large for Hobby — hand back a URL without reminting tokens.
        if (!downloadUrl && storagePath) {
          try {
            const resolved = await resolveDownloadUrl(
              storageToken,
              storagePath,
              contentType || undefined,
              false,
            );
            downloadUrl = resolved.downloadUrl;
            // Persist only when the RTDB row was missing a URL (never wipe a live one).
            if (fileId && file && !file.downloadUrl) {
              const clean = { ...file, downloadUrl, storagePath };
              delete clean.dataUrl;
              delete clean.inlinePending;
              await writeRtdb(dbToken, `/users/${uid}/files/${fileId}`, clean);
            }
          } catch {
            /* keep empty */
          }
        }
        if (!downloadUrl) return response.status(413).json({ error: 'too-large' });
        return response.status(200).json({
          downloadUrl,
          storagePath: storagePath || storagePathFromDownloadUrl(downloadUrl),
          name: fileName,
          type: contentType,
          size: fileSize,
          proxy: false,
        });
      }
      const filename = safeFilename(fileName);
      response.setHeader('Content-Type', contentType);
      response.setHeader(
        'Content-Disposition',
        `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      return response.status(200).send(buffer);
    }

    // JSON / redirect: reuse existing tokenized URL. Remint only if missing or forced.
    if (storagePath && (!downloadUrl || forceRemint)) {
      try {
        const storageToken = await getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]);
        const resolved = await resolveDownloadUrl(
          storageToken,
          storagePath,
          fileType || undefined,
          forceRemint,
        );
        downloadUrl = resolved.downloadUrl;
        if (fileId && file && (resolved.minted || !file.downloadUrl || !file.storagePath)) {
          const clean = {
            ...file,
            downloadUrl,
            storagePath,
          };
          delete clean.dataUrl;
          delete clean.inlinePending;
          await writeRtdb(dbToken, `/users/${uid}/files/${fileId}`, clean);
        }
      } catch {
        /* keep existing downloadUrl / fall through */
      }
    }

    if (mode === 'redirect') {
      if (!downloadUrl && dataUrl) {
        return response.status(200).json({ dataUrl, name: fileName, type: fileType, size: fileSize });
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
      name: fileName,
      type: fileType,
      size: fileSize,
    });
  } catch (error) {
    console.error('file-download failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
