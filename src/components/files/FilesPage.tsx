import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { storage } from '../../lib/firebase';
import { rtdbFetch } from '../../lib/rtdb';
import { getStorageLimitBytes } from '../../lib/storageQuota';
import { clientStoragePath, resolvePublicDownloadUrl } from './fileAccess';
import { readApiResponse, requireIdToken } from './apiHelpers';
import { FileDownloadButton } from './FileDownloadButton';
import { FilePreviewModal } from './FilePreviewModal';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';
import {
  canPreviewFile,
  fileDownloadUrl,
  formatFileSize,
  safeStorageFileName,
  type FileFolder,
  type StoredFile,
} from './fileTypes';

const LIST_TIMEOUT_MS = 15_000;
const UPLOAD_STUCK_MS = 10_000;
const UPLOAD_TOTAL_MS = 90_000;
const PROFILE_TIMEOUT_MS = 5_000;
const FILE_INPUT_ID = 'files-upload-input';
const FILES_FOLDER_KEY = 'malacadhati_files_folder';

type UploadProgressItem = {
  key: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
};

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

function firebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  if (err instanceof Error && err.message) return err.message;
  return '';
}

function sortFiles(list: StoredFile[]) {
  return [...list].sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

function sortFolders(list: FileFolder[]) {
  return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
  const urlHydrateAttempted = useRef(new Set<string>());

  useEffect(() => {
    localStorage.setItem(FILES_FOLDER_KEY, JSON.stringify(currentFolderId));
  }, [currentFolderId]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (renamingFolderId) folderRenameRef.current?.focus();
  }, [renamingFolderId]);

  // Load file list — API only (metadata + guaranteed downloadUrl).
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
    urlHydrateAttempted.current = new Set();

    const paint = (data: { files?: StoredFile[]; folders?: FileFolder[] }) => {
      if (cancelled) return;
      setFiles(sortFiles(data.files ?? []));
      setFolders(sortFolders(data.folders ?? []));
    };

    (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
      try {
        const { token } = await requireIdToken();

        type Payload = {
          files?: StoredFile[];
          folders?: FileFolder[];
          migratedRemaining?: boolean;
          error?: string;
          details?: string;
        };
        const res = await fetch('/api/my-files', {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const data = await readApiResponse<Payload>(res);
        if (!res.ok) {
          throw new Error(data.details || data.error || `load:${res.status}`);
        }
        paint(data);
        if (!cancelled) {
          setLoading(false);
          setLoadError('');
        }

        // Background legacy migration — never blocks UI.
        if (data.migratedRemaining) {
          let more = true;
          let guard = 0;
          while (more && !cancelled && guard++ < 40) {
            try {
              const mig = await fetch('/api/my-files?migrate=1', {
                headers: { Authorization: `Bearer ${token}` },
              });
              const migData = await readApiResponse<Payload>(mig);
              if (!mig.ok) break;
              paint(migData);
              more = migData.migratedRemaining === true;
            } catch (migErr) {
              console.warn('[files] migration pass failed', migErr);
              break;
            }
          }
        }
      } catch (err) {
        console.error('[files] list load failed', err);
        if (!cancelled) {
          setFiles([]);
          setFolders([]);
          const detail = err instanceof Error ? err.message : String(err);
          setLoadError(`${t.filesLoadFailed} (${detail})`);
          setLoading(false);
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

  // Fill missing downloadUrl so Ladda ner is always a real instant link.
  useEffect(() => {
    if (!user || loading) return;
    const missing = files.filter(
      (f) => !fileDownloadUrl(f) && !urlHydrateAttempted.current.has(f.id) && (f.storagePath || f.id),
    );
    if (missing.length === 0) return;
    let cancelled = false;

    for (const file of missing) urlHydrateAttempted.current.add(file.id);

    (async () => {
      const updates = new Map<string, Partial<StoredFile>>();
      await Promise.all(
        missing.slice(0, 30).map(async (file) => {
          try {
            const path = clientStoragePath(file, user.uid);
            const enriched = path ? { ...file, storagePath: path } : file;
            const url = await resolvePublicDownloadUrl(enriched, user.uid);
            if (url) {
              updates.set(file.id, {
                downloadUrl: url,
                ...(path ? { storagePath: path } : {}),
              });
            }
          } catch {
            /* leave button disabled for this row */
          }
        }),
      );
      if (cancelled || updates.size === 0) return;
      setFiles((prev) =>
        prev.map((f) => {
          const patch = updates.get(f.id);
          return patch ? { ...f, ...patch } : f;
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [files, user, loading]);

  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null;
  const fileCountInFolder = (folderId: string) => files.filter((f) => f.folderId === folderId).length;

  const saveFileMeta = async (file: StoredFile) => {
    if (!user) throw new Error('no-user');
    const payload = { ...file };
    delete payload.dataUrl;
    const res = await rtdbFetch(`/users/${user.uid}/files/${file.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
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
    const raw = err instanceof Error ? err.message : String(err);
    if (code.includes('unauthorized') || code.includes('permission-denied') || code === 'storage/unauthorized') {
      return `${t.filesUploadPermissionDenied} [${code || raw}]`;
    }
    if (
      code.includes('unauthenticated')
      || code === 'storage/unauthenticated'
      || code === 'auth/user-token-expired'
      || code === 'no-token'
      || code === 'no-user'
      || /signed in|ID token/i.test(raw)
    ) {
      return `${t.filesUploadAuthError} [${code || raw}]`;
    }
    if (code === 'storage/upload-stuck' || code === 'upload-stuck') return `${t.filesUploadStuck} [${raw}]`;
    if (
      code.includes('network')
      || code === 'storage/retry-limit-exceeded'
      || code === 'storage/canceled'
      || code === 'timeout'
      || (err instanceof TypeError && /fetch|network/i.test(err.message))
    ) {
      return `${t.filesUploadNetworkError} [${code || raw}]`;
    }
    if (code === 'quota-exceeded' || code === 'storage/quota-exceeded') return t.filesQuotaExceeded;
    return `${t.filesUploadFailed} [${code || raw}]`;
  };

  const updateUploadItem = (key: string, patch: Partial<UploadProgressItem>) => {
    setUploadItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const uploadResumableOrStuck = (
    storageRef: ReturnType<typeof ref>,
    file: File,
    contentType: string,
    onProgress: (pct: number) => void,
  ): Promise<void> => new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });
    let gotBytes = false;
    let completed = false;
    const stuckTimer = window.setTimeout(() => {
      if (!gotBytes && !completed) {
        try { task.cancel(); } catch { /* ignore */ }
        reject(new Error('storage/upload-stuck'));
      }
    }, UPLOAD_STUCK_MS);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.bytesTransferred > 0) gotBytes = true;
        const total = snapshot.totalBytes || file.size || 1;
        const pct = Math.min(99, Math.round((snapshot.bytesTransferred / total) * 100));
        console.info('[files] upload progress', { name: file.name, pct, bytes: snapshot.bytesTransferred });
        onProgress(pct);
      },
      (err) => {
        window.clearTimeout(stuckTimer);
        console.error('[files] resumable error', { name: file.name, code: firebaseErrorCode(err), err });
        reject(err);
      },
      () => {
        completed = true;
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
    if (!user?.uid) throw new Error('no-user');
    // Ensure auth token is valid before Storage write (rules require request.auth).
    await requireIdToken();

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const safeName = safeStorageFileName(file.name);
    const base = {
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      addedAt: new Date().toLocaleString(),
    };
    const withFolder = folderId ? { ...base, folderId } : base;
    const storagePath = `users/${user.uid}/files/${id}/${safeName}`;
    const storageRef = ref(storage, storagePath);

    console.info('[files] upload start', {
      storagePath,
      fileName: file.name,
      safeName,
      size: file.size,
      type: base.type,
      uid: user.uid,
    });

    let usedFallback = false;
    try {
      await withTimeout(
        uploadResumableOrStuck(storageRef, file, base.type, onProgress),
        UPLOAD_TOTAL_MS,
        'upload-timeout',
      );
    } catch (err) {
      const code = firebaseErrorCode(err);
      // Only fall back when resumable never made progress / network hung — not after a real success.
      if (
        code === 'storage/upload-stuck'
        || code === 'storage/canceled'
        || code.includes('network')
        || code === 'storage/retry-limit-exceeded'
        || code === 'upload-timeout'
      ) {
        console.warn('[files] resumable failed — trying uploadBytes', { code, fileName: file.name });
        usedFallback = true;
        onProgress(5);
        await withTimeout(
          uploadBytes(storageRef, file, { contentType: base.type }),
          UPLOAD_TOTAL_MS,
          'upload-bytes-timeout',
        );
      } else {
        console.error('[files] upload failed (no fallback)', {
          code,
          message: err instanceof Error ? err.message : String(err),
          storagePath,
        });
        throw err;
      }
    }

    onProgress(100);
    const downloadUrl = await withTimeout(getDownloadURL(storageRef), 20_000, 'download-url-timeout');
    console.info('[files] upload done', { storagePath, usedFallback, downloadUrl: downloadUrl.slice(0, 80) });
    return { ...withFolder, downloadUrl, storagePath };
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !user) {
      if (!user) setError(t.filesUploadAuthError);
      return;
    }

    setError('');
    const selected = Array.from(list);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE);
    if (oversized.length) {
      setError(`${t.filesTooLarge} ${oversized.map((f) => f.name).join(', ')}`);
      return;
    }

    const progressKeys = selected.map((file, i) => `${Date.now()}-${i}-${file.name}`);
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
        /* default quota */
      }

      const usedBytes = files.reduce((sum, f) => sum + (f.size > 0 ? f.size : 0), 0);
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
          setFiles((prev) => sortFiles([stored, ...prev.filter((f) => f.id !== stored.id)]));
        } catch (err) {
          console.error('File upload failed', err);
          failureMessages.push(`${file.name}: ${uploadErrorMessage(err)}`);
          updateUploadItem(key, { status: 'error' });
        }
      }

      if (uploaded.length) {
        show(uploaded.length === 1 ? t.filesUploadSuccess : `${uploaded.length} ${t.filesUploadSuccess}`);
      }
      if (failureMessages.length) setError(failureMessages.join(' · '));
    } catch (err) {
      console.error('File upload failed', err);
      setError(uploadErrorMessage(err));
      setUploadItems((prev) =>
        prev.map((item) => (item.status === 'uploading' ? { ...item, status: 'error' } : item)),
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
      window.setTimeout(() => {
        setUploadItems((prev) => prev.filter((p) => p.status === 'uploading'));
      }, failureMessages.length ? 4000 : 1200);
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
      if (file.storagePath) await deleteObject(ref(storage, file.storagePath));
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
      await Promise.all(affected.map((f) => saveFileMeta({ ...f, folderId: undefined })));
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
    if (!next || next === file.name) {
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
          <div className="relative">
            <input
              ref={inputRef}
              id={FILE_INPUT_ID}
              type="file"
              multiple
              disabled={uploading}
              className="sr-only"
              onChange={(e) => { void handleFiles(e.target.files); }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => { if (!uploading) inputRef.current?.click(); }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
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
          onSubmit={(e) => { e.preventDefault(); void createFolder(); }}
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
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">{t.filesUploading}</div>
          {uploadItems.map((item) => (
            <div key={item.key} className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div
                  className={`min-w-0 truncate text-sm font-medium ${
                    item.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-app-text dark:text-gray-100'
                  }`}
                  title={item.name}
                >
                  {item.status === 'error' ? '⚠️ ' : item.status === 'done' ? '✓ ' : ''}
                  {item.name}
                </div>
                <div className={`shrink-0 text-xs font-semibold tabular-nums ${
                  item.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-app-text-secondary dark:text-gray-400'
                }`}>
                  {item.status === 'error' ? '—' : `${item.progress}%`}
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-[width] duration-150 ${
                    item.status === 'error' ? 'bg-red-500' : item.status === 'done' ? 'bg-emerald-500' : 'bg-primary'
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
                      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void commitFolderRename(folder); }}
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
                      onSubmit={(e) => { e.preventDefault(); void commitRename(file); }}
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
                  <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">
                    {formatFileSize(file.size)} · {t.filesStored}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-app-text-secondary/70 dark:text-gray-500">{file.addedAt}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {canPreviewFile(file) && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                  >
                    {t.filesPreview}
                  </button>
                )}
                {user && (
                  <FileDownloadButton
                    file={file}
                    uid={user.uid}
                    label={t.filesDownload}
                    loadingLabel={t.filesDownloading}
                    onErrorMessage={t.filesDownloadFailed}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                  />
                )}
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
                <button
                  onClick={() => void removeFile(file)}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10"
                >
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
        />
      )}
    </div>
  );
}
