import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  fileHref,
  isMissingStorageError,
  loadDocxHtml,
  loadPreviewBlobUrl,
  loadTextPreview,
  previewModeFor,
  type StoredFile,
} from '../../lib/files';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';

type PreviewLabels = {
  filesDownload: string;
  filesPreviewUnavailable: string;
  filesPreviewFailed: string;
  filesMissingInStorage: string;
  filesDelete: string;
  filesLoading: string;
};

export function FilePreviewModal({
  file,
  uid,
  onClose,
  onDelete,
  t,
  onDownload,
  downloading,
}: {
  file: StoredFile;
  uid?: string;
  onClose: () => void;
  onDelete?: (file: StoredFile) => void;
  t: PreviewLabels;
  onDownload: (file: StoredFile) => void;
  downloading: boolean;
}) {
  const href = fileHref(file);
  const mode = previewModeFor(file);
  const [textContent, setTextContent] = useState('');
  const [docxHtml, setDocxHtml] = useState('');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(
    mode === 'pdf' || mode === 'text' || mode === 'docx' || file.inlinePending === true,
  );
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [missingInStorage, setMissingInStorage] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const markFailed = (err?: unknown) => {
    setLoadError(true);
    setMissingInStorage(isMissingStorageError(err));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // PDF: always same-origin blob: URL (Chrome cannot embed Firebase attachment URLs).
  useEffect(() => {
    if (mode !== 'pdf') return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setLoadError(false);
    setMissingInStorage(false);
    setLoadProgress(0);
    setBlobUrl(null);
    (async () => {
      try {
        objectUrl = await loadPreviewBlobUrl(file, (loaded, total) => {
          if (!cancelled && total > 0) {
            setLoadProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        }, uid);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
        setLoadProgress(100);
      } catch (err) {
        if (!cancelled) markFailed(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, mode, uid]);

  // Image recovery after direct URL fails, or when inlinePending.
  useEffect(() => {
    if (mode !== 'image' || !imgFailed || blobUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setLoadError(false);
    setMissingInStorage(false);
    (async () => {
      try {
        objectUrl = await loadPreviewBlobUrl(file, (loaded, total) => {
          if (!cancelled && total > 0) {
            setLoadProgress(Math.min(99, Math.round((loaded / total) * 100)));
          }
        }, uid);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setBlobUrl(objectUrl);
        setLoadProgress(100);
      } catch (err) {
        if (!cancelled) markFailed(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file, mode, imgFailed, blobUrl, uid]);

  useEffect(() => {
    if (mode !== 'image' || !file.inlinePending || imgFailed || blobUrl) return;
    setImgFailed(true);
  }, [mode, file.inlinePending, imgFailed, blobUrl]);

  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setMissingInStorage(false);
    (async () => {
      try {
        const body = await loadTextPreview(file, uid);
        if (!cancelled) setTextContent(body);
      } catch (err) {
        if (!cancelled) {
          setTextContent(isMissingStorageError(err) ? t.filesMissingInStorage : t.filesPreviewFailed);
          markFailed(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, mode, uid, t.filesPreviewFailed, t.filesMissingInStorage]);

  useEffect(() => {
    if (mode !== 'docx') return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setMissingInStorage(false);
    setLoadProgress(0);
    setDocxHtml('');
    (async () => {
      try {
        const html = await loadDocxHtml(file, (loaded, total) => {
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
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, mode, uid]);

  const imageSrc = blobUrl || (file.inlinePending ? '' : href);
  const errorMessage = missingInStorage ? t.filesMissingInStorage : t.filesPreviewFailed;
  const showError = loadError || mode === 'unsupported';

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
            disabled={downloading || missingInStorage}
            title={missingInStorage ? t.filesMissingInStorage : undefined}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={(e) => {
              e.stopPropagation();
              if (!missingInStorage) onDownload(file);
            }}
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
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        {mode === 'image' && !loadError && (
          loading && (imgFailed || file.inlinePending) ? (
            <div className="text-center text-white">
              <FilesLoadingIndicator text={t.filesLoading} />
              {loadProgress > 0 && (
                <p className="mt-2 text-xs text-white/70">{loadProgress}%</p>
              )}
            </div>
          ) : imageSrc ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
              onError={() => {
                if (!imgFailed) setImgFailed(true);
                else markFailed(new Error('MISSING_IN_STORAGE'));
              }}
            />
          ) : null
        )}
        {mode === 'pdf' && !showError && (
          loading ? (
            <div className="text-center text-white">
              <FilesLoadingIndicator text={t.filesLoading} />
              {loadProgress > 0 && (
                <p className="mt-2 text-xs text-white/70">{loadProgress}%</p>
              )}
            </div>
          ) : blobUrl ? (
            <iframe
              title={file.name}
              src={blobUrl}
              className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
            />
          ) : null
        )}
        {mode === 'text' && !showError && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {loading ? '…' : textContent}
          </pre>
        )}
        {mode === 'docx' && !showError && (
          loading ? (
            <div className="text-center text-white">
              <FilesLoadingIndicator text={t.filesLoading} />
              {loadProgress > 0 && (
                <p className="mt-2 text-xs text-white/70">{loadProgress}%</p>
              )}
            </div>
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
                {!missingInStorage && (
                  <button
                    type="button"
                    disabled={downloading}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-60"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(file);
                    }}
                  >
                    {downloading ? '…' : t.filesDownload}
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(file);
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
