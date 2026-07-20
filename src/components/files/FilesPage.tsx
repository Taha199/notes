import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteObject,
  getBlob,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { storage } from '../../lib/firebase';
import { getRtdbAuthToken, rtdbFetch } from '../../lib/rtdb';
import { getStorageLimitBytes } from '../../lib/storageQuota';

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
  /** Server withheld the inline blob; background migrate still pending */
  inlinePending?: boolean;
}

const LIST_TIMEOUT_MS = 15_000;
const UPLOAD_STUCK_MS = 10_000;
const UPLOAD_TOTAL_MS = 90_000;
const PROFILE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Drop heavy base64 payloads so the UI never holds multi‑MB strings. */
function lightFileMeta(file: StoredFile): StoredFile {
  if (!file.dataUrl) return file;
  const { dataUrl, ...rest } = file;
  void dataUrl;
  return { ...rest, inlinePending: true };
}

interface FileFolder {
  id: string;
  name: string;
  createdAt: string;
}

type PreviewMode = 'image' | 'pdf' | 'text' | 'unsupported';

type UploadProgressItem = {
  key: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
};

const FILE_INPUT_ID = 'files-upload-input';
const FILES_FOLDER_KEY = 'malacadhati_files_folder';

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** Storage path segment: strip characters that break object paths across browsers. */
function safeStorageFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\?#%[\]*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

function firebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  if (err instanceof Error && err.message) return err.message;
  return '';
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

function fileHref(file: StoredFile) {
  return file.downloadUrl || file.dataUrl || '#';
}

function previewModeFor(file: StoredFile): PreviewMode {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html?)$/i.test(name)) return 'text';
  return 'unsupported';
}

function canPreview(file: StoredFile) {
  return previewModeFor(file) !== 'unsupported';
}

/** Convert a legacy inline base64/text data URL back into a Blob for Storage upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = commaIdx === -1 ? '' : dataUrl.slice(5, commaIdx); // strip leading "data:"
  const payload = commaIdx === -1 ? '' : dataUrl.slice(commaIdx + 1);
  const contentType = meta.split(';')[0] || 'application/octet-stream';
  if (/;base64/i.test(meta)) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: contentType });
  }
  return new Blob([decodeURIComponent(payload)], { type: contentType });
}

function ensurePdfMime(blob: Blob, file: StoredFile): Blob {
  if (
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    && blob.type !== 'application/pdf'
  ) {
    return new Blob([blob], { type: 'application/pdf' });
  }
  return blob;
}

function isChromeBrowser(): boolean {
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);
}

function resolveClientStoragePath(file: StoredFile, uid: string): string | undefined {
  if (file.storagePath) return file.storagePath;
  if (file.downloadUrl) {
    try {
      const u = new URL(file.downloadUrl);
      const idx = u.pathname.indexOf('/o/');
      if (idx !== -1) {
        const encoded = u.pathname.slice(idx + 3);
        if (encoded) return decodeURIComponent(encoded);
      }
    } catch {
      /* ignore */
    }
  }
  if (uid && file.id && file.name) {
    return `users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`;
  }
  return undefined;
}

async function refreshFileAccess(file: StoredFile): Promise<{ downloadUrl: string; storagePath?: string } | null> {
  const token = await getRtdbAuthToken();
  if (!token) return null;
  const res = await fetch(`/api/file-download?fileId=${encodeURIComponent(file.id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { downloadUrl?: string; storagePath?: string };
  if (!data.downloadUrl) return null;
  return { downloadUrl: data.downloadUrl, storagePath: data.storagePath };
}

/** Reliable bytes for preview/download — SDK first, then fresh token URL. */
async function loadPreviewBlob(file: StoredFile, uid: string): Promise<Blob> {
  if (file.dataUrl) return dataUrlToBlob(file.dataUrl);

  const path = resolveClientStoragePath(file, uid);
  if (path) {
    try {
      return ensurePdfMime(await getBlob(ref(storage, path)), file);
    } catch {
      /* fall through */
    }
  }

  let url = file.downloadUrl;
  if (!url) {
    const refreshed = await refreshFileAccess(file);
    url = refreshed?.downloadUrl;
  }
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch:${res.status}`);
    return ensurePdfMime(await res.blob(), file);
  }

  throw new Error('no-file-source');
}

async function loadTextPreview(file: StoredFile, href: string): Promise<string> {
  if (file.dataUrl?.startsWith('data:')) {
    const match = file.dataUrl.match(/^data:([^,]*),(.*)$/s);
    if (!match) return '';
    const [, meta, payload] = match;
    if (meta.includes('base64')) return atob(payload);
    return decodeURIComponent(payload);
  }
  const res = await fetch(href);
  if (!res.ok) throw new Error(`fetch:${res.status}`);
  return res.text();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function loadTextPreviewFromBlob(file: StoredFile, uid: string): Promise<string> {
  const blob = await loadPreviewBlob(file, uid);
  return blob.text();
}

function FilePreviewModal({
  file,
  uid,
  onClose,
  t,
  onDownload,
  downloading,
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
  onDownload: (file: StoredFile) => void;
  downloading: boolean;
}) {
  const href = fileHref(file);
  const mode = previewModeFor(file);
  const chromePdf = mode === 'pdf' && isChromeBrowser();
  const [textContent, setTextContent] = useState('');
  const [loadingText, setLoadingText] = useState(mode === 'text');
  const [src, setSrc] = useState(chromePdf || href === '#' ? '' : href);
  const [resolving, setResolving] = useState(chromePdf || href === '#');
  const [failed, setFailed] = useState(false);
  const blobRef = useRef<string | null>(null);
  const blobAttemptRef = useRef(false);

  const revokeBlob = () => {
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => revokeBlob(), []);

  const switchToBlob = async () => {
    if (blobAttemptRef.current || failed) return;
    blobAttemptRef.current = true;
    setResolving(true);
    setFailed(false);
    try {
      const blob = ensurePdfMime(
        await withTimeout(loadPreviewBlob(file, uid), 45_000, 'preview-timeout'),
        file,
      );
      revokeBlob();
      const url = URL.createObjectURL(blob);
      blobRef.current = url;
      setSrc(url);
    } catch {
      setFailed(true);
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (chromePdf || ((mode === 'image' || mode === 'pdf') && href === '#')) {
      void switchToBlob();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, mode, chromePdf, href]);

  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    setLoadingText(true);
    setFailed(false);
    (async () => {
      try {
        const body = href && href !== '#'
          ? await loadTextPreview(file, href)
          : await loadTextPreviewFromBlob(file, uid);
        if (!cancelled) setTextContent(body);
      } catch {
        if (!cancelled) {
          setTextContent(t.filesPreviewFailed);
          setFailed(true);
        }
      } finally {
        if (!cancelled) setLoadingText(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, href, mode, uid, t.filesPreviewFailed]);

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
            disabled={downloading}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100 disabled:opacity-60"
            onClick={(e) => {
              e.stopPropagation();
              onDownload(file);
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
        {resolving && !failed && (
          <FilesLoadingIndicator text={t.filesPreviewLoading} />
        )}
        {mode === 'image' && !failed && src && !resolving && (
          <img
            src={src}
            alt={file.name}
            className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
            onError={() => { void switchToBlob(); }}
          />
        )}
        {mode === 'pdf' && !failed && src && !resolving && (
          <iframe
            title={file.name}
            src={src}
            className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl"
          />
        )}
        {mode === 'text' && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {loadingText ? '…' : textContent}
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
  const [loadError, setLoadError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadItems, setUploadItems] = useState<UploadProgressItem[]>([]);
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
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const migrationStartedRef = useRef(false);

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
      setLoadError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError('');
    migrationStartedRef.current = false;

    const paintList = (data: {
      files?: StoredFile[];
      folders?: FileFolder[];
    }) => {
      if (cancelled) return;
      setFiles(
        (data.files ?? [])
          .map(lightFileMeta)
          .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()),
      );
      setFolders(
        (data.folders ?? []).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        ),
      );
    };

    const fetchJson = async <T,>(url: string, token: string, signal: AbortSignal): Promise<T> => {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      });
      if (!res.ok) throw new Error(`load-failed:${res.status}`);
      return res.json() as Promise<T>;
    };

    (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
      try {
        const token = await getRtdbAuthToken();
        if (!token) throw new Error('no-token');
        if (cancelled) return;

        type ListPayload = {
          files?: StoredFile[];
          folders?: FileFolder[];
          migratedRemaining?: boolean;
        };

        const data = await fetchJson<ListPayload>('/api/my-files', token, controller.signal);
        paintList(data);
        if (!cancelled) {
          setLoading(false);
          setLoadError('');
        }

        // Background migration — never blocks the list UI; failures must not clear it.
        try {
          let more = data.migratedRemaining === true;
          let guard = 0;
          while (more && !cancelled && guard++ < 40) {
            const migCtrl = new AbortController();
            const migTimer = window.setTimeout(() => migCtrl.abort(), 60_000);
            try {
              const mig = await fetchJson<ListPayload>(
                '/api/my-files?migrate=1',
                token,
                migCtrl.signal,
              );
              paintList(mig);
              more = mig.migratedRemaining === true;
            } finally {
              window.clearTimeout(migTimer);
            }
          }
        } catch (migErr) {
          console.warn('Background file migration failed', migErr);
        }
      } catch (err) {
        if (cancelled) return;
        // Fallback: direct RTDB (may be huge if legacy dataUrls remain — strip them).
        try {
          const fallbackCtrl = new AbortController();
          const fallbackTimer = window.setTimeout(() => fallbackCtrl.abort(), LIST_TIMEOUT_MS);
          try {
            const [filesRes, foldersRes] = await Promise.all([
              rtdbFetch(`/users/${user.uid}/files`, { signal: fallbackCtrl.signal }),
              rtdbFetch(`/users/${user.uid}/fileFolders`, { signal: fallbackCtrl.signal }),
            ]);
            if (!filesRes.ok || !foldersRes.ok) throw new Error('rtdb-fallback-failed');
            const cloudFiles = await filesRes.json();
            const cloudFolders = await foldersRes.json();
            if (!cancelled) {
              setFiles(
                normalizeList<StoredFile>(cloudFiles)
                  .map(lightFileMeta)
                  .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime()),
              );
              setFolders(
                normalizeList<FileFolder>(cloudFolders).sort(
                  (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                ),
              );
              setLoadError('');
            }
          } finally {
            window.clearTimeout(fallbackTimer);
          }
        } catch {
          if (!cancelled) {
            setFiles([]);
            setFolders([]);
            const aborted = err instanceof DOMException && err.name === 'AbortError'
              || (err instanceof Error && /abort|timeout/i.test(err.message));
            setLoadError(aborted ? t.filesLoadFailed : t.filesLoadFailed);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, reloadNonce, t.filesLoadFailed]);

  useEffect(() => {
    if (currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folders]);

  // Client-side migrate only when we still have an inline dataUrl (RTDB fallback path).
  // Prefer server migrate via /api/my-files?migrate=1 — never block list paint.
  useEffect(() => {
    if (!user || migrationStartedRef.current) return;
    const legacy = files.filter((f) => f.dataUrl && !f.storagePath && !f.downloadUrl);
    if (legacy.length === 0) return;
    migrationStartedRef.current = true;
    let cancelled = false;
    (async () => {
      for (const file of legacy) {
        if (cancelled) break;
        try {
          await migrateInlineFileToStorage(file);
        } catch {
          /* keep the inline copy on failure — file stays accessible */
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, user]);

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

  const uploadErrorMessage = (err: unknown): string => {
    const code = firebaseErrorCode(err);
    if (
      code.includes('unauthorized')
      || code.includes('permission-denied')
      || code === 'storage/unauthorized'
    ) {
      return `${t.filesUploadPermissionDenied}${code ? ` (${code})` : ''}`;
    }
    if (
      code.includes('unauthenticated')
      || code === 'storage/unauthenticated'
      || code === 'auth/user-token-expired'
      || code === 'no-token'
      || code === 'no-user'
    ) {
      return `${t.filesUploadAuthError}${code ? ` (${code})` : ''}`;
    }
    if (
      code === 'storage/upload-stuck'
      || code === 'upload-stuck'
    ) {
      return t.filesUploadStuck;
    }
    if (
      code.includes('network')
      || code === 'storage/retry-limit-exceeded'
      || code === 'storage/canceled'
      || code === 'timeout'
      || (err instanceof TypeError && /fetch|network/i.test(err.message))
    ) {
      return `${t.filesUploadNetworkError}${code ? ` (${code})` : ''}`;
    }
    if (code === 'quota-exceeded' || code === 'storage/quota-exceeded') {
      return t.filesQuotaExceeded;
    }
    return `${t.filesUploadFailed}${code ? ` (${code})` : ''}`;
  };

  const updateUploadItem = (key: string, patch: Partial<UploadProgressItem>) => {
    setUploadItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  /** Resumable upload; rejects with storage/upload-stuck if still at 0% after UPLOAD_STUCK_MS. */
  const uploadResumableOrStuck = (
    storageRef: ReturnType<typeof ref>,
    file: File,
    contentType: string,
    onProgress: (pct: number) => void,
  ): Promise<void> => new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });
    let gotBytes = false;
    const stuckTimer = window.setTimeout(() => {
      if (!gotBytes) {
        try { task.cancel(); } catch { /* ignore */ }
        reject(new Error('storage/upload-stuck'));
      }
    }, UPLOAD_STUCK_MS);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.bytesTransferred > 0) gotBytes = true;
        const total = snapshot.totalBytes || file.size || 1;
        onProgress(Math.min(99, Math.round((snapshot.bytesTransferred / total) * 100)));
      },
      (err) => {
        window.clearTimeout(stuckTimer);
        reject(err);
      },
      () => {
        window.clearTimeout(stuckTimer);
        resolve();
      },
    );
  });

  const uploadOneFile = async (
    file: File,
    folderId: string | null,
    onProgress: (pct: number) => void,
  ): Promise<StoredFile> => {
    if (!user) throw new Error('no-user');
    const token = await getRtdbAuthToken();
    if (!token) throw new Error('no-token');

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
    const storagePath = `users/${user.uid}/files/${id}/${safeStorageFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);

    const runUpload = async () => {
      try {
        await uploadResumableOrStuck(storageRef, file, base.type, onProgress);
      } catch (err) {
        const code = firebaseErrorCode(err);
        // Chrome custom-domain CORS / hung resumable: fall back to simple uploadBytes.
        if (
          code === 'storage/upload-stuck'
          || code === 'storage/canceled'
          || code.includes('network')
          || code === 'storage/retry-limit-exceeded'
        ) {
          onProgress(5);
          await withTimeout(
            uploadBytes(storageRef, file, { contentType: base.type }),
            UPLOAD_TOTAL_MS,
            'upload-bytes-timeout',
          );
        } else {
          throw err;
        }
      }
    };

    await withTimeout(runUpload(), UPLOAD_TOTAL_MS, 'upload-timeout');
    onProgress(100);
    const downloadUrl = await withTimeout(getDownloadURL(storageRef), 20_000, 'download-url-timeout');
    return { ...withFolder, downloadUrl, storagePath };
  };

  /** Move a legacy inline (base64) file into Storage and drop the heavy dataUrl. */
  const migrateInlineFileToStorage = async (file: StoredFile) => {
    if (!user || !file.dataUrl) return;
    const blob = dataUrlToBlob(file.dataUrl);
    const storagePath = file.storagePath || `users/${user.uid}/files/${file.id}/${safeStorageFileName(file.name)}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, blob, { contentType: file.type || 'application/octet-stream' });
    const downloadUrl = await getDownloadURL(storageRef);
    const migrated: StoredFile = { ...file, downloadUrl, storagePath };
    delete migrated.dataUrl;
    // Persist the light metadata (removes the inline blob from the DB) only after
    // the Storage upload succeeded, so the file is never lost.
    await saveFileMeta(migrated);
    setFiles((prev) => prev.map((f) => (f.id === file.id ? migrated : f)));
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!user) {
      setError(t.filesUploadAuthError);
      return;
    }

    setError('');
    const selected = Array.from(list);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length) {
      setError(`${t.filesTooLarge} ${oversized.map((f) => f.name).join(', ')}`);
      return;
    }

    const progressKeys = selected.map(
      (file, i) => `${Date.now()}-${i}-${file.name}`,
    );
    setUploadItems(
      selected.map((file, i) => ({
        key: progressKeys[i],
        name: file.name,
        progress: 0,
        status: 'uploading' as const,
      })),
    );
    setUploading(true);
    const uploaded: StoredFile[] = [];
    const failureMessages: string[] = [];

    try {
      // Quota from already-loaded file list + profile only — never pull the whole
      // /users/{uid} tree (notes/chats/legacy base64), which timed out uploads.
      // Cap profile wait so a hung auth/RTDB call cannot leave progress at 0%.
      let profile: Record<string, unknown> = {};
      try {
        const profileRes = await withTimeout(
          rtdbFetch(`/users/${user.uid}/profile`),
          PROFILE_TIMEOUT_MS,
          'profile-timeout',
        );
        if (profileRes.ok) {
          const raw = await withTimeout(profileRes.json(), 5_000, 'profile-json-timeout');
          if (raw && typeof raw === 'object') profile = raw as Record<string, unknown>;
        }
      } catch {
        /* fall back to default free/plus limits from email */
      }

      const usedBytes = files.reduce(
        (sum, f) => sum + (typeof f.size === 'number' && f.size > 0 ? f.size : 0),
        0,
      );
      const limitBytes = getStorageLimitBytes(profile, user.email);
      const incomingBytes = selected.reduce((sum, file) => sum + file.size, 0);
      if (usedBytes + incomingBytes > limitBytes) {
        setError(t.filesQuotaExceeded);
        setUploadItems((prev) => prev.map((item) => ({ ...item, status: 'error', progress: 0 })));
        return;
      }

      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        const key = progressKeys[i];
        try {
          const stored = await uploadOneFile(file, currentFolderId, (pct) => {
            updateUploadItem(key, { progress: pct, status: 'uploading' });
          });
          await withTimeout(saveFileMeta(stored), 20_000, 'meta-save-timeout');
          uploaded.push(stored);
          updateUploadItem(key, { progress: 100, status: 'done' });
          setFiles((prev) => [stored, ...prev.filter((f) => f.id !== stored.id)]);
        } catch (err) {
          console.error('File upload failed', err);
          const msg = uploadErrorMessage(err);
          failureMessages.push(`${file.name}: ${msg}`);
          updateUploadItem(key, { status: 'error' });
        }
      }

      if (uploaded.length) {
        show(uploaded.length === 1 ? t.filesUploadSuccess : `${uploaded.length} ${t.filesUploadSuccess}`);
      }
      if (failureMessages.length) {
        setError(failureMessages.join(' · '));
      }
    } catch (err) {
      console.error('File upload failed', err);
      setError(uploadErrorMessage(err));
      setUploadItems((prev) =>
        prev.map((item) => (item.status === 'uploading' ? { ...item, status: 'error' } : item)),
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
      // Keep failed rows visible briefly; clear finished rows after a short pause.
      const clearDelay = failureMessages.length ? 4000 : 1200;
      window.setTimeout(() => {
        setUploadItems((prev) => prev.filter((p) => p.status === 'uploading'));
      }, clearDelay);
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

  const downloadFile = (file: StoredFile) => {
    if (!user) return;
    const href = fileHref(file);
    if (href && href !== '#') {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    if (downloadingId) return;
    setDownloadingId(file.id);
    setError('');
    void (async () => {
      try {
        triggerBlobDownload(await loadPreviewBlob(file, user.uid), file.name);
      } catch (err) {
        console.error('File download failed', err);
        try {
          const refreshed = await refreshFileAccess(file);
          if (refreshed?.downloadUrl) {
            const a = document.createElement('a');
            a.href = refreshed.downloadUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
          }
        } catch { /* fall through */ }
        setError(t.filesDownloadFailed);
        show(t.filesDownloadFailed);
      } finally {
        setDownloadingId(null);
      }
    })();
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
          <div className="relative">
            <input
              ref={inputRef}
              id={FILE_INPUT_ID}
              type="file"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                void handleFiles(e.target.files);
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => {
                if (!uploading) inputRef.current?.click();
              }}
              className={`inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0`}
            >
              <span className="text-base">{uploading ? '☁️' : '☁️➕'}</span>
              <span>{uploading ? t.cloudSaving : t.filesUpload}</span>
            </button>
          </div>
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

      {loadError && !loading && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>⚠️ {loadError}</span>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className="rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 dark:bg-amber-600"
          >
            {t.filesRetry}
          </button>
        </div>
      )}

      {uploadItems.length > 0 && (
        <div className="mb-4 space-y-2 rounded-2xl border border-primary/20 bg-primary/5 p-4 dark:border-primary/30 dark:bg-primary/10">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">
            {t.filesUploading}
          </div>
          {uploadItems.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div
                  className={`min-w-0 truncate text-sm font-medium ${
                    item.status === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-app-text dark:text-gray-100'
                  }`}
                  title={item.name}
                >
                  {item.status === 'error' ? '⚠️ ' : item.status === 'done' ? '✓ ' : ''}
                  {item.name}
                </div>
                <div
                  className={`shrink-0 text-xs font-semibold tabular-nums ${
                    item.status === 'error'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-app-text-secondary dark:text-gray-400'
                  }`}
                >
                  {item.status === 'error' ? '—' : `${item.progress}%`}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-150 ${
                    item.status === 'error'
                      ? 'bg-red-500'
                      : item.status === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-primary'
                  }`}
                  style={{ width: `${item.status === 'error' ? 100 : item.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div
          className={`animate-fade-in flex flex-col items-center rounded-3xl py-20 text-center text-app-text-secondary/70 transition-colors dark:text-gray-500 ${
            dragging ? 'bg-primary/5' : ''
          }`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <FilesLoadingIndicator text={t.filesLoading} />
        </div>
      ) : !hasContent && uploadItems.length === 0 ? (
        <div
          className={`animate-fade-in flex flex-col items-center rounded-3xl py-20 text-center text-app-text-secondary/70 transition-colors dark:text-gray-500 ${
            dragging ? 'bg-primary/5' : ''
          }`}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <span className="mb-3 text-5xl opacity-30">{currentFolderId ? '📁' : '📎'}</span>
          <p className="text-sm">
            {search ? t.emptySearch : currentFolderId ? t.filesFolderEmpty : t.filesEmpty}
          </p>
        </div>
      ) : hasContent ? (
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
                {canPreview(file) && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                  >
                    {t.filesPreview}
                  </button>
                )}
                <button
                  type="button"
                  disabled={downloadingId === file.id}
                  onClick={() => void downloadFile(file)}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
                >
                  {downloadingId === file.id ? '…' : t.filesDownload}
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
      ) : null}

      {previewFile && user && (
        <FilePreviewModal
          key={previewFile.id}
          file={previewFile}
          uid={user.uid}
          onClose={() => setPreviewFile(null)}
          t={t}
          onDownload={(f) => void downloadFile(f)}
          downloading={downloadingId === previewFile.id}
        />
      )}
    </div>
  );
}
