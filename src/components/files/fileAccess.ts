import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { getRtdbAuthToken } from '../../lib/rtdb';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

const RESOLVE_MS = 10_000;

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

/** Resolve a public Firebase download URL. Never hangs longer than RESOLVE_MS. */
export async function resolvePublicDownloadUrl(file: StoredFile, uid: string): Promise<string> {
  const existing = fileDownloadUrl(file);
  if (existing) return existing;

  const path = clientStoragePath(file, uid);
  if (path) {
    try {
      return await withTimeout(getDownloadURL(ref(storage, path)), RESOLVE_MS, 'sdk-url-timeout');
    } catch {
      /* fall through */
    }
  }

  const token = await withTimeout(getRtdbAuthToken(), 8_000, 'auth-timeout');
  if (!token) throw new Error('no-token');
  const res = await withTimeout(
    fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    }),
    RESOLVE_MS,
    'api-url-timeout',
  );
  if (!res.ok) throw new Error(`api:${res.status}`);
  const data = (await res.json()) as { downloadUrl?: string };
  if (!data.downloadUrl) throw new Error('no-download-url');
  return data.downloadUrl;
}

/**
 * Load file bytes via same-origin API (no Firebase CORS).
 * Returns a blob object URL — caller must revoke it.
 */
export async function loadPreviewBlobUrl(file: StoredFile): Promise<string> {
  const token = await withTimeout(getRtdbAuthToken(), 8_000, 'auth-timeout');
  if (!token) throw new Error('no-token');

  const res = await withTimeout(
    fetch(
      `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    25_000,
    'proxy-timeout',
  );

  if (res.status === 413) throw new Error('too-large');
  if (!res.ok) throw new Error(`proxy:${res.status}`);

  const blob = await res.blob();
  const type = file.type || blob.type;
  const typed =
    type && blob.type !== type
      ? new Blob([blob], { type })
      : blob;
  return URL.createObjectURL(typed);
}
