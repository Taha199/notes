import {
  getBlob,
  getDownloadURL,
  listAll,
  ref,
  type StorageReference,
} from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { rtdbFetch } from '../../lib/rtdb';
import { readApiResponse, requireIdToken } from './apiHelpers';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

/** Bump when diagnosing deploy cache — visible in DevTools console. */
export const FILES_ACCESS_VERSION = 'sdk-first-v5';

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

/**
 * Find a live Storage ref for this file (SDK + listAll).
 * This is the source of truth — not the API proxy.
 */
export async function findLiveStorageRef(
  file: StoredFile,
  uid: string,
): Promise<{ storageRef: StorageReference; downloadUrl: string; storagePath: string } | null> {
  console.info(`[files] ${FILES_ACCESS_VERSION} findLiveStorageRef`, file.id, file.name);

  for (const path of candidateStoragePaths(file, uid)) {
    try {
      const storageRef = ref(storage, path);
      const downloadUrl = await withTimeout(getDownloadURL(storageRef), RESOLVE_MS, 'getDownloadURL');
      console.info('[files] found via path', path);
      void healFileMeta(file, uid, path, downloadUrl);
      return { storageRef, downloadUrl, storagePath: path };
    } catch {
      /* try next */
    }
  }

  // List whatever actually exists under this file id folder.
  try {
    const folderRef = ref(storage, `users/${uid}/files/${file.id}`);
    const listed = await withTimeout(listAll(folderRef), RESOLVE_MS, 'listAll');
    for (const item of listed.items) {
      try {
        const downloadUrl = await withTimeout(getDownloadURL(item), RESOLVE_MS, 'getDownloadURL-listed');
        console.info('[files] found via listAll', item.fullPath);
        void healFileMeta(file, uid, item.fullPath, downloadUrl);
        return { storageRef: item, downloadUrl, storagePath: item.fullPath };
      } catch {
        /* try next item */
      }
    }
  } catch (err) {
    console.warn('[files] listAll failed', err);
  }

  // Broad search under users/{uid}/files/*/{filename}
  try {
    const rootRef = ref(storage, `users/${uid}/files`);
    const rootListed = await withTimeout(listAll(rootRef), RESOLVE_MS, 'listAll-root');
    const want = new Set(
      [
        file.name,
        safeStorageFileName(file.name),
        file.name.replace(/\s+/g, '_'),
      ].filter(Boolean),
    );
    const wantLower = new Set([...want].map((s) => s.toLowerCase()));
    for (const prefix of rootListed.prefixes) {
      try {
        const sub = await withTimeout(listAll(prefix), 8_000, 'listAll-sub');
        for (const item of sub.items) {
          if (!want.has(item.name) && !wantLower.has(item.name.toLowerCase())) continue;
          try {
            const downloadUrl = await withTimeout(getDownloadURL(item), RESOLVE_MS, 'getDownloadURL-broad');
            console.info('[files] found via broad listAll', item.fullPath);
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
    console.warn('[files] broad listAll failed', err);
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
  const live = await findLiveStorageRef(file, uid);
  if (live) return live.downloadUrl;
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
 * Download via Firebase SDK first. API proxy only if SDK cannot find the object.
 */
export async function downloadStoredFile(file: StoredFile, uid: string): Promise<void> {
  console.info(`[files] ${FILES_ACCESS_VERSION} downloadStoredFile`, file.id);
  const fileName = file.name || 'download';

  const live = await findLiveStorageRef(file, uid);
  if (live) {
    try {
      const blob = await withTimeout(getBlob(live.storageRef), 60_000, 'getBlob-download');
      triggerBlobDownload(ensureTypedBlob(blob, file), fileName);
      return;
    } catch (err) {
      console.warn('[files] getBlob download failed, opening media URL', err);
      triggerUrlDownload(live.downloadUrl, fileName);
      return;
    }
  }

  // API fallback
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
