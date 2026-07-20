import { getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';
import { storage, storageBuckets } from '../../lib/firebase';
import { requireIdToken } from './apiHelpers';
import { fileDownloadUrl, safeStorageFileName, type StoredFile } from './fileTypes';

export const FILES_ACCESS_VERSION = 'simple-v8';

/** Absolute max time for any preview/download resolve — never hang the UI. */
const HARD_DEADLINE_MS = 8_000;
const ONE_TRY_MS = 3_000;

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

function candidatePaths(file: StoredFile, uid: string): string[] {
  const paths: string[] = [];
  const add = (p?: string) => {
    if (p && !paths.includes(p)) paths.push(p);
  };
  if (file.downloadUrl) add(pathFromDownloadUrl(file.downloadUrl));
  add(file.storagePath);
  if (uid && file.id && file.name) {
    add(`users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`);
    add(`users/${uid}/files/${file.id}/${file.name}`);
  }
  return paths;
}

async function getUrlOnBucket(bucket: FirebaseStorage, path: string): Promise<string> {
  return withTimeout(getDownloadURL(ref(bucket, path)), ONE_TRY_MS, 'url-timeout');
}

/**
 * Resolve a working media URL quickly.
 * Order: stored downloadUrl → getDownloadURL on a few paths × 2 buckets.
 * Never runs listAll (that hung Chrome). Hard deadline HARD_DEADLINE_MS.
 */
export async function resolveMediaUrl(file: StoredFile, uid: string): Promise<string> {
  console.info(`[files] ${FILES_ACCESS_VERSION} resolveMediaUrl`, file.id);

  const deadline = Date.now() + HARD_DEADLINE_MS;
  const left = () => Math.max(500, deadline - Date.now());

  // 1) Instant: URL already in metadata (what Safari used successfully).
  const stored = fileDownloadUrl(file);
  if (stored) return stored;

  // 2) Quick getDownloadURL attempts — no listing.
  const paths = candidatePaths(file, uid).slice(0, 3);
  for (const bucket of storageBuckets) {
    for (const path of paths) {
      if (Date.now() >= deadline) break;
      try {
        const url = await withTimeout(getUrlOnBucket(bucket, path), left(), 'deadline');
        if (url) return url;
      } catch {
        /* next */
      }
    }
  }

  // 3) API json — once, short timeout.
  try {
    const { token } = await requireIdToken();
    const res = await withTimeout(
      fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}&format=json`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      left(),
      'api-timeout',
    );
    if (res.ok) {
      const data = (await res.json()) as { downloadUrl?: string };
      if (data.downloadUrl) return data.downloadUrl;
    }
  } catch {
    /* ignore */
  }

  throw new Error('MISSING_IN_STORAGE');
}

/** Image preview src — never hangs. */
export async function resolveImagePreviewSrc(file: StoredFile, uid: string): Promise<string> {
  return resolveMediaUrl(file, uid);
}

/** PDF/text: try same-origin proxy once, else media URL. */
export async function loadPreviewBlobUrl(file: StoredFile, uid: string): Promise<string> {
  console.info(`[files] ${FILES_ACCESS_VERSION} loadPreviewBlobUrl`, file.id);
  const deadline = Date.now() + HARD_DEADLINE_MS;
  const left = () => Math.max(500, deadline - Date.now());

  try {
    const { token } = await requireIdToken();
    const res = await withTimeout(
      fetch(
        `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      left(),
      'proxy-timeout',
    );
    if (res.ok) {
      const blob = await res.blob();
      const typed = file.type && blob.type !== file.type
        ? new Blob([blob], { type: file.type })
        : blob;
      return URL.createObjectURL(typed);
    }
  } catch {
    /* fall through to media URL */
  }

  const url = await resolveMediaUrl(file, uid);
  return url;
}

function triggerUrlDownload(url: string, fileName: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'download';
  a.rel = 'noopener';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Instant download — open media URL like Safari. No hanging proxy-first. */
export async function downloadStoredFile(file: StoredFile, uid: string): Promise<void> {
  console.info(`[files] ${FILES_ACCESS_VERSION} downloadStoredFile`, file.id);
  const url = await resolveMediaUrl(file, uid);
  triggerUrlDownload(url, file.name || 'download');
}

// Kept for FilesPage hydrate helper imports
export function clientStoragePath(file: StoredFile, uid: string): string | undefined {
  return candidatePaths(file, uid)[0];
}

export async function resolvePublicDownloadUrl(file: StoredFile, uid: string): Promise<string> {
  return resolveMediaUrl(file, uid);
}

export const PROXY_MAX_BYTES = 3_500_000;
