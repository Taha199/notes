import {
  getBlob,
  getDownloadURL,
  listAll,
  ref,
  type FirebaseStorage,
  type StorageReference,
} from 'firebase/storage';
import { storageBuckets } from '../../lib/firebase';
import { rtdbFetch } from '../../lib/rtdb';
import { readApiResponse, requireIdToken } from './apiHelpers';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

/** Bump when diagnosing deploy cache — visible in DevTools console. */
export const FILES_ACCESS_VERSION = 'direct-preview-v10';

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
    const bIdx = parts.indexOf('b');
    if (bIdx !== -1 && parts[bIdx + 1]) return decodeURIComponent(parts[bIdx + 1]);
  } catch {
    /* ignore */
  }
  return undefined;
}

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

export async function findLiveStorageRef(
  file: StoredFile,
  uid: string,
): Promise<{ storageRef: StorageReference; downloadUrl: string; storagePath: string } | null> {
  console.info(`[files] ${FILES_ACCESS_VERSION} findLiveStorageRef`, file.id, file.name);

  const urlBucket = file.downloadUrl ? bucketFromDownloadUrl(file.downloadUrl) : undefined;
  const orderedBuckets = [...storageBuckets];
  if (urlBucket) {
    orderedBuckets.sort((a, b) => {
      const aBucket = a.app.options.storageBucket || '';
      const bBucket = b.app.options.storageBucket || '';
      const normalized = urlBucket.replace(/\.firebasestorage\.app|\.appspot\.com/, '');
      const aMatch = aBucket === urlBucket || aBucket.includes(normalized) ? -1 : 0;
      const bMatch = bBucket === urlBucket || bBucket.includes(normalized) ? -1 : 0;
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

export async function resolvePublicDownloadUrl(file: StoredFile, uid: string): Promise<string> {
  const existing = fileDownloadUrl(file);
  if (existing) return existing;

  const { token } = await requireIdToken();
  const res = await withTimeout(
    fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}&format=json`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    RESOLVE_MS,
    'api-url-timeout',
  );
  const data = await readApiResponse<{ downloadUrl?: string; error?: string; details?: string }>(res);
  if (res.ok && data.downloadUrl) return data.downloadUrl;

  const live = await findLiveStorageRef(file, uid);
  if (live) return live.downloadUrl;

  throw new Error(data.details || data.error || `api:${res.status}`);
}

function ensureTypedBlob(blob: Blob, file: StoredFile): Blob {
  const type = file.type || blob.type;
  if (type && blob.type !== type) return new Blob([blob], { type });
  return blob;
}

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
      try {
        const res = await withTimeout(fetch(live.downloadUrl), 25_000, 'media-fetch');
        if (res.ok) return URL.createObjectURL(ensureTypedBlob(await res.blob(), file));
      } catch {
        /* fall through */
      }
      return live.downloadUrl;
    }
  }

  const { token } = await requireIdToken();
  const res = await withTimeout(
    fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    30_000,
    'preview-proxy-timeout',
  );
  if (res.ok) return URL.createObjectURL(ensureTypedBlob(await res.blob(), file));
  const message = await res.text();
  throw new Error(`proxy:${res.status} ${message.slice(0, 200)}`);
}

export async function resolveImagePreviewSrc(file: StoredFile, uid: string): Promise<string> {
  const stored = fileDownloadUrl(file);
  if (stored) return stored;
  return resolvePublicDownloadUrl(file, uid);
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

async function downloadViaAppProxy(file: StoredFile, fileName: string): Promise<void> {
  const { token } = await requireIdToken();
  const res = await withTimeout(
    fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}&format=attachment`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    45_000,
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
  throw new Error(`${res.status}:${message.slice(0, 120)}`);
}

export async function downloadStoredFile(file: StoredFile, uid: string): Promise<void> {
  console.info(`[files] ${FILES_ACCESS_VERSION} downloadStoredFile`, file.id);
  const fileName = file.name || 'download';

  if (!file.size || file.size <= PROXY_MAX_BYTES) {
    try {
      await downloadViaAppProxy(file, fileName);
      return;
    } catch (err) {
      console.warn('[files] proxy download failed, falling back to media URL', err);
    }
  }

  const stored = fileDownloadUrl(file);
  if (stored) {
    triggerUrlDownload(stored, fileName);
    return;
  }

  const live = await findLiveStorageRef(file, uid);
  if (live?.downloadUrl) {
    triggerUrlDownload(live.downloadUrl, fileName);
    return;
  }

  await downloadViaAppProxy(file, fileName);
}
