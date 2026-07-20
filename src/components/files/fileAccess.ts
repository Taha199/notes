import {
  getBlob,
  getDownloadURL,
  listAll,
  ref,
  type FirebaseStorage,
  type StorageReference,
} from 'firebase/storage';
import { storage, storageBuckets } from '../../lib/firebase';
import { rtdbFetch } from '../../lib/rtdb';
import { readApiResponse, requireIdToken } from './apiHelpers';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

/** Bump when diagnosing deploy cache — visible in DevTools console. */
export const FILES_ACCESS_VERSION = 'dual-bucket-v7';

const RESOLVE_MS = 12_000;
export const PROXY_MAX_BYTES = 3_500_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function pathFromDownloadUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf('/o/');
    if (idx === -1) return undefined;
    const encoded = u.pathname.slice(idx + 3);
    return encoded ? decodeURIComponent(encoded) : undefined;
  } catch {
    return undefined;
  }
}

function bucketFromDownloadUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    // /v0/b/{bucket}/o/...
    const bIdx = parts.indexOf('b');
    if (bIdx !== -1 && parts[bIdx + 1]) return decodeURIComponent(parts[bIdx + 1]);
  } catch {
    /* ignore */
  }
  return undefined;
}

/** Every plausible Storage object path for this metadata row. */
export function candidateStoragePaths(file: StoredFile, uid: string): string[] {
  const paths: string[] = [];
  const add = (p?: string) => {
    if (p && !paths.includes(p)) paths.push(p);
  };

  if (file.downloadUrl) add(pathFromDownloadUrl(file.downloadUrl));
  add(file.storagePath);

  if (uid && file.id && file.name) {
    const safe = safeStorageFileName(file.name);
    add(`users/${uid}/files/${file.id}/${safe}`);
    add(`users/${uid}/files/${file.id}/${file.name}`);
    const underscored = file.name.replace(/\s+/g, '_');
    if (underscored !== file.name) {
      add(`users/${uid}/files/${file.id}/${underscored}`);
      add(`users/${uid}/files/${file.id}/${safeStorageFileName(underscored)}`);
    }
  }
  return paths;
}

export function clientStoragePath(file: StoredFile, uid: string): string | undefined {
  return candidateStoragePaths(file, uid)[0];
}

async function healFileMeta(file: StoredFile, uid: string, storagePath: string, downloadUrl: string) {
  if (file.storagePath === storagePath && file.downloadUrl === downloadUrl) return;
  try {
    const payload = { ...file, storagePath, downloadUrl };
    delete payload.dataUrl;
    delete payload.accessError;
    await rtdbFetch(`/users/${uid}/files/${file.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.warn('[files] heal meta failed', err);
  }
}

async function tryPathOnBucket(
  bucket: FirebaseStorage,
  path: string,
  file: StoredFile,
  uid: string,
): Promise<{ storageRef: StorageReference; downloadUrl: string; storagePath: string } | null> {
  try {
    const storageRef = ref(bucket, path);
    const downloadUrl = await withTimeout(getDownloadURL(storageRef), RESOLVE_MS, 'getDownloadURL');
    console.info('[files] found', { path, bucket: bucket.app.options.storageBucket });
    void healFileMeta(file, uid, path, downloadUrl);
    return { storageRef, downloadUrl, storagePath: path };
  } catch {
    return null;
  }
}

/**
 * Find a live Storage ref across BOTH buckets (legacy appspot + firebasestorage.app).
 */
export async function findLiveStorageRef(
  file: StoredFile,
  uid: string,
): Promise<{ storageRef: StorageReference; downloadUrl: string; storagePath: string } | null> {
  console.info(`[files] ${FILES_ACCESS_VERSION} findLiveStorageRef`, file.id, file.name);

  // If downloadUrl names a bucket, try that bucket first.
  const urlBucket = file.downloadUrl ? bucketFromDownloadUrl(file.downloadUrl) : undefined;
  const orderedBuckets = [...storageBuckets];
  if (urlBucket) {
    orderedBuckets.sort((a, b) => {
      const aMatch = (a.app.options.storageBucket || '').includes(urlBucket.replace(/\.firebasestorage\.app|\.appspot\.com/, '')) ||
        a.app.options.storageBucket === urlBucket ? -1 : 0;
      const bMatch = b.app.options.storageBucket === urlBucket ? -1 : 0;
      return aMatch - bMatch;
    });
  }

  const paths = candidateStoragePaths(file, uid);
  for (const bucket of orderedBuckets) {
    for (const path of paths) {
      const hit = await tryPathOnBucket(bucket, path, file, uid);
      if (hit) return hit;
    }
  }

  // listAll on each bucket under this file id
  for (const bucket of orderedBuckets) {
    try {
      const folderRef = ref(bucket, `users/${uid}/files/${file.id}`);
      const listed = await withTimeout(listAll(folderRef), RESOLVE_MS, 'listAll');
      for (const item of listed.items) {
        try {
          const downloadUrl = await withTimeout(getDownloadURL(item), RESOLVE_MS, 'getDownloadURL-listed');
          console.info('[files] found via listAll', item.fullPath, bucket.app.options.storageBucket);
          void healFileMeta(file, uid, item.fullPath, downloadUrl);
          return { storageRef: item, downloadUrl, storagePath: item.fullPath };
        } catch {
          /* next */
        }
      }
    } catch (err) {
      console.warn('[files] listAll failed', bucket.app.options.storageBucket, err);
    }
  }

  // Broad name search on both buckets
  const want = new Set(
    [file.name, safeStorageFileName(file.name), file.name.replace(/\s+/g, '_')].filter(Boolean),
  );
  const wantLower = new Set([...want].map((s) => s.toLowerCase()));

  for (const bucket of orderedBuckets) {
    try {
      const rootRef = ref(bucket, `users/${uid}/files`);
      const rootListed = await withTimeout(listAll(rootRef), RESOLVE_MS, 'listAll-root');
      for (const prefix of rootListed.prefixes) {
        try {
          const sub = await withTimeout(listAll(prefix), 8_000, 'listAll-sub');
          for (const item of sub.items) {
            if (!want.has(item.name) && !wantLower.has(item.name.toLowerCase())) continue;
            try {
              const downloadUrl = await withTimeout(getDownloadURL(item), RESOLVE_MS, 'getDownloadURL-broad');
              console.info('[files] found via broad list', item.fullPath);
              void healFileMeta(file, uid, item.fullPath, downloadUrl);
              return { storageRef: item, downloadUrl, storagePath: item.fullPath };
            } catch {
              /* next */
            }
          }
        } catch {
          /* next prefix */
        }
      }
    } catch (err) {
      console.warn('[files] broad list failed', bucket.app.options.storageBucket, err);
    }
  }

  return null;
}

/** Resolve a working media URL via SDK first, then API. */
export async function resolvePublicDownloadUrl(file: StoredFile, uid: string): Promise<string> {
  const live = await findLiveStorageRef(file, uid);
  if (live) return live.downloadUrl;

  const existing = fileDownloadUrl(file);
  if (existing) {
    // May be stale — still return as last local guess before API.
    try {
      const probe = await withTimeout(fetch(existing, { method: 'HEAD' }), 8_000, 'head-probe');
      if (probe.ok || probe.status === 405) return existing;
    } catch {
      /* continue */
    }
  }

  const { token } = await requireIdToken();
  const res = await withTimeout(
    fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}&format=json`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    RESOLVE_MS,
    'api-url-timeout',
  );
  const data = await readApiResponse<{ downloadUrl?: string; error?: string; details?: string }>(res);
  if (!res.ok) {
    throw new Error(data.details || data.error || `api:${res.status}`);
  }
  if (!data.downloadUrl) throw new Error('no-download-url');
  return data.downloadUrl;
}

function ensureTypedBlob(blob: Blob, file: StoredFile): Blob {
  const type = file.type || blob.type;
  if (type && blob.type !== type) return new Blob([blob], { type });
  return blob;
}

/**
 * Load bytes for preview. SDK getBlob / listAll first — API proxy only as fallback.
 * Returns a blob object URL — caller must revoke it.
 */
export async function loadPreviewBlobUrl(file: StoredFile, uid: string): Promise<string> {
  console.info(`[files] ${FILES_ACCESS_VERSION} loadPreviewBlobUrl`, file.id);

  const live = await findLiveStorageRef(file, uid);
  if (live) {
    try {
      const blob = ensureTypedBlob(
        await withTimeout(getBlob(live.storageRef), 25_000, 'getBlob'),
        file,
      );
      return URL.createObjectURL(blob);
    } catch (err) {
      console.warn('[files] getBlob failed, using downloadUrl for preview', err);
      // Images can use the media URL directly; for PDF Chrome needs a blob — try fetch.
      try {
        const res = await withTimeout(fetch(live.downloadUrl), 25_000, 'media-fetch');
        if (res.ok) {
          return URL.createObjectURL(ensureTypedBlob(await res.blob(), file));
        }
      } catch {
        /* fall through to return URL as object-less — caller for images can use href */
      }
      // Last resort for images: use the media URL itself (no blob).
      return live.downloadUrl;
    }
  }

  // API proxy fallback
  try {
    const { token } = await requireIdToken();
    const res = await withTimeout(
      fetch(
        `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      30_000,
      'preview-proxy-timeout',
    );
    if (res.ok) {
      return URL.createObjectURL(ensureTypedBlob(await res.blob(), file));
    }
    const message = await res.text();
    throw new Error(`proxy:${res.status} ${message.slice(0, 200)}`);
  } catch (err) {
    throw new Error(
      `MISSING_IN_STORAGE:${file.id}:${file.name}:${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * For image preview: prefer a direct media URL (no CORS blob needed).
 */
export async function resolveImagePreviewSrc(file: StoredFile, uid: string): Promise<string> {
  // Same as Safari: prefer a live media URL in <img src>, no blob/CORS needed.
  const live = await findLiveStorageRef(file, uid);
  if (live) return live.downloadUrl;

  const stored = fileDownloadUrl(file);
  if (stored) return stored;

  return loadPreviewBlobUrl(file, uid);
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = fileName || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 2_000);
}

function triggerUrlDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName || 'download';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Download via the same method Safari used successfully: a live Firebase media URL.
 * Prefer getDownloadURL / stored downloadUrl — do NOT require the API proxy path to exist.
 */
export async function downloadStoredFile(file: StoredFile, uid: string): Promise<void> {
  console.info(`[files] ${FILES_ACCESS_VERSION} downloadStoredFile`, file.id);
  const fileName = file.name || 'download';

  // 1) Safari-style: resolve a live media URL and navigate/download it.
  try {
    const live = await findLiveStorageRef(file, uid);
    if (live?.downloadUrl) {
      try {
        const blob = await withTimeout(getBlob(live.storageRef), 45_000, 'getBlob-download');
        triggerBlobDownload(ensureTypedBlob(blob, file), fileName);
        return;
      } catch (err) {
        console.warn('[files] getBlob failed — opening media URL like Safari', err);
        triggerUrlDownload(live.downloadUrl, fileName);
        return;
      }
    }
  } catch (err) {
    console.warn('[files] SDK resolve failed', err);
  }

  // 2) Stored downloadUrl (may still work even when reconstructed paths 404)
  const stored = fileDownloadUrl(file);
  if (stored) {
    try {
      const mediaRes = await withTimeout(fetch(stored), 45_000, 'stored-url-fetch');
      if (mediaRes.ok) {
        triggerBlobDownload(ensureTypedBlob(await mediaRes.blob(), file), fileName);
        return;
      }
    } catch {
      /* fall through — open URL anyway (Safari did this) */
    }
    triggerUrlDownload(stored, fileName);
    return;
  }

  // 3) API fallback
  const { token } = await requireIdToken();
  const res = await withTimeout(
    fetch(
      `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=attachment`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    60_000,
    'download-proxy-timeout',
  );

  if (res.ok) {
    triggerBlobDownload(await res.blob(), fileName);
    return;
  }

  if (res.status === 413) {
    const data = await readApiResponse<{ downloadUrl?: string }>(res).catch(() => ({} as { downloadUrl?: string }));
    if (data.downloadUrl) {
      triggerUrlDownload(data.downloadUrl, fileName);
      return;
    }
  }

  const message = await res.text().catch(() => '');
  throw new Error(`MISSING_IN_STORAGE:${file.id}:${file.name}:${res.status}:${message.slice(0, 120)}`);
}
