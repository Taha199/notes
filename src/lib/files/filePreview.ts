import { getBytes, getDownloadURL, ref, type FirebaseStorage } from 'firebase/storage';
import mammoth from 'mammoth';
import { storageBuckets } from '../firebase';
import { getRtdbAuthToken } from '../rtdb';
import { candidateStoragePaths } from './filePaths';
import { dataUrlToBlob } from './fileStorage';
import {
  isMissingStorageError,
  previewModeFor,
  withTimeout,
  type StoredFile,
} from './fileTypes';

/** Stall timeout for CDN XHR — resets on progress so large PDFs aren't killed. */
const CDN_STALL_MS = 8_000;
/** Hard ceiling for a single CDN transfer (large files OK with progress). */
const CDN_HARD_MS = 90_000;
/** Dead-path probes (API / SDK) — fail fast so the race winner isn't blocked. */
const PROBE_MS = 5_000;
/** getDownloadURL per path — keep short; paths raced in parallel. */
const URL_RESOLVE_MS = 3_500;

function ensurePdfMime(blob: Blob, file: StoredFile): Blob {
  if (
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    && blob.type !== 'application/pdf'
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}

type AbortableBlob = {
  promise: Promise<Blob>;
  abort: () => void;
};

/** XHR fetch with progress + stall timeout (resets on bytes received). */
export function fetchBlobWithProgress(
  url: string,
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  stallMs = CDN_STALL_MS,
): AbortableBlob {
  let xhr: XMLHttpRequest | null = null;
  let settled = false;
  let stallTimer = 0;
  let hardTimer = 0;

  const abort = () => {
    if (settled) return;
    settled = true;
    window.clearTimeout(stallTimer);
    window.clearTimeout(hardTimer);
    try { xhr?.abort(); } catch { /* ignore */ }
  };

  const promise = new Promise<Blob>((resolve, reject) => {
    xhr = new XMLHttpRequest();

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      window.clearTimeout(hardTimer);
      try { xhr?.abort(); } catch { /* ignore */ }
      reject(err);
    };

    const bumpStall = () => {
      window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => fail(new Error('fetch-timeout')), stallMs);
    };

    bumpStall();
    hardTimer = window.setTimeout(() => fail(new Error('fetch-hard-timeout')), CDN_HARD_MS);

    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => {
      bumpStall();
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
      else if (file.size > 0) onProgress?.(e.loaded, file.size);
    };
    xhr.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      window.clearTimeout(hardTimer);
      if (xhr && xhr.status >= 200 && xhr.status < 300) {
        const blob = ensurePdfMime(xhr.response as Blob, file);
        onProgress?.(blob.size, blob.size);
        resolve(blob);
      } else {
        reject(new Error(`fetch-failed:${xhr?.status ?? 0}`));
      }
    };
    xhr.onerror = () => fail(new Error('fetch-network'));
    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(stallTimer);
      window.clearTimeout(hardTimer);
      reject(new Error('fetch-aborted'));
    };
    xhr.send();
  });

  return { promise, abort };
}

async function fetchBlobViaApi(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs = PROBE_MS,
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
      return fetchBlobWithProgress(data.downloadUrl, file, onProgress).promise;
    }
    throw new Error(data.error || 'MISSING_IN_STORAGE');
  }
  const blob = ensurePdfMime(await res.blob(), file);
  onProgress?.(blob.size, blob.size);
  return blob;
}

async function tryGetBytesOnce(path: string, timeoutMs: number): Promise<Blob | null> {
  // First successful bucket wins — single getBytes probe per bucket (no serial getBlob).
  return new Promise((resolve) => {
    let pending = storageBuckets.length;
    if (pending === 0) {
      resolve(null);
      return;
    }
    let done = false;
    for (const bucket of storageBuckets) {
      void withTimeout(getBytes(ref(bucket, path)), timeoutMs, 'getbytes-timeout')
        .then((bytes) => {
          if (!done) {
            done = true;
            resolve(new Blob([bytes]));
          }
        })
        .catch(() => {
          pending -= 1;
          if (!done && pending === 0) resolve(null);
        });
    }
  });
}

/** Parallel getDownloadURL across buckets — first success wins. */
async function tryExistingUrl(path: string, buckets: FirebaseStorage[]): Promise<string | null> {
  const results = await Promise.all(
    buckets.map(async (bucket) => {
      try {
        return await withTimeout(getDownloadURL(ref(bucket, path)), URL_RESOLVE_MS, 'url-timeout');
      } catch {
        return null;
      }
    }),
  );
  return results.find((u): u is string => Boolean(u)) ?? null;
}

/** Parallel getDownloadURL across candidate paths — first success wins. */
async function resolveUrlFromPaths(paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const limited = paths.slice(0, 5);
  return new Promise((resolve) => {
    let pending = limited.length;
    let done = false;
    for (const path of limited) {
      void tryExistingUrl(path, storageBuckets).then((url) => {
        if (done) return;
        if (url) {
          done = true;
          resolve(url);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });
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
    const url = await resolveUrlFromPaths(paths);
    if (url) return url;
  }

  try {
    const token = await getRtdbAuthToken();
    if (token) {
      const res = await withTimeout(
        fetch(
          `/api/file-download?fileId=${encodeURIComponent(file.id)}&format=json`,
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        PROBE_MS + 2_000,
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
    const url = await resolveUrlFromPaths(paths);
    if (url) return url;
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

type RaceAttempt = {
  start: () => AbortableBlob | Promise<Blob>;
};

/**
 * First successful promise wins; abort/cancel losers immediately.
 * Rejects only when every attempt fails / times out.
 */
function raceFirstBlob(attempts: RaceAttempt[]): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (attempts.length === 0) {
      reject(new Error('no-file-source'));
      return;
    }
    let pending = attempts.length;
    let lastErr: unknown = new Error('no-file-source');
    let settled = false;
    const aborts: Array<() => void> = [];

    const finish = (blob: Blob) => {
      if (settled) return;
      settled = true;
      for (const a of aborts) {
        try { a(); } catch { /* ignore */ }
      }
      resolve(blob);
    };

    for (const attempt of attempts) {
      const started = attempt.start();
      if (started && typeof started === 'object' && 'promise' in started && 'abort' in started) {
        const ab = started as AbortableBlob;
        aborts.push(ab.abort);
        ab.promise.then(
          (blob) => finish(blob),
          (err) => {
            lastErr = err;
            pending -= 1;
            if (!settled && pending === 0) reject(lastErr);
          },
        );
      } else {
        (started as Promise<Blob>).then(
          (blob) => finish(blob),
          (err) => {
            lastErr = err;
            pending -= 1;
            if (!settled && pending === 0) reject(lastErr);
          },
        );
      }
    }
  });
}

/**
 * Load file bytes as a same-origin-friendly Blob (preview / legacy fallback only).
 * Prefer downloadUrl fetch OR getBytes in parallel race — first win, cancel loser.
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

  const attempts: RaceAttempt[] = [];

  if (downloadUrl && !downloadUrl.startsWith('data:') && !downloadUrl.startsWith('blob:')) {
    attempts.push({
      start: () => {
        const ab = fetchBlobWithProgress(downloadUrl, file, onProgress);
        return {
          promise: ab.promise.then((blob) => ensurePdfMime(blob, file)),
          abort: ab.abort,
        };
      },
    });
  }

  // API probe — short timeout; useful when CDN URL missing/stale.
  attempts.push({
    start: () => fetchBlobViaApi(file, onProgress, PROBE_MS).then((blob) => ensurePdfMime(blob, file)),
  });

  if (primaryPath) {
    attempts.push({
      start: async () => {
        const blob = await tryGetBytesOnce(primaryPath, PROBE_MS);
        if (!blob) throw new Error('getbytes-miss');
        onProgress?.(blob.size, blob.size);
        return ensurePdfMime(blob, file);
      },
    });
  }

  try {
    // Overall ceiling: CDN hard + small buffer (stall-based CDN won't hang forever).
    return await withTimeout(raceFirstBlob(attempts), CDN_HARD_MS + 5_000, 'preview-timeout');
  } catch (err) {
    // Last resort: resolve a fresh URL then fetch once.
    try {
      const resolved = await resolveFileDownloadUrl(file, uid);
      if (resolved && resolved !== downloadUrl) {
        return ensurePdfMime(
          await fetchBlobWithProgress(resolved, file, onProgress).promise,
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

/* ── Session blob URL cache (PDF / image recovery) ─────────────────────── */

type CachedPreview = { url: string; fileKey: string };
const previewBlobCache = new Map<string, CachedPreview>();
const previewInflight = new Map<string, Promise<string>>();

function previewCacheKey(file: StoredFile): string {
  return `${file.id}:${file.downloadUrl || ''}:${file.storagePath || ''}:${file.inlinePending ? '1' : '0'}`;
}

export function getCachedPreviewBlobUrl(file: StoredFile): string | null {
  const entry = previewBlobCache.get(file.id);
  if (!entry) return null;
  if (entry.fileKey !== previewCacheKey(file)) return null;
  return entry.url;
}

/** Revoke cached blob URL for one file (on delete) or all (optional). */
export function revokePreviewBlobCache(fileId?: string): void {
  if (fileId) {
    const entry = previewBlobCache.get(fileId);
    if (entry) {
      try { URL.revokeObjectURL(entry.url); } catch { /* ignore */ }
      previewBlobCache.delete(fileId);
    }
    previewInflight.delete(fileId);
    return;
  }
  for (const [id, entry] of previewBlobCache) {
    try { URL.revokeObjectURL(entry.url); } catch { /* ignore */ }
    previewBlobCache.delete(id);
  }
  previewInflight.clear();
}

/**
 * Create a same-origin blob: URL for PDF/image preview.
 * Chrome cannot embed Firebase attachment URLs in iframes — always use blob:.
 * Cached by fileId for the session so reopening preview is instant.
 */
export async function loadPreviewBlobUrl(
  file: StoredFile,
  onProgress?: (loaded: number, total: number) => void,
  uid?: string,
): Promise<string> {
  const cached = getCachedPreviewBlobUrl(file);
  if (cached) {
    onProgress?.(file.size || 1, file.size || 1);
    return cached;
  }

  const inflight = previewInflight.get(file.id);
  if (inflight) return inflight;

  const key = previewCacheKey(file);
  const work = (async () => {
    const blob = await loadFileBlob(file, onProgress, uid);
    const url = URL.createObjectURL(blob);
    const prev = previewBlobCache.get(file.id);
    if (prev && prev.url !== url) {
      try { URL.revokeObjectURL(prev.url); } catch { /* ignore */ }
    }
    previewBlobCache.set(file.id, { url, fileKey: key });
    return url;
  })();

  previewInflight.set(file.id, work);
  try {
    return await work;
  } finally {
    previewInflight.delete(file.id);
  }
}

/** Warm browser HTTP cache for an image CDN URL (hover / visible card). */
export function preloadImageUrl(href: string): void {
  const url = (href || '').trim();
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  } catch {
    /* ignore */
  }
}

/**
 * Cheap preview warm-up: images → Image() preload; PDFs/docx → start blob fetch into cache.
 * Safe to call on hover / IntersectionObserver; deduped via previewInflight.
 */
export function prefetchPreview(file: StoredFile, uid?: string): void {
  const mode = previewModeFor(file);
  if (mode === 'image') {
    const href = (file.downloadUrl || file.dataUrl || '').trim();
    if (href) preloadImageUrl(href);
    return;
  }
  if (mode === 'pdf' || mode === 'docx') {
    if (getCachedPreviewBlobUrl(file)) return;
    if (previewInflight.has(file.id)) return;
    // Skip huge files on hover to avoid saturating the network.
    if (file.size > 8 * 1024 * 1024) return;
    void loadPreviewBlobUrl(file, undefined, uid).catch(() => { /* ignore prefetch errors */ });
  }
}

/**
 * Background-heal missing downloadUrls after list load so the next download click is instant.
 * Resolves CDN URLs in small parallel batches; caller persists via onHealed.
 */
export async function healMissingDownloadUrls(
  files: StoredFile[],
  uid: string,
  onHealed: (file: StoredFile) => void,
  cancelled?: () => boolean,
): Promise<void> {
  const missing = files.filter((f) => {
    const url = (f.downloadUrl || '').trim();
    if (url && !url.startsWith('data:') && !url.startsWith('blob:')) return false;
    // Skip intentional inline RTDB files (Friday ≤7MB) — they have no CDN URL.
    if (f.inlinePending || f.dataUrl?.startsWith('data:')) return false;
    return Boolean(f.storagePath);
  });
  if (missing.length === 0) return;

  const concurrency = 3;
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, missing.length) }, async () => {
    while (i < missing.length) {
      if (cancelled?.()) return;
      const file = missing[i++];
      try {
        const url = await resolveFileDownloadUrl(file, uid);
        if (cancelled?.()) return;
        const healed = (url || '').trim();
        if (healed && healed !== (file.downloadUrl || '').trim()) {
          onHealed({ ...file, downloadUrl: healed });
        }
      } catch {
        /* leave missing; click path still heals */
      }
    }
  });
  await Promise.all(workers);
}
