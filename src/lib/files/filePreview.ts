import { getBlob, getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';
import mammoth from 'mammoth';
import { storageBuckets } from '../firebase';
import { getRtdbAuthToken } from '../rtdb';
import { candidateStoragePaths } from './filePaths';
import { dataUrlToBlob } from './fileStorage';
import {
  isMissingStorageError,
  withTimeout,
  type StoredFile,
} from './fileTypes';

function ensurePdfMime(blob: Blob, file: StoredFile): Blob {
  if (
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    && blob.type !== 'application/pdf'
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}

/** XHR fetch so we can report byte progress. */
export function fetchBlobWithProgress(
  url: string,
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      else if (file.size > 0) onProgress?.(e.loaded, file.size);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = ensurePdfMime(xhr.response as Blob, file);
        onProgress?.(blob.size, blob.size);
        resolve(blob);
      } else {
        reject(new Error(`fetch-failed:${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('fetch-network'));
    xhr.send();
  });
}

async function fetchBlobViaApi(file: StoredFile): Promise<Blob> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('no-token');
  const res = await fetch(
    `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) {
    const body = await res.json().catch(() => ({})) as { error?: string; hasInlineDataUrl?: boolean };
    if (body.error === 'storage-object-not-found' && !body.hasInlineDataUrl) {
      throw new Error('MISSING_IN_STORAGE');
    }
    throw new Error(body.error || 'MISSING_IN_STORAGE');
  }
  if (!res.ok) throw new Error(`api-fetch-failed:${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json() as { error?: string; downloadUrl?: string };
    if (data.downloadUrl) {
      return fetchBlobWithProgress(data.downloadUrl, file);
    }
    throw new Error(data.error || 'MISSING_IN_STORAGE');
  }
  return ensurePdfMime(await res.blob(), file);
}

async function tryGetBlobOnBuckets(path: string): Promise<Blob | null> {
  for (const bucket of storageBuckets) {
    try {
      return await withTimeout(getBlob(ref(bucket, path)), 8_000, 'getblob-timeout');
    } catch {
      /* try next bucket */
    }
  }
  return null;
}

/** Read existing download URL — does NOT remint Storage tokens. */
async function tryExistingUrl(path: string, buckets: FirebaseStorage[]): Promise<string | null> {
  for (const bucket of buckets) {
    try {
      return await withTimeout(getDownloadURL(ref(bucket, path)), 5_000, 'url-timeout');
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * Load file bytes as a same-origin-friendly Blob.
 * Order: dataUrl → downloadUrl → getBlob (both buckets) → existing URL → API
 * (API still reads RTDB dataUrl). Only then: MISSING_IN_STORAGE.
 */
export async function loadFileBlob(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  uid?: string,
): Promise<Blob> {
  if (file.dataUrl?.startsWith('data:')) {
    const blob = dataUrlToBlob(file.dataUrl);
    onProgress?.(blob.size, blob.size);
    return ensurePdfMime(blob, file);
  }

  if (file.downloadUrl) {
    try {
      return await fetchBlobWithProgress(file.downloadUrl, file, onProgress);
    } catch {
      /* fall through — URL may be stale */
    }
  }

  const paths = candidateStoragePaths(file, uid);
  for (const path of paths) {
    const blob = await tryGetBlobOnBuckets(path);
    if (blob) {
      onProgress?.(blob.size, blob.size);
      return ensurePdfMime(blob, file);
    }
  }

  for (const path of paths) {
    const url = await tryExistingUrl(path, storageBuckets);
    if (url) {
      try {
        return await fetchBlobWithProgress(url, file, onProgress);
      } catch {
        /* next */
      }
    }
  }

  try {
    const blob = await fetchBlobViaApi(file);
    onProgress?.(blob.size, blob.size);
    return blob;
  } catch (err) {
    if (isMissingStorageError(err)) throw new Error('MISSING_IN_STORAGE');
    throw err;
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadStoredFile(file: StoredFile, uid?: string): Promise<void> {
  const blob = await loadFileBlob(file, undefined, uid);
  triggerBlobDownload(blob, file.name);
}

export async function loadTextPreview(file: StoredFile, uid?: string): Promise<string> {
  if (file.dataUrl?.startsWith('data:')) {
    const match = file.dataUrl.match(/^data:([^,]*),(.*)$/s);
    if (!match) return '';
    const [, meta, payload] = match;
    if (meta.includes('base64')) return atob(payload);
    return decodeURIComponent(payload);
  }
  const blob = await loadFileBlob(file, undefined, uid);
  return blob.text();
}

/** Convert .docx to HTML via mammoth for in-app preview. */
export async function loadDocxHtml(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  uid?: string,
): Promise<string> {
  const blob = await loadFileBlob(file, onProgress, uid);
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  return result.value || '<p></p>';
}

/**
 * Create a same-origin blob: URL for PDF/image preview.
 * Chrome cannot embed Firebase attachment URLs in iframes — always use blob:.
 */
export async function loadPreviewBlobUrl(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  uid?: string,
): Promise<string> {
  const blob = await loadFileBlob(file, onProgress, uid);
  return URL.createObjectURL(blob);
}
