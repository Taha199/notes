import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import mammoth from 'mammoth';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { storage } from '../../lib/firebase';
import { getRtdbAuthToken, rtdbFetch } from '../../lib/rtdb';
import { getStorageLimitBytes } from '../../lib/storageQuota';

/**
 * Cap SDK retries so missing objects fail in ~90s (not the default ~2 min),
 * but still allow large PDF getBytes on slow links. Prior 12s budget made
 * getBytes abort while window.open(downloadUrl) still worked — preview died, download lived.
 */
storage.maxOperationRetryTime = 90_000;

interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  downloadUrl?: string;
  storagePath?: string;
  folderId?: string | null;
  /** Legacy uploads stored inline in Realtime Database */
  dataUrl?: string;
  /** Legacy inline file not yet migrated to Storage (blob withheld from the list). */
  inlinePending?: boolean;
}

/** Full file record after resolving Storage/RTDB fields needed for preview. */
interface ResolvedFile {
  href: string;
  storagePath?: string;
  dataUrl?: string;
}

interface FileFolder {
  id: string;
  name: string;
  createdAt: string;
}

type PreviewMode = 'image' | 'pdf' | 'docx' | 'text' | 'unsupported';

const FILE_INPUT_ID = 'files-upload-input';
const FILES_FOLDER_KEY = 'malacadhati_files_folder';
/** Floor for preview; large PDFs need a long getBytes window (never fail at 6–20s). */
const PREVIEW_TIMEOUT_MIN_MS = 60_000;
const PREVIEW_TIMEOUT_MAX_MS = 120_000;
/** Blob download fallback only — primary download streams via token URL. */
const DOWNLOAD_TIMEOUT_MS = 90_000;
const RESOLVE_TIMEOUT_MS = 12_000;
const UNSUPPORTED_AR = 'الملف غير مدعوم';

function previewBudgetMs(file: { size?: number }) {
  const size = typeof file.size === 'number' ? file.size : 0;
  // ~250 KB/s floor + 20s overhead, clamped (Firebase SDK getBytes is slower than CDN navigation).
  return Math.min(PREVIEW_TIMEOUT_MAX_MS, Math.max(PREVIEW_TIMEOUT_MIN_MS, size / 250 + 20_000));
}

/** Google Docs viewer can render Firebase token URLs that blank <embed> due to Content-Disposition: attachment. */
function googleDocsViewerUrl(fileUrl: string): string {
  return `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(fileUrl)}`;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeList<T extends { id: string }>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter((item): item is T => !!item && typeof item === 'object' && 'id' in item);
  }
  if (typeof data === 'object') {
    return Object.values(data as Record<string, T>).filter(
      (item) => !!item && typeof item === 'object' && 'id' in item,
    );
  }
  return [];
}

function previewModeFor(file: StoredFile): PreviewMode {
  const type = (file.type || '').toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/i.test(name)) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  // .docx can be rendered client-side; legacy .doc cannot reliably.
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.docx')
  ) return 'docx';
  if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html?)$/i.test(name)) return 'text';
  return 'unsupported';
}

/** Extract Storage object path from a Firebase download URL when metadata omitted storagePath. */
function storagePathFromDownloadUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encodedPath>?alt=media&token=...
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

function withTimeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function remainingMs(deadline: number) {
  return Math.max(400, deadline - Date.now());
}

function coerceMime(blob: Blob, mimeHint?: string): Blob {
  if (mimeHint && (!blob.type || blob.type === 'application/octet-stream')) {
    return new Blob([blob], { type: mimeHint });
  }
  return blob;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error('dataurl-failed');
  return res.blob();
}

/** Fetch bytes with a real AbortController so hung network cannot outlive the budget. */
async function fetchHrefAsBlob(href: string, timeoutMs: number, mimeHint?: string): Promise<Blob> {
  if (href.startsWith('data:')) return coerceMime(await dataUrlToBlob(href), mimeHint);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(href, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`fetch-failed:${res.status}`);
    const blob = await res.blob();
    return coerceMime(blob, mimeHint);
  } finally {
    window.clearTimeout(timer);
  }
}

/** Authenticated Storage SDK read — primary path for preview + download. */
async function storagePathToBlob(path: string, mimeHint?: string, timeoutMs = 30_000): Promise<Blob> {
  const bytes = await withTimeout(getBytes(ref(storage, path)), timeoutMs, 'getBytes-timeout');
  return new Blob([bytes], { type: mimeHint || 'application/octet-stream' });
}

/**
 * Ask the server to remint a Firebase download token / return storagePath / legacy dataUrl.
 * Bypasses broken client tokens and missing list metadata.
 */
async function refreshViaFileApi(fileId: string): Promise<ResolvedFile | null> {
  const token = await getRtdbAuthToken();
  if (!token) return null;
  const res = await fetch(`/api/file-download?fileId=${encodeURIComponent(fileId)}&mode=json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    downloadUrl?: string;
    storagePath?: string;
    dataUrl?: string;
  };
  const href = data.downloadUrl || data.dataUrl || '';
  if (!href && !data.storagePath) return null;
  return {
    href,
    storagePath: data.storagePath || (href ? storagePathFromDownloadUrl(href) : undefined),
    dataUrl: data.dataUrl,
  };
}

/** Proxy small files through the service-account API (Hobby size-capped server-side). */
async function proxyViaFileApi(fileId: string, timeoutMs: number, mimeHint?: string): Promise<Blob> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('no-token');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `/api/file-download?fileId=${encodeURIComponent(fileId)}&mode=proxy&disposition=inline`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
    );
    if (!res.ok) throw new Error(`proxy-failed:${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    // Server may return JSON {downloadUrl} when the file is too large to proxy.
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { downloadUrl?: string };
      if (!data.downloadUrl) throw new Error('proxy-too-large');
      return fetchHrefAsBlob(data.downloadUrl, timeoutMs, mimeHint);
    }
    return coerceMime(await res.blob(), mimeHint);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Load file bytes. Primary: authenticated getBytes(storagePath).
 * Then tokenized downloadUrl fetch, then service-account API, then dataUrl.
 * Never burns the whole budget on a hanging fetch before trying the SDK.
 */
async function loadFileBlob(
  resolved: ResolvedFile,
  mimeHint?: string,
  timeoutMs = PREVIEW_TIMEOUT_MIN_MS,
  fileId?: string,
): Promise<Blob> {
  const deadline = Date.now() + timeoutMs;
  if (resolved.dataUrl?.startsWith('data:')) {
    return coerceMime(await dataUrlToBlob(resolved.dataUrl), mimeHint);
  }

  const errors: unknown[] = [];
  let href = resolved.href;
  let path = resolved.storagePath || (href ? storagePathFromDownloadUrl(href) : undefined);

  // 1) Storage SDK first (auth + rules) — does not depend on download tokens or CORS.
  if (path) {
    try {
      return await storagePathToBlob(path, mimeHint, remainingMs(deadline));
    } catch (err) {
      errors.push(err);
    }
  }

  // 2) Tokenized Firebase URL (works when CORS allows; no auth needed).
  if (href && !href.startsWith('blob:')) {
    try {
      return await fetchHrefAsBlob(href, remainingMs(deadline), mimeHint);
    } catch (err) {
      errors.push(err);
    }
  }

  // 3) Server remints token / returns path, then retry SDK + fetch.
  if (fileId && remainingMs(deadline) > 1500) {
    try {
      const fresh = await withTimeout(refreshViaFileApi(fileId), remainingMs(deadline), 'api-refresh-timeout');
      if (fresh) {
        href = fresh.href || href;
        path = fresh.storagePath || path;
        if (fresh.dataUrl?.startsWith('data:')) {
          return coerceMime(await dataUrlToBlob(fresh.dataUrl), mimeHint);
        }
        if (path) {
          try {
            return await storagePathToBlob(path, mimeHint, remainingMs(deadline));
          } catch (err) {
            errors.push(err);
          }
        }
        if (href && !href.startsWith('blob:')) {
          try {
            return await fetchHrefAsBlob(href, remainingMs(deadline), mimeHint);
          } catch (err) {
            errors.push(err);
          }
        }
      }
    } catch (err) {
      errors.push(err);
    }

    // 4) Last resort: proxy bytes via service account (small files only).
    if (remainingMs(deadline) > 1500) {
      try {
        return await proxyViaFileApi(fileId, remainingMs(deadline), mimeHint);
      } catch (err) {
        errors.push(err);
      }
    }
  }

  throw errors[0] instanceof Error ? errors[0] : new Error('no-url');
}

/** Canonical Storage path used by uploadOneFile / my-files migration. */
function guessStoragePath(file: StoredFile, uid: string | undefined): string | undefined {
  if (!uid || !file.id || !file.name) return undefined;
  return `users/${uid}/files/${file.id}/${file.name}`;
}

/** Resolve download URL + storage path from list metadata, Storage, or RTDB. */
async function resolveFile(file: StoredFile, uid: string | undefined): Promise<ResolvedFile> {
  let result: ResolvedFile = {
    href: file.downloadUrl || file.dataUrl || '',
    storagePath:
      file.storagePath
      || (file.downloadUrl ? storagePathFromDownloadUrl(file.downloadUrl) : undefined)
      || guessStoragePath(file, uid),
    dataUrl: file.dataUrl,
  };

  if (!result.storagePath && result.href) {
    result = { ...result, storagePath: storagePathFromDownloadUrl(result.href) };
  }

  const ensureHrefFromStorage = async (budgetMs: number) => {
    if (result.href || !result.storagePath) return;
    try {
      result = {
        ...result,
        href: await withTimeout(
          getDownloadURL(ref(storage, result.storagePath)),
          budgetMs,
          'getDownloadURL-timeout',
        ),
      };
    } catch { /* ignore */ }
  };

  // Already have a tokenized URL (or data URL) — still recover storagePath above; skip RTDB.
  if (result.href && !file.inlinePending) {
    return result;
  }

  await ensureHrefFromStorage(RESOLVE_TIMEOUT_MS);

  // Backfill when list stripped the blob or left us without href/path.
  if ((!result.href || file.inlinePending || !result.storagePath) && uid) {
    try {
      const res = await withTimeout(
        rtdbFetch(`/users/${uid}/files/${file.id}`),
        RESOLVE_TIMEOUT_MS,
        'rtdb-timeout',
      );
      if (res.ok) {
        const full = (await res.json()) as StoredFile | null;
        if (full) {
          const href = result.href || full.downloadUrl || full.dataUrl || '';
          result = {
            href,
            storagePath:
              result.storagePath
              || full.storagePath
              || (full.downloadUrl ? storagePathFromDownloadUrl(full.downloadUrl) : undefined)
              || (href ? storagePathFromDownloadUrl(href) : undefined)
              || guessStoragePath(full, uid)
              || guessStoragePath(file, uid),
            dataUrl: result.dataUrl || full.dataUrl,
          };
          await ensureHrefFromStorage(RESOLVE_TIMEOUT_MS);
        }
      }
    } catch { /* ignore */ }
  }

  if (!result.storagePath) {
    result = {
      ...result,
      storagePath:
        (result.href ? storagePathFromDownloadUrl(result.href) : undefined)
        || guessStoragePath(file, uid),
    };
    if (!result.href) await ensureHrefFromStorage(RESOLVE_TIMEOUT_MS);
  }

  return result;
}

/** Same-origin blob: URLs honor the download attribute; cross-origin Firebase URLs do not. */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

/**
 * Open a tokenized Firebase (or other http) URL during the click gesture.
 * Must run BEFORE any await — popup blockers silently kill post-await window.open/_blank.
 * Avoid `noopener` in the windowFeatures string: browsers then return null even on success,
 * which previously made callers think open failed and chain into slow getBytes.
 */
function openDownloadUrlNow(href: string): boolean {
  if (!href || href.startsWith('data:') || href.startsWith('blob:')) return false;
  try {
    const win = window.open(href, '_blank');
    if (win) {
      try { win.opener = null; } catch { /* ignore */ }
      return true;
    }
  } catch { /* continue */ }
  try {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // <a target=_blank> during a user gesture usually works; callers must not also getBytes.
    return true;
  } catch {
    return false;
  }
}

/** After awaits: same-tab navigate is not popup-blocked (last resort). */
function navigateToDownloadUrl(href: string) {
  window.location.assign(href);
}

/** Service-account proxy with Content-Disposition: attachment → blob download (no popup). */
async function downloadViaApiAttachment(
  fileId: string,
  filename: string,
  timeoutMs: number,
): Promise<boolean> {
  const token = await getRtdbAuthToken();
  if (!token) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `/api/file-download?fileId=${encodeURIComponent(fileId)}&mode=proxy&disposition=attachment`,
      { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal },
    );
    if (!res.ok) return false;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = (await res.json()) as { downloadUrl?: string };
      if (!data.downloadUrl) return false;
      try {
        const blob = await fetchHrefAsBlob(data.downloadUrl, Math.min(timeoutMs, 60_000));
        triggerBlobDownload(blob, filename);
        return true;
      } catch {
        navigateToDownloadUrl(data.downloadUrl);
        return true;
      }
    }
    triggerBlobDownload(await res.blob(), filename);
    return true;
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Download MUST work even when preview fails — and must feel fast.
 * 1) Sync: open downloadUrl during the click gesture (no await) → return immediately.
 * 2) Resolve a token URL (getDownloadURL / API remint) and open/navigate — stream from CDN.
 * 3) Blob / proxy ONLY when open/navigation truly cannot start. Never getBytes after a successful open.
 */
async function downloadStoredFile(file: StoredFile, uid: string | undefined): Promise<void> {
  // 1) IMMEDIATE — preserve user gesture. Do NOT chain getBytes after this.
  if (file.downloadUrl && openDownloadUrlNow(file.downloadUrl)) {
    return;
  }

  if (file.dataUrl?.startsWith('data:')) {
    try {
      triggerBlobDownload(await dataUrlToBlob(file.dataUrl), file.name);
      return;
    } catch { /* fall through */ }
  }

  let resolved: ResolvedFile | null = null;
  try {
    resolved = await withTimeout(
      resolveFile(file, uid),
      RESOLVE_TIMEOUT_MS,
      'resolve-timeout',
    );
  } catch { /* continue */ }

  // 2) Prefer streaming via token URL (CDN) over downloading the whole file into memory.
  const tryOpenOrNavigate = (href: string): boolean => {
    if (!href || href.startsWith('data:') || href.startsWith('blob:')) return false;
    if (openDownloadUrlNow(href)) return true;
    try {
      navigateToDownloadUrl(href);
      return true;
    } catch {
      return false;
    }
  };

  if (resolved?.href && tryOpenOrNavigate(resolved.href)) {
    return;
  }

  if (resolved?.storagePath) {
    try {
      const url = await withTimeout(
        getDownloadURL(ref(storage, resolved.storagePath)),
        RESOLVE_TIMEOUT_MS,
        'getDownloadURL-timeout',
      );
      if (tryOpenOrNavigate(url)) return;
    } catch { /* fall through */ }
  }

  try {
    const fresh = await refreshViaFileApi(file.id);
    if (fresh?.dataUrl?.startsWith('data:')) {
      triggerBlobDownload(await dataUrlToBlob(fresh.dataUrl), file.name);
      return;
    }
    if (fresh?.href && tryOpenOrNavigate(fresh.href)) return;
    if (fresh?.storagePath) {
      const url = await withTimeout(
        getDownloadURL(ref(storage, fresh.storagePath)),
        RESOLVE_TIMEOUT_MS,
        'getDownloadURL-timeout',
      );
      if (tryOpenOrNavigate(url)) return;
    }
  } catch { /* fall through */ }

  // 3) Last resort: full-file blob (slow) — only when URL open/navigation failed.
  try {
    const forBlob = resolved || {
      href: file.downloadUrl || file.dataUrl || '',
      storagePath: file.storagePath || guessStoragePath(file, uid),
      dataUrl: file.dataUrl,
    };
    if (forBlob.href || forBlob.storagePath || forBlob.dataUrl) {
      const blob = await loadFileBlob(
        forBlob,
        file.type || undefined,
        DOWNLOAD_TIMEOUT_MS,
        file.id,
      );
      triggerBlobDownload(blob, file.name);
      return;
    }
  } catch { /* fall through */ }

  try {
    if (await downloadViaApiAttachment(file.id, file.name, DOWNLOAD_TIMEOUT_MS)) {
      return;
    }
  } catch { /* fall through */ }

  throw new Error('download-failed');
}

async function loadTextPreview(href: string, timeoutMs = PREVIEW_TIMEOUT_MIN_MS): Promise<string> {
  if (href.startsWith('data:')) {
    const match = href.match(/^data:([^,]*),(.*)$/s);
    if (!match) return '';
    const [, meta, payload] = match;
    if (meta.includes('base64')) return atob(payload);
    return decodeURIComponent(payload);
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(href, { signal: controller.signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error('fetch-failed');
    return res.text();
  } finally {
    window.clearTimeout(timer);
  }
}

function FilePreviewModal({
  file,
  uid,
  onClose,
  t,
}: {
  file: StoredFile;
  uid?: string;
  onClose: () => void;
  t: {
    filesDownload: string;
    filesPreviewUnavailable: string;
    filesPreviewFailed: string;
    filesDownloadFailed: string;
  };
}) {
  const mode = previewModeFor(file);
  const [previewSrc, setPreviewSrc] = useState('');
  /** PDF: 'blob' (local bytes), 'gview' (Google Docs), or '' while loading. */
  const [pdfKind, setPdfKind] = useState<'blob' | 'gview' | ''>('');
  const [resolving, setResolving] = useState(mode !== 'unsupported');
  const [failed, setFailed] = useState(mode === 'unsupported');
  const [textContent, setTextContent] = useState('');
  const [docxHtml, setDocxHtml] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const objectUrlRef = useRef<string | null>(null);
  const imageFallbackRef = useRef(false);
  const previewGenRef = useRef(0);
  const pdfHasFrameRef = useRef(false);

  const revokeObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  };

  // Network/load failures must NOT use the "unsupported type" copy — download still works.
  const errorMessage = failed
    ? (mode === 'unsupported' ? t.filesPreviewUnavailable : t.filesPreviewFailed)
    : '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Preview only — download is handled separately and never blocked by this effect.
  useEffect(() => {
    const gen = ++previewGenRef.current;
    let cancelled = false;
    let painted = false;
    const budget = previewBudgetMs(file);
    const deadline = Date.now() + budget;
    revokeObjectUrl();
    imageFallbackRef.current = false;
    pdfHasFrameRef.current = false;
    setPreviewSrc('');
    setPdfKind('');
    setTextContent('');
    setDocxHtml('');
    setDownloadError('');
    setFailed(mode === 'unsupported');
    setResolving(mode !== 'unsupported');

    if (mode === 'unsupported') {
      return () => { cancelled = true; };
    }

    const isLive = () => !cancelled && previewGenRef.current === gen;

    const showObjectUrl = (blob: Blob) => {
      const src = URL.createObjectURL(blob);
      if (!isLive()) {
        URL.revokeObjectURL(src);
        return;
      }
      revokeObjectUrl();
      objectUrlRef.current = src;
      setPreviewSrc(src);
      if (mode === 'pdf') setPdfKind('blob');
      setFailed(false);
      setResolving(false);
      painted = true;
      pdfHasFrameRef.current = true;
    };

    const paintDirect = (url: string) => {
      if (!isLive()) return;
      setPreviewSrc(url);
      setFailed(false);
      setResolving(false);
      painted = true;
    };

    const paintPdfGview = (href: string) => {
      if (!isLive() || !isHttpUrl(href)) return;
      // Speculative frame — Content-Disposition: attachment blanks native <embed>,
      // but Google Docs viewer fetches the token URL server-side.
      setPreviewSrc(googleDocsViewerUrl(href));
      setPdfKind('gview');
      setFailed(false);
      setResolving(false);
      pdfHasFrameRef.current = true;
    };

    const failPreview = () => {
      if (!isLive() || painted || pdfHasFrameRef.current) return;
      revokeObjectUrl();
      setPreviewSrc('');
      setPdfKind('');
      setDocxHtml('');
      setTextContent('');
      setFailed(true);
      setResolving(false);
    };

    (async () => {
      try {
        // Images: paint token URL immediately (fast). Blob only on <img> error.
        if (mode === 'image') {
          const quickHref = file.downloadUrl || file.dataUrl || '';
          if (quickHref && !quickHref.startsWith('blob:')) {
            paintDirect(quickHref);
            return;
          }
          const resolved = await withTimeout(
            resolveFile(file, uid),
            Math.min(RESOLVE_TIMEOUT_MS, remainingMs(deadline)),
            'resolve-timeout',
          );
          if (!isLive()) return;
          if (resolved.href || resolved.dataUrl) {
            paintDirect(resolved.href || resolved.dataUrl || '');
            return;
          }
          const blob = await loadFileBlob(
            resolved,
            file.type || undefined,
            remainingMs(deadline),
            file.id,
          );
          if (!isLive()) return;
          showObjectUrl(blob);
          return;
        }

        if (mode === 'pdf') {
          // Start from list metadata immediately — do not wait for resolve before getBytes / gview.
          const quickPath =
            file.storagePath
            || (file.downloadUrl ? storagePathFromDownloadUrl(file.downloadUrl) : undefined)
            || guessStoragePath(file, uid);
          const quickHref = file.downloadUrl || '';

          if (quickHref) paintPdfGview(quickHref);

          // Parallel: authenticated getBytes → blob iframe (preferred when it arrives).
          const bytesPromise = (async (): Promise<Blob | null> => {
            if (quickPath) {
              try {
                return await storagePathToBlob(quickPath, 'application/pdf', remainingMs(deadline));
              } catch { /* try full loader below */ }
            }
            try {
              const resolved = await withTimeout(
                resolveFile(file, uid),
                Math.min(RESOLVE_TIMEOUT_MS, remainingMs(deadline)),
                'resolve-timeout',
              );
              if (!isLive()) return null;
              if (resolved.href && !quickHref) paintPdfGview(resolved.href);
              return await loadFileBlob(
                resolved,
                'application/pdf',
                remainingMs(deadline),
                file.id,
              );
            } catch {
              return null;
            }
          })();

          const blob = await bytesPromise;
          if (!isLive()) return;
          if (blob) {
            showObjectUrl(coerceMime(blob, 'application/pdf'));
            return;
          }
          // Blob failed — keep gview if painted; else remint + gview once more.
          if (pdfHasFrameRef.current) {
            painted = true;
            setResolving(false);
            setFailed(false);
            return;
          }
          try {
            const fresh = await refreshViaFileApi(file.id);
            if (!isLive()) return;
            if (fresh?.href) {
              paintPdfGview(fresh.href);
              painted = true;
              setResolving(false);
              return;
            }
          } catch { /* ignore */ }
          failPreview();
          return;
        }

        const resolved = await withTimeout(
          resolveFile(file, uid),
          Math.min(RESOLVE_TIMEOUT_MS, remainingMs(deadline)),
          'resolve-timeout',
        );
        if (!isLive()) return;

        if (!resolved.href && !resolved.storagePath && !resolved.dataUrl) {
          const fresh = await refreshViaFileApi(file.id);
          if (!fresh?.href && !fresh?.storagePath && !fresh?.dataUrl) {
            failPreview();
            return;
          }
          Object.assign(resolved, fresh);
        }

        if (mode === 'docx') {
          const blob = await loadFileBlob(
            resolved,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            remainingMs(deadline),
            file.id,
          );
          if (!isLive()) return;
          const arrayBuffer = await blob.arrayBuffer();
          const result = await withTimeout(
            mammoth.convertToHtml({ arrayBuffer }),
            remainingMs(deadline),
            'mammoth-timeout',
          );
          if (!isLive()) return;
          setDocxHtml(result.value || `<p>${UNSUPPORTED_AR}</p>`);
          setFailed(false);
          setResolving(false);
          painted = true;
          return;
        }

        if (mode === 'text') {
          let body = '';
          if (resolved.dataUrl?.startsWith('data:')) {
            body = await loadTextPreview(resolved.dataUrl, remainingMs(deadline));
          } else if (resolved.href?.startsWith('data:')) {
            body = await loadTextPreview(resolved.href, remainingMs(deadline));
          } else {
            const blob = await loadFileBlob(
              resolved,
              'text/plain',
              remainingMs(deadline),
              file.id,
            );
            body = await blob.text();
          }
          if (!isLive()) return;
          setTextContent(body);
          setFailed(false);
          setResolving(false);
          painted = true;
          return;
        }

        failPreview();
      } catch {
        // PDF may already have a speculative gview frame — do not wipe it on late errors.
        if (mode === 'pdf' && pdfHasFrameRef.current) {
          painted = true;
          if (isLive()) {
            setResolving(false);
            setFailed(false);
          }
          return;
        }
        failPreview();
      } finally {
        if (isLive() && (painted || pdfHasFrameRef.current)) setResolving(false);
        else if (isLive() && !painted) setResolving(false);
      }
    })();

    const failsafe = window.setTimeout(() => {
      if (!isLive()) return;
      // Accept speculative gview rather than labeling a slow PDF as failed.
      if (pdfHasFrameRef.current) {
        painted = true;
        setResolving(false);
        setFailed(false);
        return;
      }
      if (!painted) failPreview();
    }, budget + 500);

    return () => {
      cancelled = true;
      window.clearTimeout(failsafe);
      revokeObjectUrl();
    };
  }, [file.id, file.downloadUrl, file.storagePath, file.dataUrl, file.type, file.name, file.size, uid, mode]);

  const onImageError = () => {
    if (imageFallbackRef.current || mode !== 'image') {
      setFailed(true);
      setResolving(false);
      return;
    }
    imageFallbackRef.current = true;
    setResolving(true);
    const deadline = Date.now() + previewBudgetMs(file);
    void (async () => {
      try {
        const resolved = await resolveFile(file, uid);
        const blob = await loadFileBlob(
          resolved,
          file.type || undefined,
          remainingMs(deadline),
          file.id,
        );
        const src = URL.createObjectURL(blob);
        revokeObjectUrl();
        objectUrlRef.current = src;
        setPreviewSrc(src);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setResolving(false);
      }
    })();
  };

  const onDownloadClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloadError('');
    // Sync open during the click gesture — before any await / setState yield.
    if (file.downloadUrl && openDownloadUrlNow(file.downloadUrl)) {
      return;
    }
    setDownloading(true);
    void (async () => {
      try {
        await downloadStoredFile(file, uid);
      } catch {
        setDownloadError(t.filesDownloadFailed);
        window.alert(t.filesDownloadFailed);
      } finally {
        setDownloading(false);
      }
    })();
  };

  const showPdf = mode === 'pdf' && !!previewSrc && !failed;
  const showImage = mode === 'image' && !!previewSrc && !failed;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-[10000] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 truncate text-sm font-semibold text-white">{file.name}</div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onDownloadClick}
            disabled={downloading}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-60"
          >
            {downloading ? '…' : t.filesDownload}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {downloadError && (
          <p className="mb-3 rounded-xl bg-red-500/20 px-4 py-2 text-center text-sm text-white" dir="auto">
            {downloadError}
          </p>
        )}
        {resolving && (
          <p className="absolute top-6 z-10 rounded-full bg-black/50 px-3 py-1 text-sm text-white/90">…</p>
        )}
        {!resolving && failed && (
          <p className="rounded-xl bg-white/10 px-4 py-3 text-center text-sm text-white" dir="auto">
            {errorMessage}
          </p>
        )}
        {showImage && (
          <img
            src={previewSrc}
            alt={file.name}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            onError={onImageError}
          />
        )}
        {showPdf && pdfKind === 'blob' && (
          <iframe
            title={file.name}
            src={previewSrc}
            className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
          />
        )}
        {showPdf && pdfKind === 'gview' && (
          <iframe
            title={file.name}
            src={previewSrc}
            className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
            allow="fullscreen"
          />
        )}
        {!resolving && !failed && mode === 'docx' && (
          <div
            className="prose prose-sm max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 text-left text-gray-900 shadow-2xl dark:prose-invert dark:bg-gray-900 dark:text-gray-100"
            // Mammoth output is generated locally from the user's own file bytes.
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        )}
        {!resolving && !failed && mode === 'text' && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {textContent}
          </pre>
        )}
      </div>
    </div>,
    document.body,
  );
}

function FilesLoadingIndicator({ text }: { text: string }) {
  const label = text.replace(/[.…]+\s*$/, '');
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="animate-files-loading-float text-4xl opacity-50" aria-hidden>☁️</span>
      <p className="flex items-center gap-0.5 text-sm font-medium">
        <span className="animate-files-loading-shimmer bg-gradient-to-r from-app-text-secondary via-primary to-app-text-secondary bg-[length:220%_100%] bg-clip-text text-transparent dark:from-gray-500 dark:via-primary/90 dark:to-gray-500">
          {label}
        </span>
        <span className="inline-flex min-w-[1.4rem] translate-y-px gap-px text-primary/80 dark:text-primary/90" aria-hidden>
          <span className="animate-files-loading-dot [animation-delay:0ms]">·</span>
          <span className="animate-files-loading-dot [animation-delay:180ms]">·</span>
          <span className="animate-files-loading-dot [animation-delay:360ms]">·</span>
        </span>
      </p>
    </div>
  );
}

export function FilesPage({ search }: { search: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { show } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const folderRenameRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() => {
    try {
      const raw = localStorage.getItem(FILES_FOLDER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameValue, setFolderRenameValue] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveMenuFileId, setMoveMenuFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<StoredFile | null>(null);

  useEffect(() => {
    localStorage.setItem(FILES_FOLDER_KEY, JSON.stringify(currentFolderId));
  }, [currentFolderId]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (renamingFolderId) folderRenameRef.current?.focus();
  }, [renamingFolderId]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setFiles([]);
      setFolders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      // Load compact metadata from the server (no base64 blobs sent to the browser);
      // the server also migrates legacy inline files to Storage, in batches.
      const fetchOnce = async (): Promise<boolean> => {
        const token = await getRtdbAuthToken();
        if (!token) throw new Error('no-token');
        const res = await fetch('/api/my-files', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error('load-failed');
        const data = (await res.json()) as {
          files?: StoredFile[];
          folders?: FileFolder[];
          migratedRemaining?: boolean;
        };
        if (cancelled) return false;
        setFiles(
          (data.files ?? []).sort(
            (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
          ),
        );
        setFolders(
          (data.folders ?? []).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          ),
        );
        return data.migratedRemaining === true;
      };
      try {
        let more = await fetchOnce();
        if (!cancelled) setLoading(false);
        // Continue migrating remaining legacy files in the background.
        let guard = 0;
        while (more && !cancelled && guard++ < 50) {
          more = await fetchOnce();
        }
      } catch {
        if (!cancelled) {
          // Fallback: read directly from the database (older path).
          try {
            const [filesRes, foldersRes] = await Promise.all([
              rtdbFetch(`/users/${user.uid}/files`),
              rtdbFetch(`/users/${user.uid}/fileFolders`),
            ]);
            const cloudFiles = await filesRes.json();
            const cloudFolders = await foldersRes.json();
            if (!cancelled) {
              setFiles(
                normalizeList<StoredFile>(cloudFiles).sort(
                  (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
                ),
              );
              setFolders(
                normalizeList<FileFolder>(cloudFolders).sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                ),
              );
            }
          } catch {
            if (!cancelled) {
              setFiles([]);
              setFolders([]);
            }
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folders]);

  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null;

  const fileCountInFolder = (folderId: string) =>
    files.filter((f) => f.folderId === folderId).length;

  const saveFileMeta = async (file: StoredFile) => {
    if (!user) throw new Error('no-user');
    const res = await rtdbFetch(`/users/${user.uid}/files/${file.id}`, {
      method: 'PUT',
      body: JSON.stringify(file),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('save-failed');
  };

  const saveFolderMeta = async (folder: FileFolder) => {
    if (!user) throw new Error('no-user');
    const res = await rtdbFetch(`/users/${user.uid}/fileFolders/${folder.id}`, {
      method: 'PUT',
      body: JSON.stringify(folder),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('save-failed');
  };

  const deleteFileMeta = async (fileId: string) => {
    if (!user) return;
    await rtdbFetch(`/users/${user.uid}/files/${fileId}`, { method: 'DELETE' });
  };

  const deleteFolderMeta = async (folderId: string) => {
    if (!user) return;
    await rtdbFetch(`/users/${user.uid}/fileFolders/${folderId}`, { method: 'DELETE' });
  };

  const q = search.trim().toLowerCase();

  const visibleFolders = useMemo(() => {
    if (currentFolderId) return [];
    const list = folders;
    if (!q) return list;
    return list.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, currentFolderId, q]);

  const visibleFiles = useMemo(() => {
    let list = files.filter((file) =>
      currentFolderId ? file.folderId === currentFolderId : !file.folderId,
    );
    if (q) {
      list = files.filter(
        (file) => file.name.toLowerCase().includes(q) || file.type.toLowerCase().includes(q),
      );
    }
    return list;
  }, [files, currentFolderId, q]);

  const MAX_FILE_SIZE = 20 * 1024 * 1024;

  const uploadOneFile = async (file: File, folderId: string | null): Promise<StoredFile> => {
    if (!user) throw new Error('no-user');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base: Omit<StoredFile, 'downloadUrl' | 'storagePath' | 'dataUrl' | 'folderId'> = {
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      addedAt: new Date().toLocaleString(),
    };

    const withFolder = folderId ? { ...base, folderId } : base;

    // Always store the blob in Firebase Storage — never inline base64 in the
    // Realtime Database (inline blobs made the file list download huge/slow).
    const storagePath = `users/${user.uid}/files/${id}/${file.name}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, { contentType: base.type });
    const downloadUrl = await getDownloadURL(storageRef);
    return { ...withFolder, downloadUrl, storagePath };
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!user) {
      setError(t.filesUploadFailed);
      return;
    }

    setError('');
    const selected = Array.from(list);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length) {
      setError(`${t.filesTooLarge} ${oversized.map((f) => f.name).join(', ')}`);
      return;
    }

    setUploading(true);
    const uploaded: StoredFile[] = [];
    try {
      // Quota: use in-memory file sizes + a small profile read (no full-tree download).
      let profile: Record<string, unknown> = {};
      try {
        const profRes = await rtdbFetch(`/users/${user.uid}/profile`);
        if (profRes.ok) profile = (await profRes.json()) ?? {};
      } catch {
        /* fall back to defaults */
      }
      const usedBytes = files.reduce((sum, f) => sum + (typeof f.size === 'number' ? f.size : 0), 0);
      const limitBytes = getStorageLimitBytes(profile, user.email);
      const incomingBytes = selected.reduce((sum, file) => sum + file.size, 0);
      if (usedBytes + incomingBytes > limitBytes) {
        setError(t.filesQuotaExceeded);
        return;
      }

      for (const file of selected) {
        const stored = await uploadOneFile(file, currentFolderId);
        await saveFileMeta(stored);
        uploaded.push(stored);
      }
      if (uploaded.length) {
        setFiles((prev) => [...uploaded, ...prev]);
        show(uploaded.length === 1 ? t.filesUploadSuccess : `${uploaded.length} ${t.filesUploadSuccess}`);
      }
    } catch (err) {
      console.error('File upload failed', err);
      setError(t.filesUploadFailed);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeFile = async (file: StoredFile) => {
    setError('');
    const previous = files;
    setFiles((prev) => prev.filter((item) => item.id !== file.id));
    if (previewFile?.id === file.id) setPreviewFile(null);
    if (renamingId === file.id) setRenamingId(null);
    if (moveMenuFileId === file.id) setMoveMenuFileId(null);
    try {
      if (file.storagePath) {
        await deleteObject(ref(storage, file.storagePath));
      }
      await deleteFileMeta(file.id);
    } catch {
      setFiles(previous);
      setError(t.filesSaveFailed);
    }
  };

  const moveFile = async (file: StoredFile, folderId: string | null) => {
    const updated: StoredFile = { ...file };
    if (folderId) updated.folderId = folderId;
    else delete updated.folderId;
    const previous = files;
    setFiles((prev) => prev.map((item) => (item.id === file.id ? updated : item)));
    setMoveMenuFileId(null);
    try {
      await saveFileMeta(updated);
      show(t.tMoved);
    } catch {
      setFiles(previous);
      setError(t.filesSaveFailed);
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !user) return;
    const folder: FileFolder = {
      id: `ff-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      createdAt: new Date().toLocaleString(),
    };
    try {
      await saveFolderMeta(folder);
      setFolders((prev) => [folder, ...prev]);
      setCreatingFolder(false);
      setNewFolderName('');
      show(t.filesFolderCreated);
    } catch {
      setError(t.filesSaveFailed);
    }
  };

  const removeFolder = async (folder: FileFolder) => {
    const previousFiles = files;
    const previousFolders = folders;
    const affected = files.filter((f) => f.folderId === folder.id);
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setFiles((prev) =>
      prev.map((f) => (f.folderId === folder.id ? { ...f, folderId: undefined } : f)),
    );
    if (currentFolderId === folder.id) setCurrentFolderId(null);
    try {
      await deleteFolderMeta(folder.id);
      await Promise.all(
        affected.map((f) => saveFileMeta({ ...f, folderId: undefined })),
      );
    } catch {
      setFiles(previousFiles);
      setFolders(previousFolders);
      setError(t.filesSaveFailed);
    }
  };

  const startRename = (file: StoredFile) => {
    setRenamingId(file.id);
    setRenameValue(file.name);
    setMoveMenuFileId(null);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const commitRename = async (file: StoredFile) => {
    const next = renameValue.trim();
    if (!next) {
      cancelRename();
      return;
    }
    if (next === file.name) {
      cancelRename();
      return;
    }

    const updated = { ...file, name: next };
    const previous = files;
    setFiles((prev) => prev.map((item) => (item.id === file.id ? updated : item)));
    if (previewFile?.id === file.id) setPreviewFile(updated);
    cancelRename();

    try {
      await saveFileMeta(updated);
      show(t.filesRenameSuccess);
    } catch {
      setFiles(previous);
      setError(t.filesSaveFailed);
    }
  };

  const startFolderRename = (folder: FileFolder) => {
    setRenamingFolderId(folder.id);
    setFolderRenameValue(folder.name);
  };

  const cancelFolderRename = () => {
    setRenamingFolderId(null);
    setFolderRenameValue('');
  };

  const commitFolderRename = async (folder: FileFolder) => {
    const next = folderRenameValue.trim();
    if (!next || next === folder.name) {
      cancelFolderRename();
      return;
    }
    const updated = { ...folder, name: next };
    const previous = folders;
    setFolders((prev) => prev.map((f) => (f.id === folder.id ? updated : f)));
    cancelFolderRename();
    try {
      await saveFolderMeta(updated);
      show(t.filesRenameSuccess);
    } catch {
      setFolders(previous);
      setError(t.filesSaveFailed);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!uploading) setDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!uploading) void handleFiles(e.dataTransfer.files);
  };

  const hasContent = visibleFolders.length > 0 || visibleFiles.length > 0;

  return (
    <div className="px-3 py-4 sm:px-5 sm:py-5">
      <div
        className={`mb-5 rounded-3xl border bg-white p-5 shadow-sm transition-colors dark:bg-white/5 ${
          dragging ? 'border-primary bg-primary/5 dark:border-primary/50' : 'border-app-border dark:border-white/10'
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl shadow-sm shadow-primary/10 dark:bg-primary/20">
              ☁️
            </div>
            <div>
              <h3 className="text-lg font-bold text-app-text dark:text-gray-100">{t.filesTitle}</h3>
              <p className="mt-1 text-sm text-app-text-secondary dark:text-gray-400">{t.filesSub}</p>
              <p className="mt-1 text-xs text-app-text-secondary/80 dark:text-gray-500">{t.filesSizeLimit}</p>
            </div>
          </div>
          <label
            htmlFor={FILE_INPUT_ID}
            className={`relative inline-flex cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark ${
              uploading ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
            }`}
          >
            <input
              ref={inputRef}
              id={FILE_INPUT_ID}
              type="file"
              multiple
              disabled={uploading}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              onChange={(e) => {
                void handleFiles(e.target.files);
              }}
            />
            <span className="pointer-events-none text-base">{uploading ? '☁️' : '☁️➕'}</span>
            <span className="pointer-events-none">{uploading ? t.cloudSaving : t.filesUpload}</span>
          </label>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCurrentFolderId(null)}
          className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold transition ${
            !currentFolderId
              ? 'bg-primary/10 text-primary'
              : 'text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/5'
          }`}
        >
          📎 {t.filesAllFiles}
        </button>
        {currentFolder && (
          <>
            <span className="text-app-text-secondary/40">/</span>
            <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary">
              📁 {currentFolder.name}
            </span>
          </>
        )}
        {!currentFolderId && !creatingFolder && (
          <button
            type="button"
            onClick={() => setCreatingFolder(true)}
            className="ml-auto rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary hover:bg-primary/10"
          >
            + {t.filesNewFolder}
          </button>
        )}
      </div>

      {creatingFolder && (
        <form
          className="mb-4 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void createFolder();
          }}
        >
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t.filesFolderNamePh}
            maxLength={80}
            autoFocus
            className="min-w-[180px] flex-1 rounded-xl border border-app-border bg-white px-3 py-2 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
          />
          <button type="submit" className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark">✓</button>
          <button
            type="button"
            onClick={() => { setCreatingFolder(false); setNewFolderName(''); }}
            className="rounded-xl border border-app-border px-3 py-2 text-xs text-app-text-secondary dark:border-white/10"
          >
            ✕
          </button>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          ⚠️ {error}
        </div>
      )}

      {loading || !hasContent ? (
        <div
          className={`animate-fade-in flex flex-col items-center rounded-3xl py-20 text-center text-app-text-secondary/70 transition-colors dark:text-gray-500 ${
            dragging ? 'bg-primary/5' : ''
          }`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {loading ? (
            <FilesLoadingIndicator text={t.filesLoading} />
          ) : (
            <>
              <span className="mb-3 text-5xl opacity-30">{currentFolderId ? '📁' : '📎'}</span>
              <p className="text-sm">
                {search ? t.emptySearch : currentFolderId ? t.filesFolderEmpty : t.filesEmpty}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {visibleFolders.map((folder) => (
            <div
              key={folder.id}
              className="rounded-2xl border border-app-border bg-white p-4 shadow-sm transition hover:border-primary/30 hover:shadow-md dark:border-white/10 dark:bg-white/5"
            >
              <button
                type="button"
                onClick={() => setCurrentFolderId(folder.id)}
                className="flex w-full items-start gap-3 text-left"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-2xl dark:bg-amber-500/20">📁</div>
                <div className="min-w-0 flex-1">
                  {renamingFolderId === folder.id ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void commitFolderRename(folder);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={folderRenameRef}
                        value={folderRenameValue}
                        onChange={(e) => setFolderRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelFolderRename(); }}
                        maxLength={80}
                        className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-bg px-2 py-1 text-sm font-semibold text-app-text outline-none focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                      <button type="submit" className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white">✓</button>
                    </form>
                  ) : (
                    <div className="truncate text-sm font-bold text-app-text dark:text-gray-100">{folder.name}</div>
                  )}
                  <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">
                    {fileCountInFolder(folder.id)} {t.filesInFolder}
                  </div>
                </div>
              </button>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => startFolderRename(folder)}
                  className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                >
                  {t.filesRename}
                </button>
                <button
                  type="button"
                  onClick={() => void removeFolder(folder)}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10"
                >
                  {t.filesFolderDelete}
                </button>
              </div>
            </div>
          ))}

          {visibleFiles.map((file) => (
            <div key={file.id} className="rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl text-primary">📄</div>
                <div className="min-w-0 flex-1">
                  {renamingId === file.id ? (
                    <form
                      className="flex items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void commitRename(file);
                      }}
                    >
                      <input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') cancelRename(); }}
                        maxLength={200}
                        className="min-w-0 flex-1 rounded-lg border border-app-border bg-app-bg px-2 py-1 text-sm font-semibold text-app-text outline-none focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                      />
                      <button type="submit" className="rounded-lg bg-primary px-2 py-1 text-xs font-semibold text-white hover:bg-primary-dark">✓</button>
                      <button type="button" onClick={cancelRename} className="rounded-lg border border-app-border px-2 py-1 text-xs text-app-text-secondary hover:bg-app-bg dark:border-white/15">✕</button>
                    </form>
                  ) : (
                    <div className="truncate text-sm font-bold text-app-text dark:text-gray-100" title={file.name}>{file.name}</div>
                  )}
                  <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">{formatSize(file.size)} · {t.filesStored}</div>
                  <div className="mt-0.5 truncate text-[11px] text-app-text-secondary/70 dark:text-gray-500">{file.addedAt}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewFile(file)}
                  className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                >
                  {t.filesPreview}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Sync open during the click gesture — before any await.
                    if (file.downloadUrl && openDownloadUrlNow(file.downloadUrl)) {
                      return;
                    }
                    void (async () => {
                      try {
                        await downloadStoredFile(file, user?.uid);
                      } catch {
                        show(t.filesDownloadFailed);
                        window.alert(t.filesDownloadFailed);
                      }
                    })();
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                >
                  {t.filesDownload}
                </button>
                <button
                  type="button"
                  onClick={() => startRename(file)}
                  className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                >
                  {t.filesRename}
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMoveMenuFileId(moveMenuFileId === file.id ? null : file.id)}
                    className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                  >
                    {t.filesMoveTo}
                  </button>
                  {moveMenuFileId === file.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setMoveMenuFileId(null)} />
                      <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800">
                        <button
                          type="button"
                          onClick={() => void moveFile(file, null)}
                          className="flex w-full px-3 py-2 text-left text-[12px] hover:bg-app-bg dark:hover:bg-white/5"
                        >
                          {t.filesMoveToRoot}
                        </button>
                        {folders.map((folder) => (
                          <button
                            key={folder.id}
                            type="button"
                            disabled={file.folderId === folder.id}
                            onClick={() => void moveFile(file, folder.id)}
                            className="flex w-full px-3 py-2 text-left text-[12px] hover:bg-app-bg disabled:opacity-40 dark:hover:bg-white/5"
                          >
                            📁 {folder.name}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => void removeFile(file)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                  {t.filesDelete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          uid={user?.uid}
          onClose={() => setPreviewFile(null)}
          t={t}
        />
      )}
    </div>
  );
}
