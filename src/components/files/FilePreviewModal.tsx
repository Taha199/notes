import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getBlob, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase';
import { fileDownloadUrl, isChrome, previewModeFor, type StoredFile } from './fileTypes';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';

function ensurePdfMime(blob: Blob, file: StoredFile): Blob {
  if (
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    && blob.type !== 'application/pdf'
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}

export function FilePreviewModal({
  file,
  onClose,
  t,
}: {
  file: StoredFile;
  onClose: () => void;
  t: {
    filesDownload: string;
    filesPreviewUnavailable: string;
    filesPreviewFailed: string;
    filesPreviewLoading: string;
  };
}) {
  const mode = previewModeFor(file);
  const directUrl = fileDownloadUrl(file);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(mode === 'image' || mode === 'pdf');
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

  // Image + PDF preview
  useEffect(() => {
    if (mode !== 'image' && mode !== 'pdf') return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setFailed(false);
      revoke();

      try {
        if (!directUrl) throw new Error('no-url');

        // Safari: direct URL. Chrome PDF: blob (attachment URLs blank in iframe).
        if (mode === 'pdf' && isChrome()) {
          const res = await fetch(directUrl);
          if (!res.ok) throw new Error('fetch-failed');
          const blob = ensurePdfMime(await res.blob(), file);
          const blobUrl = URL.createObjectURL(blob);
          blobRef.current = blobUrl;
          if (!cancelled) setSrc(blobUrl);
        } else {
          if (!cancelled) setSrc(directUrl);
        }
      } catch {
        if (cancelled) return;
        try {
          const path = file.storagePath;
          if (!path) throw new Error('no-path');
          const blob = ensurePdfMime(await getBlob(ref(storage, path)), file);
          const blobUrl = URL.createObjectURL(blob);
          blobRef.current = blobUrl;
          setSrc(blobUrl);
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
  }, [file, mode, directUrl]);

  // Text preview
  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    (async () => {
      try {
        if (!directUrl) throw new Error('no-url');
        const res = await fetch(directUrl);
        if (!res.ok) throw new Error('fetch-failed');
        const body = await res.text();
        if (!cancelled) setText(body);
      } catch {
        if (!cancelled) {
          setText(t.filesPreviewFailed);
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file, mode, directUrl, t.filesPreviewFailed]);

  const downloadUrl = directUrl;

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
          {downloadUrl ? (
            <a
              href={downloadUrl}
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
          <img src={src} alt={file.name} className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl" />
        )}
        {mode === 'pdf' && !failed && src && !loading && (
          <iframe title={file.name} src={src} className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl" />
        )}
        {mode === 'text' && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {text || '…'}
          </pre>
        )}
        {(mode === 'unsupported' || failed) && (
          <p className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white">
            {mode === 'unsupported' ? t.filesPreviewUnavailable : t.filesPreviewFailed}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
