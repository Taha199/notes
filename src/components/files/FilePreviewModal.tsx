import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FILES_ACCESS_VERSION,
  loadPreviewBlobUrl,
  resolveImagePreviewSrc,
  resolvePublicDownloadUrl,
} from './fileAccess';
import { FileDownloadButton } from './FileDownloadButton';
import { fileDownloadUrl, previewModeFor, type StoredFile } from './fileTypes';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';

export function FilePreviewModal({
  file,
  uid,
  onClose,
  onDelete,
  t,
}: {
  file: StoredFile;
  uid: string;
  onClose: () => void;
  onDelete?: (file: StoredFile) => void;
  t: {
    filesDownload: string;
    filesDownloading: string;
    filesPreviewUnavailable: string;
    filesPreviewFailed: string;
    filesPreviewLoading: string;
    filesDownloadFailed: string;
    filesMissingInStorage: string;
    filesDelete: string;
  };
}) {
  const mode = previewModeFor(file);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(mode === 'image' || mode === 'pdf' || mode === 'text');
  const [failed, setFailed] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');
  const [text, setText] = useState('');
  const blobRef = useRef<string | null>(null);

  const revoke = () => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
  };

  useEffect(() => {
    console.info(`[files] ${FILES_ACCESS_VERSION} preview`, file.id, mode);
  }, [file.id, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => revoke(), []);

  useEffect(() => {
    if (mode !== 'image' && mode !== 'pdf') return;
    let cancelled = false;
    const quickUrl = fileDownloadUrl(file);
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setLoading(false);
      if (!quickUrl) {
        setFailed(true);
        setErrorDetail(t.filesPreviewFailed);
      }
    }, 15_000);

    (async () => {
      setLoading(true);
      setFailed(false);
      setErrorDetail('');
      revoke();

      try {
        if (quickUrl) {
          if (cancelled) return;
          setSrc(quickUrl);
          setLoading(false);
          return;
        }

        const url = mode === 'image'
          ? await resolveImagePreviewSrc(file, uid)
          : await resolvePublicDownloadUrl(file, uid);
        if (cancelled) return;
        if (url.startsWith('blob:')) blobRef.current = url;
        setSrc(url);
      } catch (err) {
        console.error('[files] preview failed', file.id, err);
        if (!cancelled) {
          setFailed(true);
          const msg = err instanceof Error ? err.message : String(err);
          setErrorDetail(
            msg.startsWith('MISSING_IN_STORAGE') || /storage-object-not-found/i.test(msg)
              ? t.filesMissingInStorage
              : msg,
          );
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      revoke();
    };
  }, [file, mode, uid, t.filesMissingInStorage, t.filesPreviewFailed]);

  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
        setFailed(true);
        setErrorDetail(t.filesPreviewFailed);
      }
    }, 15_000);

    (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const blobUrl = await loadPreviewBlobUrl(file, uid);
        if (cancelled) {
          if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
          return;
        }
        if (blobUrl.startsWith('blob:')) {
          const res = await fetch(blobUrl);
          const body = await res.text();
          URL.revokeObjectURL(blobUrl);
          if (!cancelled) setText(body);
        } else {
          const res = await fetch(blobUrl);
          if (!cancelled) setText(await res.text());
        }
      } catch (err) {
        console.error('[files] text preview failed', err);
        if (!cancelled) {
          setText(t.filesPreviewFailed);
          setFailed(true);
          setErrorDetail(err instanceof Error ? err.message : String(err));
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [file, mode, uid, t.filesPreviewFailed]);

  const downloadBtn = (
    <FileDownloadButton
      file={file}
      uid={uid}
      label={t.filesDownload}
      loadingLabel={t.filesDownloading}
      onErrorMessage={t.filesDownloadFailed}
      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100"
    />
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-[10000] flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 truncate text-sm font-semibold text-white">{file.name}</div>
        <div className="flex shrink-0 items-center gap-2">
          {downloadBtn}
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
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && !failed && <FilesLoadingIndicator text={t.filesPreviewLoading} />}
        {mode === 'image' && !failed && src && !loading && (
          <img
            src={src}
            alt={file.name}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            onError={() => {
              setFailed(true);
              setErrorDetail('Image failed to render from Storage URL');
            }}
          />
        )}
        {mode === 'pdf' && !failed && src && !loading && (
          <iframe
            title={file.name}
            src={src}
            className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
          />
        )}
        {mode === 'text' && !loading && !failed && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {text}
          </pre>
        )}
        {(mode === 'unsupported' || failed) && !loading && (
          <div className="flex max-w-lg flex-col items-center gap-3 text-center">
            <p className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white">
              {mode === 'unsupported'
                ? t.filesPreviewUnavailable
                : (errorDetail || t.filesPreviewFailed)}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {downloadBtn}
              {onDelete && errorDetail === t.filesMissingInStorage ? (
                <button
                  type="button"
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(file);
                    onClose();
                  }}
                >
                  {t.filesDelete}
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
