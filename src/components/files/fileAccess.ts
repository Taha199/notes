import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { readApiResponse, requireIdToken } from './apiHelpers';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

const RESOLVE_MS = 12_000;
/** Vercel Hobby response body limit ~4.5MB — stay under it. */
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

export function clientStoragePath(file: StoredFile, uid: string): string | undefined {
  if (file.storagePath) return file.storagePath;
  if (file.downloadUrl) {
    try {
      const u = new URL(file.downloadUrl);
      const idx = u.pathname.indexOf('/o/');
      if (idx !== -1) {
        const encoded = u.pathname.slice(idx + 3);
        if (encoded) return decodeURIComponent(encoded);
      }
    } catch {
      /* ignore */
    }
  }
  if (uid && file.id && file.name) {
    return `users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`;
  }
  return undefined;
}

/** Resolve a Firebase media URL (for large-file fallback / img src). */
export async function resolvePublicDownloadUrl(file: StoredFile, uid: string): Promise<string> {
  const existing = fileDownloadUrl(file);
  if (existing) return existing;

  const path = clientStoragePath(file, uid);
  if (path) {
    try {
      return await withTimeout(getDownloadURL(ref(storage, path)), RESOLVE_MS, 'sdk-url-timeout');
    } catch (err) {
      console.warn('[files] getDownloadURL failed', path, err);
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

/**
 * Load file bytes via authenticated same-origin API (preview).
 * Returns a blob object URL — caller must revoke it.
 */
export async function loadPreviewBlobUrl(file: StoredFile): Promise<string> {
  const { token } = await requireIdToken();

  const res = await withTimeout(
    fetch(
      `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    30_000,
    'preview-proxy-timeout',
  );

  if (res.status === 413) throw new Error('too-large-for-proxy');

  if (!res.ok) {
    const message = await res.text();
    throw new Error(`Preview failed: ${res.status} ${message.slice(0, 300)}`);
  }

  const blob = await res.blob();
  const type = file.type || blob.type;
  const typed = type && blob.type !== type ? new Blob([blob], { type }) : blob;
  return URL.createObjectURL(typed);
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

/**
 * Authenticated download — never relies on a bare <a href> to a stale Firebase URL.
 * Small files: streamed via API. Large files: resolve media URL then save.
 */
export async function downloadStoredFile(file: StoredFile, uid: string): Promise<void> {
  const { token } = await requireIdToken();
  const fileName = file.name || 'download';

  const res = await withTimeout(
    fetch(
      `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=attachment`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    60_000,
    'download-proxy-timeout',
  );

  if (res.ok) {
    const blob = await res.blob();
    triggerBlobDownload(blob, fileName);
    return;
  }

  // Too large for Vercel proxy → use downloadUrl from the 413 JSON body when present.
  if (res.status === 413) {
    try {
      const data = await readApiResponse<{ downloadUrl?: string }>(res);
      if (data.downloadUrl) {
        const anchor = document.createElement('a');
        anchor.href = data.downloadUrl;
        anchor.download = fileName;
        anchor.rel = 'noopener';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        return;
      }
    } catch {
      /* fall through to resolve */
    }
    const url = await resolvePublicDownloadUrl(file, uid);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  const message = await res.text();
  throw new Error(`Download failed: ${res.status} ${message.slice(0, 300)}`);
}
