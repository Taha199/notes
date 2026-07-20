import { randomUUID } from 'node:crypto';
import { STORAGE_BUCKET, STORAGE_BUCKET_LEGACY } from './firebaseAdmin.js';

export const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** Friday client bucket first; legacy appspot second for older objects. */
export const STORAGE_BUCKET_CANDIDATES = [
  STORAGE_BUCKET,
  STORAGE_BUCKET_LEGACY,
].filter((b, i, arr) => b && arr.indexOf(b) === i);

export function safeStorageFileName(name) {
  if (!name || typeof name !== 'string') return 'file';
  const cleaned = name
    .replace(/[/\\?#%[\]*]+/g, '_')
    // Spaces / unicode whitespace → underscore (avoids awkward %20 paths)
    .replace(/[\s\u00A0]+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

export function storagePathFromDownloadUrl(url) {
  if (!url || typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    const marker = '/o/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return undefined;
    const encoded = u.pathname.slice(idx + marker.length);
    return encoded ? decodeURIComponent(encoded) : undefined;
  } catch {
    return undefined;
  }
}

export function firebaseMediaUrl(objectPath, token, bucket = STORAGE_BUCKET) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

export function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('invalid-data-url');
  }
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

/** All plausible object paths — prefer downloadUrl-derived path. */
export function candidateStoragePaths(file, uid) {
  const paths = [];
  const add = (p) => {
    if (typeof p === 'string' && p && !paths.includes(p)) paths.push(p);
  };
  if (file.downloadUrl) add(storagePathFromDownloadUrl(file.downloadUrl));
  add(file.storagePath);
  if (uid && file.id && file.name) {
    add(`users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`);
    add(`users/${uid}/files/${file.id}/${file.name}`);
    const underscored = file.name.replace(/\s+/g, '_');
    if (underscored !== file.name) {
      add(`users/${uid}/files/${file.id}/${underscored}`);
      add(`users/${uid}/files/${file.id}/${safeStorageFileName(underscored)}`);
    }
  }
  return paths;
}

export function resolveStoragePath(file, uid) {
  if (!file || typeof file !== 'object') return undefined;
  return candidateStoragePaths(file, uid)[0];
}

/**
 * Upload via Firebase Storage REST (firebasestorage.googleapis.com).
 * Raw GCS JSON API returns "The specified bucket does not exist" for both
 * bucket names on this project when using the service account.
 */
export async function uploadToStorage(storageToken, objectPath, buffer, contentType) {
  let lastStatus = 0;
  let lastDetail = '';
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?name=${encodeURIComponent(objectPath)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${storageToken}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: buffer,
    });
    if (uploadRes.ok) {
      const data = await uploadRes.json().catch(() => ({}));
      const raw = data?.downloadTokens
        || data?.metadata?.firebaseStorageDownloadTokens
        || data?.metadata?.downloadTokens;
      if (typeof raw === 'string' && raw.trim()) {
        const dlToken = raw.split(',')[0]?.trim();
        if (dlToken) return firebaseMediaUrl(objectPath, dlToken, bucket);
      }
      return mintDownloadToken(storageToken, objectPath, contentType, bucket);
    }
    lastStatus = uploadRes.status;
    lastDetail = (await uploadRes.text().catch(() => '')).slice(0, 160);
    if (uploadRes.status !== 404) {
      throw new Error(`storage-upload-failed:${uploadRes.status}:${bucket}:${lastDetail}`);
    }
  }
  throw new Error(`storage-upload-failed:${lastStatus}:${STORAGE_BUCKET_CANDIDATES.join('|')}:${lastDetail}`);
}

/**
 * Read the existing Firebase download token.
 * CRITICAL: never remint on every request — that invalidates URLs already in RTDB.
 */
export async function existingDownloadUrl(storageToken, objectPath) {
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    const endpoints = [
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`,
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?fields=metadata`,
    ];
    for (const metaUrl of endpoints) {
      const res = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${storageToken}` },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = data?.downloadTokens
        || data?.metadata?.firebaseStorageDownloadTokens
        || data?.metadata?.downloadTokens;
      if (!raw || typeof raw !== 'string') continue;
      const token = raw.split(',')[0]?.trim();
      if (!token) continue;
      return firebaseMediaUrl(objectPath, token, bucket);
    }
  }
  return null;
}

export async function mintDownloadToken(storageToken, objectPath, contentType, bucket = STORAGE_BUCKET) {
  const token = randomUUID();
  const body = { metadata: { firebaseStorageDownloadTokens: token } };
  if (contentType) body.contentType = contentType;

  // Prefer Firebase Storage REST; fall back to GCS JSON if the bucket is visible there.
  const endpoints = [
    {
      url: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`,
      payload: body,
    },
    {
      url: `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}`,
      payload: body,
    },
  ];
  let lastStatus = 0;
  for (const { url, payload } of endpoints) {
    const patchRes = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${storageToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (patchRes.ok) return firebaseMediaUrl(objectPath, token, bucket);
    lastStatus = patchRes.status;
  }
  throw new Error(`storage-token-failed:${lastStatus}:${bucket}`);
}

/** Prefer existing token; only mint when missing. */
export async function resolveDownloadUrl(storageToken, objectPath, contentType, forceRemint = false) {
  if (!forceRemint) {
    try {
      const existing = await existingDownloadUrl(storageToken, objectPath);
      if (existing) return { downloadUrl: existing, minted: false };
    } catch {
      /* fall through */
    }
  }
  const downloadUrl = await mintDownloadToken(storageToken, objectPath, contentType);
  return { downloadUrl, minted: true };
}

export async function downloadFromStorage(storageToken, objectPath) {
  let lastErr = null;
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    const endpoints = [
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
    ];
    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${storageToken}` },
      });
      if (res.ok) {
        return {
          buffer: Buffer.from(await res.arrayBuffer()),
          contentType: res.headers.get('content-type') || 'application/octet-stream',
          bucket,
        };
      }
      lastErr = new Error(`storage-download-failed:${res.status}`);
    }
  }
  throw lastErr || new Error('storage-download-failed');
}

export async function downloadViaMediaUrl(downloadUrl) {
  if (!downloadUrl || typeof downloadUrl !== 'string') throw new Error('missing-download-url');
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`media-url-failed:${res.status}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

export async function listStoragePrefix(storageToken, prefix, maxResults = 200) {
  const names = [];
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        prefix,
        maxResults: String(maxResults),
        fields: 'items(name),nextPageToken',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?${params}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${storageToken}` },
      });
      if (!res.ok) break;
      const data = await res.json();
      for (const item of data.items || []) {
        if (item?.name && !names.includes(item.name)) names.push(item.name);
      }
      pageToken = data.nextPageToken || '';
      if (names.length >= maxResults) return names;
    } while (pageToken);
    if (names.length) return names;
  }
  return names;
}

function basename(objectPath) {
  const parts = String(objectPath || '').split('/');
  return parts[parts.length - 1] || '';
}

function namesMatch(objectPath, fileName) {
  if (!fileName) return false;
  const base = basename(objectPath);
  if (base === fileName) return true;
  if (base === safeStorageFileName(fileName)) return true;
  if (base === fileName.replace(/\s+/g, '_')) return true;
  return base.toLowerCase() === fileName.toLowerCase();
}

/**
 * Resolve bytes: Storage paths → listing → media URL → RTDB dataUrl (last).
 * dataUrl last so we do not skip a real Storage object, but still recover legacy.
 */
export async function resolveFileBytes(storageToken, file, uid) {
  const tried = [];
  const candidates = candidateStoragePaths(file, uid);

  for (const path of candidates) {
    tried.push(path);
    try {
      const result = await downloadFromStorage(storageToken, path);
      return { ...result, storagePath: path, source: 'gcs-path' };
    } catch { /* next */ }
  }

  if (uid && file.id) {
    const listed = await listStoragePrefix(storageToken, `users/${uid}/files/${file.id}/`, 50);
    for (const path of listed) {
      if (tried.includes(path)) continue;
      tried.push(path);
      try {
        const result = await downloadFromStorage(storageToken, path);
        return { ...result, storagePath: path, source: 'gcs-list' };
      } catch { /* next */ }
    }
  }

  if (uid && file.name) {
    const allUnderUser = await listStoragePrefix(storageToken, `users/${uid}/files/`, 500);
    for (const path of allUnderUser.filter((p) => namesMatch(p, file.name))) {
      if (tried.includes(path)) continue;
      tried.push(path);
      try {
        const result = await downloadFromStorage(storageToken, path);
        return { ...result, storagePath: path, source: 'gcs-name-search' };
      } catch { /* next */ }
    }
  }

  if (file.downloadUrl) {
    try {
      const result = await downloadViaMediaUrl(file.downloadUrl);
      return {
        ...result,
        storagePath: storagePathFromDownloadUrl(file.downloadUrl) || candidates[0],
        source: 'media-url',
      };
    } catch { /* fall through */ }
  }

  if (typeof file.dataUrl === 'string' && file.dataUrl.startsWith('data:')) {
    try {
      const { buffer, contentType } = dataUrlToBuffer(file.dataUrl);
      return { buffer, contentType, storagePath: candidates[0], source: 'rtdb-dataurl' };
    } catch { /* fall through */ }
  }

  throw new Error(`storage-object-not-found:${tried.slice(0, 6).join('|') || 'no-candidates'}`);
}
