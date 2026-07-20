import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPreviewBlobUrl, resolvePublicDownloadUrl } from './fileAccess';
import { fileDownloadUrl, previewModeFor, type StoredFile } from './fileTypes';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';

const PROXY_MAX_BYTES = 3_500_000;

export function FilePreviewModal({
  file,
  uid,
  onClose,
  t,
}: {
  file: StoredFile;
  uid: string;
  onClose: () => void;
  t: {
    filesDownload: string;
    filesPreviewUnavailable: string;
    filesPreviewFailed: string;
    filesPreviewLoading: string;
  };
}) {
  const mode = previewModeFor(file);
  const initialUrl = fileDownloadUrl(file);
  const [src, setSrc] = useState('');
  const [downloadHref, setDownloadHref] = useState(initialUrl);
  const [loading, setLoading] = useState(mode === 'image' || mode === 'pdf' || mode === 'text');
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState('');
  const blobRef = useRef<string | null>(null);

  const revoke = () => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => revoke(), []);

  // Keep download link ready (never blocks preview).
  useEffect(() => {
    let cancelled = false;
    if (initialUrl) {
      setDownloadHref(initialUrl);
      return;
    }
    void (async () => {
      try {
        const url = await resolvePublicDownloadUrl(file, uid);
        if (!cancelled) setDownloadHref(url);
      } catch {
        /* download button stays disabled until resolved */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, uid, initialUrl]);

  // Image + PDF: always go through same-origin proxy first (fixes Chrome).
  // Fallback to direct Firebase URL for images only.
  useEffect(() => {
    if (mode !== 'image' && mode !== 'pdf') return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setFailed(false);
      revoke();

      const useProxy = !(typeof file.size === 'number' && file.size > PROXY_MAX_BYTES);

      try {
        if (useProxy) {
          const blobUrl = await loadPreviewBlobUrl(file);
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          blobRef.current = blobUrl;
          setSrc(blobUrl);
          return;
        }
        throw new Error('skip-proxy');
      } catch {
        if (cancelled) return;
        // Images: direct token URL works in <img> without CORS.
        // PDFs: Firebase attachment disposition blanks Chrome iframe — show failure + download.
        try {
          const url = initialUrl || (await resolvePublicDownloadUrl(file, uid));
          if (cancelled) return;
          if (!url) throw new Error('no-url');
          if (mode === 'image') {
            setSrc(url);
            setDownloadHref(url);
          } else {
            setDownloadHref(url);
            throw new Error('pdf-needs-proxy');
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [file, mode, uid, initialUrl]);

  // Text preview via proxy
  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const blobUrl = await loadPreviewBlobUrl(file);
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        const res = await fetch(blobUrl);
        const body = await res.text();
        URL.revokeObjectURL(blobUrl);
        if (!cancelled) setText(body);
      } catch {
        if (!cancelled) {
          setText(t.filesPreviewFailed);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, mode, t.filesPreviewFailed]);

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
          {downloadHref ? (
            <a
              href={downloadHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100"
              onClick={(e) => e.stopPropagation()}
            >
              {t.filesDownload}
            </a>
          ) : null}
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
            onError={() => setFailed(true)}
          />
        )}
        {mode === 'pdf' && !failed && src && !loading && (
          <iframe
            title={file.name}
            src={src}
            className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
          />
        )}
        {mode === 'text' && !loading && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {text}
          </pre>
        )}
        {(mode === 'unsupported' || failed) && !loading && (
          <div className="flex flex-col items-center gap-3">
            <p className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white">
              {mode === 'unsupported' ? t.filesPreviewUnavailable : t.filesPreviewFailed}
            </p>
            {downloadHref ? (
              <a
                href={downloadHref}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900"
                onClick={(e) => e.stopPropagation()}
              >
                {t.filesDownload}
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
