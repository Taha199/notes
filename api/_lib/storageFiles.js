import { randomUUID } from 'node:crypto';
import { STORAGE_BUCKET } from './firebaseAdmin.js';

export const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** Prefer legacy appspot first — older uploads often live there, not on *.firebasestorage.app. */
export const STORAGE_BUCKET_CANDIDATES = [
  'noteclaude-a5b3b.appspot.com',
  STORAGE_BUCKET,
].filter((b, i, arr) => b && arr.indexOf(b) === i);

/** Extract Storage object path from a Firebase download URL. */
export function storagePathFromDownloadUrl(url) {
  if (!url || typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    const marker = '/o/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return undefined;
    const encoded = u.pathname.slice(idx + marker.length);
    if (!encoded) return undefined;
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export function firebaseMediaUrl(objectPath, token, bucket = STORAGE_BUCKET) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/** Upload bytes and attach a Firebase download token. Throws if either step fails. */
export async function uploadToStorage(storageToken, objectPath, buffer, contentType) {
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`storage-upload-failed:${uploadRes.status}`);
  return mintDownloadToken(storageToken, objectPath, contentType);
}

/**
 * Read the existing Firebase download token from object metadata.
 * CRITICAL: never replace a live token unless reminting — that invalidates
 * downloadUrl values already held in the client list state (403 forever).
 */
export async function existingDownloadUrl(storageToken, objectPath) {
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    const metaUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?fields=metadata`;
    const res = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${storageToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const raw = data?.metadata?.firebaseStorageDownloadTokens;
    if (!raw || typeof raw !== 'string') continue;
    const token = raw.split(',')[0]?.trim();
    if (!token) continue;
    return firebaseMediaUrl(objectPath, token, bucket);
  }
  return null;
}

/** Attach / refresh a Firebase download token on an existing object. */
export async function mintDownloadToken(storageToken, objectPath, contentType) {
  const token = randomUUID();
  const patchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}`;
  const body = {
    metadata: { firebaseStorageDownloadTokens: token },
  };
  if (contentType) body.contentType = contentType;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!patchRes.ok) throw new Error(`storage-token-failed:${patchRes.status}`);
  return firebaseMediaUrl(objectPath, token);
}

/**
 * Prefer the existing Storage download token. Only mint a new one when missing
 * or when forceRemint is set — reminting invalidates every prior URL.
 */
export async function resolveDownloadUrl(storageToken, objectPath, contentType, forceRemint = false) {
  if (!forceRemint) {
    try {
      const existing = await existingDownloadUrl(storageToken, objectPath);
      if (existing) return { downloadUrl: existing, minted: false };
    } catch {
      /* fall through to mint */
    }
  }
  const downloadUrl = await mintDownloadToken(storageToken, objectPath, contentType);
  return { downloadUrl, minted: true };
}

/** Download object bytes via GCS JSON API + Firebase Storage REST (service account). */
export async function downloadFromStorage(storageToken, objectPath) {
  let lastErr = null;
  for (const bucket of STORAGE_BUCKET_CANDIDATES) {
    const endpoints = [
      // Firebase Storage REST (what the client SDK talks to)
      `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
      // GCS JSON API
      `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`,
    ];
    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${storageToken}` },
      });
      if (res.ok) {
        const contentType = res.headers.get('content-type') || 'application/octet-stream';
        const buffer = Buffer.from(await res.arrayBuffer());
        return { buffer, contentType, bucket };
      }
      lastErr = new Error(`storage-download-failed:${res.status}`);
      if (res.status !== 404) continue;
    }
  }
  throw lastErr || new Error('storage-download-failed');
}

/** Fetch bytes via a Firebase media/download URL (works even when metadata path is stale). */
export async function downloadViaMediaUrl(downloadUrl) {
  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new Error('missing-download-url');
  }
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`media-url-failed:${res.status}`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/** List object names under a prefix (e.g. users/{uid}/files/{fileId}/). */
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
      // Cap total scanned objects for Hobby time limits.
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
  if (base === safeStorageFileName(fileName.replace(/\s+/g, '_'))) return true;
  // Case-insensitive fallback
  return base.toLowerCase() === fileName.toLowerCase();
}

export function safeStorageFileName(name) {
  if (!name || typeof name !== 'string') return 'file';
  const cleaned = name
    .replace(/[/\\?#%[\]*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

/**
 * All plausible object paths for a file row.
 * Prefer downloadUrl-derived path — it reflects where the object actually lives.
 */
export function candidateStoragePaths(file, uid) {
  const paths = [];
  const add = (p) => {
    if (typeof p === 'string' && p && !paths.includes(p)) paths.push(p);
  };
  // downloadUrl path first — most accurate when storagePath was guessed wrong.
  if (file.downloadUrl) add(storagePathFromDownloadUrl(file.downloadUrl));
  add(file.storagePath);
  if (uid && file.id && file.name) {
    add(`users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`);
    add(`users/${uid}/files/${file.id}/${file.name}`);
    // Older uploads may have replaced spaces with underscores.
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
 * Resolve real bytes for a file: try candidate paths, then prefix listing,
 * then the stored media URL. Returns { buffer, contentType, storagePath }.
 */
export async function resolveFileBytes(storageToken, file, uid) {
  const tried = [];
  const candidates = candidateStoragePaths(file, uid);

  for (const path of candidates) {
    tried.push(path);
    try {
      const result = await downloadFromStorage(storageToken, path);
      return { ...result, storagePath: path, source: 'gcs-path' };
    } catch {
      /* try next */
    }
  }

  if (uid && file.id) {
    const prefix = `users/${uid}/files/${file.id}/`;
    const listed = await listStoragePrefix(storageToken, prefix, 50);
    for (const path of listed) {
      if (tried.includes(path)) continue;
      tried.push(path);
      try {
        const result = await downloadFromStorage(storageToken, path);
        return { ...result, storagePath: path, source: 'gcs-list' };
      } catch {
        /* try next */
      }
    }
  }

  // Broad search: object may live under a different fileId folder with the same filename.
  if (uid && file.name) {
    const allUnderUser = await listStoragePrefix(storageToken, `users/${uid}/files/`, 500);
    const matches = allUnderUser.filter((path) => namesMatch(path, file.name));
    for (const path of matches) {
      if (tried.includes(path)) continue;
      tried.push(path);
      try {
        const result = await downloadFromStorage(storageToken, path);
        return { ...result, storagePath: path, source: 'gcs-name-search' };
      } catch {
        /* try next */
      }
    }
  }

  if (file.downloadUrl) {
    try {
      const result = await downloadViaMediaUrl(file.downloadUrl);
      const path = storagePathFromDownloadUrl(file.downloadUrl) || candidates[0];
      return { ...result, storagePath: path, source: 'media-url' };
    } catch {
      /* fall through */
    }
  }

  throw new Error(`storage-object-not-found:${tried.slice(0, 6).join('|') || 'no-candidates'}`);
}
