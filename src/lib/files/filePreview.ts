import { getBlob, getBytes, getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';
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

/** Hard ceiling so preview never spins forever (SDK/XHR hangs). */
const PREVIEW_ATTEMPT_MS = 15_000;

function ensurePdfMime(blob: Blob, file: StoredFile): Blob {
  if (
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    && blob.type !== 'application/pdf'
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}

/** XHR fetch so we can report byte progress and abort on hang. */
export function fetchBlobWithProgress(
  url: string,
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs = PREVIEW_ATTEMPT_MS,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { xhr.abort(); } catch { /* ignore */ }
      reject(new Error('fetch-timeout'));
    }, timeoutMs);

    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      else if (file.size > 0) onProgress?.(e.loaded, file.size);
    };
    xhr.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) {
        const blob = ensurePdfMime(xhr.response as Blob, file);
        onProgress?.(blob.size, blob.size);
        resolve(blob);
      } else {
        reject(new Error(`fetch-failed:${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('fetch-network'));
    };
    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('fetch-aborted'));
    };
    xhr.send();
  });
}

async function fetchBlobViaApi(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs = PREVIEW_ATTEMPT_MS,
): Promise<Blob> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('no-token');
  const res = await withTimeout(
    fetch(
      `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=inline`,
      { headers: { Authorization: `Bearer ${token}` } },
    ),
    timeoutMs,
    'api-fetch-timeout',
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
      return fetchBlobWithProgress(data.downloadUrl, file, onProgress, timeoutMs);
    }
    throw new Error(data.error || 'MISSING_IN_STORAGE');
  }
  const blob = ensurePdfMime(await res.blob(), file);
  onProgress?.(blob.size, blob.size);
  return blob;
}

async function tryGetBytesOnce(path: string, timeoutMs: number): Promise<Blob | null> {
  for (const bucket of storageBuckets) {
    try {
      const bytes = await withTimeout(getBytes(ref(bucket, path)), timeoutMs, 'getbytes-timeout');
      return new Blob([bytes]);
    } catch {
      /* try getBlob on same bucket, then next */
    }
    try {
      return await withTimeout(getBlob(ref(bucket, path)), timeoutMs, 'getblob-timeout');
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
      return await withTimeout(getDownloadURL(ref(bucket, path)), 4_000, 'url-timeout');
    } catch {
      /* next */
    }
  }
  return null;
}

export type ResolveDownloadUrlOptions = {
  /** Skip returning the stored downloadUrl; mint/list a fresh CDN URL. */
  fresh?: boolean;
};

/**
 * Resolve a CDN download URL.
 * Default: stored downloadUrl → API format=json → getDownloadURL on candidate paths.
 * fresh: getDownloadURL first (remints token), then API — skips returning a stale stored URL.
 */
export async function resolveFileDownloadUrl(
  file: StoredFile,
  uid?: string,
  options?: ResolveDownloadUrlOptions,
): Promise<string | null> {
  const existing = (file.downloadUrl || '').trim();
  if (
    !options?.fresh
    && existing
    && !existing.startsWith('data:')
    && !existing.startsWith('blob:')
  ) {
    return existing;
  }

  const paths = candidateStoragePaths(file, uid);

  // Healing poisoned tokens: SDK getDownloadURL remints; the API returns metadata as-is.
  if (options?.fresh) {
    for (const path of paths.slice(0, 5)) {
      const url = await tryExistingUrl(path, storageBuckets);
      if (url) return url;
    }
  }

  try {
    const token = await getRtdbAuthToken();
    if (token) {
      const res = await withTimeout(
        fetch(
          `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=json`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        12_000,
        'resolve-api-timeout',
      );
      if (res.ok) {
        const data = await res.json() as { downloadUrl?: string | null };
        const url = (data.downloadUrl || '').trim();
        // When healing, ignore the same stored URL the API echoes back.
        if (url && (!options?.fresh || url !== existing)) return url;
      }
    }
  } catch {
    /* fall back to direct SDK resolution */
  }

  if (!options?.fresh) {
    for (const path of paths.slice(0, 5)) {
      const url = await tryExistingUrl(path, storageBuckets);
      if (url) return url;
    }
  }
  return null;
}

function clickDownloadAnchor(url: string, filename?: string, newTab = true): boolean {
  try {
    const a = document.createElement('a');
    a.href = url;
    if (newTab) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    if (filename) a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a Storage/CDN URL during a user gesture.
 * Chrome ignores cross-origin `<a download>`, so prefer window.open;
 * if that returns null (popup blocker), still try `<a target=_blank>` —
 * window.open===null alone is never treated as total failure.
 */
export function openDownloadUrlNow(href: string, filename?: string): boolean {
  const url = (href || '').trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;

  try {
    // Avoid noopener in windowFeatures — some browsers return null even on success.
    const win = window.open(url, '_blank');
    if (win) {
      try { win.opener = null; } catch { /* ignore */ }
      return true;
    }
  } catch {
    /* popup blocked or denied — continue */
  }

  // window.open null ≠ failure: try anchor in a new tab next.
  return clickDownloadAnchor(url, filename, true);
}

/**
 * Open a CDN URL, falling back to same-tab navigation when popups are blocked.
 * Use after awaits: window.open and target=_blank are often both denied once the
 * user-gesture token is spent — location.assign still starts the download.
 */
export function openOrNavigateToDownloadUrl(href: string, filename?: string): boolean {
  const url = (href || '').trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;

  try {
    const win = window.open(url, '_blank');
    if (win) {
      try { win.opener = null; } catch { /* ignore */ }
      return true;
    }
  } catch {
    /* continue */
  }

  // Try new-tab anchor, then always same-tab assign so we never silently no-op.
  clickDownloadAnchor(url, filename, true);
  try {
    navigateToDownloadUrl(url);
    return true;
  } catch {
    return clickDownloadAnchor(url, filename, false);
  }
}

/** Same-tab navigate — not popup-blocked; reliable after awaits. */
export function navigateToDownloadUrl(href: string): void {
  window.location.assign(href);
}

/**
 * First successful promise wins; losers are ignored.
 * Rejects only when every attempt fails / times out.
 */
function raceFirstBlob(attempts: Array<() => Promise<Blob>>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (attempts.length === 0) {
      reject(new Error('no-file-source'));
      return;
    }
    let pending = attempts.length;
    let lastErr: unknown = new Error('no-file-source');
    let settled = false;
    for (const start of attempts) {
      start().then(
        (blob) => {
          if (settled) return;
          settled = true;
          resolve(blob);
        },
        (err) => {
          lastErr = err;
          pending -= 1;
          if (!settled && pending === 0) reject(lastErr);
        },
      );
    }
  });
}

/**
 * Load file bytes as a same-origin-friendly Blob (preview / legacy fallback only).
 * Prefer downloadUrl fetch + API proxy in parallel with a short SDK getBytes race.
 * NEVER sequential multi-minute getBytes loops (c81f040 hang).
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

  const downloadUrl = (file.downloadUrl || '').trim();
  const paths = candidateStoragePaths(file, uid);
  const primaryPath = paths[0];

  const attempts: Array<() => Promise<Blob>> = [];

  if (downloadUrl && !downloadUrl.startsWith('data:') && !downloadUrl.startsWith('blob:')) {
    attempts.push(async () => {
      const blob = await fetchBlobWithProgress(downloadUrl, file, onProgress, PREVIEW_ATTEMPT_MS);
      return ensurePdfMime(blob, file);
    });
  }

  attempts.push(async () => {
    const blob = await fetchBlobViaApi(file, onProgress, PREVIEW_ATTEMPT_MS);
    return ensurePdfMime(blob, file);
  });

  if (primaryPath) {
    attempts.push(async () => {
      // Single short SDK probe — must not block the race for long.
      const blob = await tryGetBytesOnce(primaryPath, PREVIEW_ATTEMPT_MS);
      if (!blob) throw new Error('getbytes-miss');
      onProgress?.(blob.size, blob.size);
      return ensurePdfMime(blob, file);
    });
  }

  try {
    return await withTimeout(raceFirstBlob(attempts), PREVIEW_ATTEMPT_MS + 2_000, 'preview-timeout');
  } catch (err) {
    // Last resort: resolve a fresh URL then fetch once.
    try {
      const resolved = await resolveFileDownloadUrl(file, uid);
      if (resolved && resolved !== downloadUrl) {
        return ensurePdfMime(
          await fetchBlobWithProgress(resolved, file, onProgress, PREVIEW_ATTEMPT_MS),
          file,
        );
      }
    } catch {
      /* fall through */
    }
    if (isMissingStorageError(err)) throw new Error('MISSING_IN_STORAGE');
    throw err instanceof Error ? err : new Error('preview-failed');
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

/**
 * Fast download: navigate/open CDN URL immediately when available.
 * Heal missing/stale URLs via API + getDownloadURL before buffering bytes.
 * Blob path ONLY as last resort (legacy inline / recovery).
 */
export async function downloadStoredFile(file: StoredFile, uid?: string): Promise<void> {
  const existing = (file.downloadUrl || '').trim();
  if (existing && !existing.startsWith('data:') && !existing.startsWith('blob:')) {
    // openOrNavigate: window.open → <a target=_blank> → location.assign.
    // Never treat window.open===null as failure without the assign fallback.
    if (openOrNavigateToDownloadUrl(existing, file.name)) return;
  }

  if (file.dataUrl?.startsWith('data:')) {
    triggerBlobDownload(dataUrlToBlob(file.dataUrl), file.name);
    return;
  }

  // Heal: mint/list a CDN URL without downloading the full file body.
  let resolved: string | null = null;
  try {
    resolved = await resolveFileDownloadUrl(file, uid, {
      fresh: Boolean(existing),
    });
  } catch (err) {
    console.warn('download URL resolve failed', file.name, err);
  }

  const healed = (resolved || '').trim();
  if (healed && healed !== existing) {
    if (openOrNavigateToDownloadUrl(healed, file.name)) return;
  } else if (healed && !existing) {
    if (openOrNavigateToDownloadUrl(healed, file.name)) return;
  }

  // Legacy / recovery only — may buffer; never preferred when a CDN URL works.
  try {
    const blob = await loadFileBlob(file, undefined, uid);
    triggerBlobDownload(blob, file.name);
  } catch (err) {
    if (isMissingStorageError(err)) throw new Error('MISSING_IN_STORAGE');
    const reason = err instanceof Error ? err.message : String(err ?? 'unknown');
    throw new Error(`DOWNLOAD_FAILED:${file.name}:${reason}`);
  }
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
