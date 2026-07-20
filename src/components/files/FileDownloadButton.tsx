import { useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { downloadStoredFile } from './fileAccess';
import type { StoredFile } from './fileTypes';

/** Authenticated download button — never a bare href to a stale Firebase URL. */
export function FileDownloadButton({
  file,
  uid,
  label,
  loadingLabel,
  className,
  onErrorMessage,
}: {
  file: StoredFile;
  uid: string;
  label: string;
  loadingLabel?: string;
  className: string;
  onErrorMessage?: string;
}) {
  const { show } = useToast();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadStoredFile(file, uid);
    } catch (err) {
      console.error('[files] download failed', err);
      const detail = err instanceof Error ? err.message : String(err);
      show(onErrorMessage ? `${onErrorMessage} (${detail})` : detail);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => { void handleDownload(e); }}
      disabled={downloading}
      className={`${className} disabled:cursor-wait disabled:opacity-70`}
    >
      {downloading ? (loadingLabel || '…') : label}
    </button>
  );
}
