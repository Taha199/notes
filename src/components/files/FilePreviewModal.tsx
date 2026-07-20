import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fileHref,
  getCachedPreviewBlobUrl,
  hydrateInlineFile,
  isInlinePendingFile,
  isMissingStorageError,
  loadDocxHtml,
  loadPreviewBlobUrl,
  loadTextPreview,
  previewModeFor,
  type StoredFile,
} from '../../lib/files';

type PreviewLabels = {
  filesDownload: string;
  filesDownloading: string;
  filesPreviewUnavailable: string;
  filesPreviewFailed: string;
  filesMissingInStorage: string;
  filesDelete: string;
};

/** Tiny resolve spinner — never the list "Loading your files…" cloud. */
function PreviewResolveSpinner({ pct }: { pct?: number }) {
  return (
    <div className="flex flex-col items-center gap-2 text-white/80">
      <div
        className="h-7 w-7 animate-spin rounded-full border-2 border-white/25 border-t-white"
        aria-hidden
      />
      {typeof pct === 'number' && pct > 0 && pct < 100 && (
        <p className="text-xs text-white/70">{pct}%</p>
      )}
    </div>
  );
}

export function FilePreviewModal({
  file,
  uid,
  onClose,
  onDelete,
  t,
  onDownload,
  downloading,
  downloadPct = 0,
  onHydrated,
}: {
  file: StoredFile;
  uid?: string;
  onClose: () => void;
  onDelete?: (file: StoredFile) => void;
  t: PreviewLabels;
  onDownload: (file: StoredFile) => void;
  downloading: boolean;
  downloadPct?: number;
  /** Persist RTDB-hydrated dataUrl back into the list so reopen/download stay instant. */
  onHydrated?: (file: StoredFile) => void;
}) {
  const mode = previewModeFor(file);
  const href = fileHref(file);
  const fileKey = `${file.id}:${file.downloadUrl || ''}:${file.storagePath || ''}:${file.inlinePending ? '1' : '0'}:${file.dataUrl?.startsWith('data:') ? '1' : '0'}`;
  const cachedBlob = mode === 'pdf' || mode === 'image' ? getCachedPreviewBlobUrl(file) : null;

  const [activeFile, setActiveFile] = useState(file);
  const activeHref = fileHref(activeFile);
  const [textContent, setTextContent] = useState('');
  const [docxHtml, setDocxHtml] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(cachedBlob);
  // Images with a ready href paint immediately — zero spinner (Friday).
  const [resolving, setResolving] = useState(
    mode === 'pdf'
      ? !cachedBlob
      : mode === 'text'
      || mode === 'docx'
      || (mode === 'image' && !href && !cachedBlob),
  );
  const [loadProgress, setLoadProgress] = useState(cachedBlob ? 100 : 0);
  const [loadError, setLoadError] = useState(false);
  const [missingInStorage, setMissingInStorage] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const markFailed = (err?: unknown) => {
    setLoadError(true);
    setMissingInStorage(isMissingStorageError(err));
  };

  // Keep local copy in sync when parent patches downloadUrl / hydrated dataUrl.
  useEffect(() => {
    setActiveFile(file);
    setImgFailed(false);
    setLoadError(false);
    setMissingInStorage(false);
  }, [fileKey]); // eslint-disable-line react-hooks/exhaustive-deps -- stable identity key

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Friday inline list entries: restore dataUrl from RTDB before any Storage path.
  useEffect(() => {
    if (!uid || !isInlinePendingFile(activeFile) || fileHref(activeFile)) return;
    let cancelled = false;
    setResolving(true);
    (async () => {
      try {
        const hydrated = await hydrateInlineFile(activeFile, uid);
        if (cancelled) return;
        if (hydrated.dataUrl?.startsWith('data:') || fileHref(hydrated)) {
          setActiveFile(hydrated);
          onHydrated?.(hydrated);
          if (mode === 'image') setResolving(false);
        }
      } catch {
        /* image/pdf effects handle failure */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable key
  }, [fileKey, uid, mode]);

  // PDF: blob URL (Chrome blanks Firebase CDN in iframes). Cache → instant reopen.
  useEffect(() => {
    if (mode !== 'pdf') return;
    let cancelled = false;
    const target = activeFile;
    const hit = getCachedPreviewBlobUrl(target);
    if (hit) {
      setBlobUrl(hit);
      setLoadProgress(100);
      setResolving(false);
      setLoadError(false);
      setMissingInStorage(false);
      return;
    }
    // Wait for inline hydrate when needed — don't race Storage first.
    if (isInlinePendingFile(target) && !fileHref(target)) return;
    setResolving(true);
    setLoadError(false);
    setMissingInStorage(false);
    setLoadProgress(0);
    setBlobUrl(null);
    (async () => {
      try {
        const objectUrl = await loadPreviewBlobUrl(target, (loaded, total) => {
          if (!cancelled && total > 0) {
            setLoadProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        }, uid);
        if (cancelled) return;
        setBlobUrl(objectUrl);
        setLoadProgress(100);
      } catch (err) {
        if (!cancelled) markFailed(err);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable key
  }, [fileKey, mode, uid, activeHref]);

  // Image recovery only when CDN/data URL fails — never the default path.
  useEffect(() => {
    if (mode !== 'image') return;
    if (!imgFailed) return;
    if (blobUrl) return;
    let cancelled = false;
    const hit = getCachedPreviewBlobUrl(activeFile);
    if (hit) {
      setBlobUrl(hit);
      setLoadProgress(100);
      setResolving(false);
      return;
    }
    setResolving(true);
    setLoadError(false);
    setMissingInStorage(false);
    setLoadProgress(0);
    (async () => {
      try {
        const objectUrl = await loadPreviewBlobUrl(activeFile, (loaded, total) => {
          if (!cancelled && total > 0) {
            setLoadProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        }, uid);
        if (cancelled) return;
        setBlobUrl(objectUrl);
        setLoadProgress(100);
      } catch (err) {
        if (!cancelled) markFailed(err);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable key
  }, [fileKey, mode, imgFailed, blobUrl, uid, activeHref]);

  useEffect(() => {
    if (mode !== 'text') return;
    if (isInlinePendingFile(activeFile) && !fileHref(activeFile)) return;
    let cancelled = false;
    setResolving(true);
    setLoadError(false);
    setMissingInStorage(false);
    (async () => {
      try {
        const body = await loadTextPreview(activeFile, uid);
        if (!cancelled) setTextContent(body);
      } catch (err) {
        if (!cancelled) {
          setTextContent(isMissingStorageError(err) ? t.filesMissingInStorage : t.filesPreviewFailed);
          markFailed(err);
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable key
  }, [fileKey, mode, uid, activeHref, t.filesPreviewFailed, t.filesMissingInStorage]);

  useEffect(() => {
    if (mode !== 'docx') return;
    if (isInlinePendingFile(activeFile) && !fileHref(activeFile)) return;
    let cancelled = false;
    setResolving(true);
    setLoadError(false);
    setMissingInStorage(false);
    setLoadProgress(0);
    setDocxHtml('');
    (async () => {
      try {
        const html = await loadDocxHtml(activeFile, (loaded, total) => {
          if (!cancelled && total > 0) {
            setLoadProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        }, uid);
        if (!cancelled) {
          setDocxHtml(html);
          setLoadProgress(100);
        }
      } catch (err) {
        if (!cancelled) markFailed(err);
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional stable key
  }, [fileKey, mode, uid, activeHref]);

  // Friday: paint <img src={dataUrl || downloadUrl}> immediately.
  const imageSrc = blobUrl || (imgFailed ? '' : activeHref);
  const errorMessage = missingInStorage ? t.filesMissingInStorage : t.filesPreviewFailed;
  const showError = loadError || mode === 'unsupported';
  const downloadLabel = downloading
    ? t.filesDownloading.replace('{n}', String(downloadPct))
    : t.filesDownload;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={activeFile.name}
      className="fixed inset-0 z-[10000] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0 truncate text-sm font-semibold text-white">{activeFile.name}</div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={downloading}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(activeFile);
            }}
          >
            {downloadLabel}
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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {mode === 'image' && !loadError && (
          imageSrc ? (
            <img
              src={imageSrc}
              alt={activeFile.name}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
              onError={() => {
                if (!imgFailed) setImgFailed(true);
                else markFailed(new Error('MISSING_IN_STORAGE'));
              }}
            />
          ) : resolving ? (
            <PreviewResolveSpinner pct={loadProgress} />
          ) : null
        )}
        {mode === 'pdf' && !showError && (
          resolving ? (
            <PreviewResolveSpinner pct={loadProgress} />
          ) : blobUrl ? (
            <iframe
              title={activeFile.name}
              src={blobUrl}
              className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
            />
          ) : null
        )}
        {mode === 'text' && !showError && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {resolving ? '…' : textContent}
          </pre>
        )}
        {mode === 'docx' && !showError && (
          resolving ? (
            <PreviewResolveSpinner pct={loadProgress} />
          ) : (
            <div
              className="prose max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 text-left shadow-2xl dark:prose-invert dark:bg-gray-900"
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          )
        )}
        {showError && (
          <div className="flex max-w-lg flex-col items-center gap-3 text-center">
            <p className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white">
              {mode === 'unsupported' ? t.filesPreviewUnavailable : errorMessage}
            </p>
            {mode !== 'unsupported' && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  disabled={downloading}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-60"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload(activeFile);
                  }}
                >
                  {downloadLabel}
                </button>
                {onDelete && (
                  <button
                    type="button"
                    className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(activeFile);
                    }}
                  >
                    {t.filesDelete}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
