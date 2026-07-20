import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getStorageLimitBytes } from '../../lib/storageQuota';
import {
  FILE_INPUT_ID,
  FILES_FOLDER_KEY,
  MAX_FILE_SIZE_BYTES,
  canPreviewFile,
  deleteFileFully,
  deleteFolderMeta,
  downloadStoredFile,
  fetchUserProfile,
  formatFileSize,
  isMissingStorageError,
  loadFilesWithFallback,
  migrateInlineFileToStorage,
  openDownloadUrlNow,
  runBackgroundMigration,
  saveFileMeta,
  saveFolderMeta,
  uploadErrorMessage,
  uploadFileToStorage,
  withTimeout,
  type FileFolder,
  type StoredFile,
  type UploadProgressItem,
} from '../../lib/files';
import { FilePreviewModal } from './FilePreviewModal';
import { FilesLoadingIndicator } from './FilesLoadingIndicator';

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

    (async () => {
      try {
        const { list, fromApi } = await loadFilesWithFallback(user.uid);
        if (cancelled) return;
        setFiles(list.files);
        setFolders(list.folders);
        setLoading(false);
        setLoadError('');

        if (fromApi && list.migratedRemaining) {
          try {
            await runBackgroundMigration(
              (mig) => {
                if (cancelled) return;
                setFiles(mig.files);
                setFolders(mig.folders);
              },
              () => cancelled,
            );
          } catch (migErr) {
            console.warn('Background file migration failed', migErr);
          }
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
          setFolders([]);
          setLoadError(t.filesLoadFailed);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user, reloadNonce, t.filesLoadFailed]);

  useEffect(() => {
    if (currentFolderId && !folders.some((f) => f.id === currentFolderId)) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, folders]);

  // Keep open preview in sync when list migration fills downloadUrl/storagePath.
  useEffect(() => {
    if (!previewFile) return;
    const latest = files.find((f) => f.id === previewFile.id);
    if (!latest) return;
    if (
      latest.downloadUrl !== previewFile.downloadUrl
      || latest.storagePath !== previewFile.storagePath
      || latest.inlinePending !== previewFile.inlinePending
      || latest.dataUrl !== previewFile.dataUrl
    ) {
      setPreviewFile(latest);
    }
  }, [files, previewFile]);

  // Client-side migrate only when RTDB fallback still has inline dataUrl.
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
          const migrated = await migrateInlineFileToStorage(user.uid, file);
          if (!cancelled) {
            setFiles((prev) => prev.map((f) => (f.id === file.id ? migrated : f)));
          }
        } catch {
          /* keep inline copy on failure */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [files, user]);

  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null;
  const fileCountInFolder = (folderId: string) =>
    files.filter((f) => f.folderId === folderId).length;

  const q = search.trim().toLowerCase();

  const visibleFolders = useMemo(() => {
    if (currentFolderId) return [];
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, currentFolderId, q]);

  const visibleFiles = useMemo(() => {
    if (q) {
      return files.filter(
        (file) => file.name.toLowerCase().includes(q) || file.type.toLowerCase().includes(q),
      );
    }
    return files.filter((file) =>
      currentFolderId ? file.folderId === currentFolderId : !file.folderId,
    );
  }, [files, currentFolderId, q]);

  const updateUploadItem = (key: string, patch: Partial<UploadProgressItem>) => {
    setUploadItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    if (!user) {
      setError(t.filesUploadAuthError);
      return;
    }

    setError('');
    const selected = Array.from(list);
    const oversized = selected.filter((f) => f.size > MAX_FILE_SIZE_BYTES);
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
      const profile = await fetchUserProfile(user.uid);
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
          // Storage FIRST → then RTDB meta with retry.
          const stored = await uploadFileToStorage(user.uid, file, currentFolderId, (pct) => {
            updateUploadItem(key, { progress: pct, status: 'uploading' });
          });
          await withTimeout(saveFileMeta(user.uid, stored), 20_000, 'meta-save-timeout');
          uploaded.push(stored);
          updateUploadItem(key, { progress: 100, status: 'done' });
          setFiles((prev) => [stored, ...prev.filter((f) => f.id !== stored.id)]);
        } catch (err) {
          console.error('File upload failed', err);
          failureMessages.push(`${file.name}: ${uploadErrorMessage(err, t)}`);
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
      setError(uploadErrorMessage(err, t));
      setUploadItems((prev) =>
        prev.map((item) => (item.status === 'uploading' ? { ...item, status: 'error' } : item)),
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
      const clearDelay = failureMessages.length ? 4000 : 1200;
      window.setTimeout(() => {
        setUploadItems((prev) => prev.filter((p) => p.status === 'uploading'));
      }, clearDelay);
    }
  };

  const removeFile = async (file: StoredFile) => {
    if (!user) return;
    setError('');
    const previous = files;
    setFiles((prev) => prev.filter((item) => item.id !== file.id));
    if (previewFile?.id === file.id) setPreviewFile(null);
    if (renamingId === file.id) setRenamingId(null);
    if (moveMenuFileId === file.id) setMoveMenuFileId(null);
    try {
      await deleteFileFully(user.uid, file);
    } catch {
      setFiles(previous);
      setError(t.filesSaveFailed);
    }
  };

  const moveFile = async (file: StoredFile, folderId: string | null) => {
    if (!user) return;
    const updated: StoredFile = { ...file };
    if (folderId) updated.folderId = folderId;
    else delete updated.folderId;
    const previous = files;
    setFiles((prev) => prev.map((item) => (item.id === file.id ? updated : item)));
    setMoveMenuFileId(null);
    try {
      await saveFileMeta(user.uid, updated);
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
      await saveFolderMeta(user.uid, folder);
      setFolders((prev) => [folder, ...prev]);
      setCreatingFolder(false);
      setNewFolderName('');
      show(t.filesFolderCreated);
    } catch {
      setError(t.filesSaveFailed);
    }
  };

  const removeFolder = async (folder: FileFolder) => {
    if (!user) return;
    const previousFiles = files;
    const previousFolders = folders;
    const affected = files.filter((f) => f.folderId === folder.id);
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    setFiles((prev) =>
      prev.map((f) => (f.folderId === folder.id ? { ...f, folderId: undefined } : f)),
    );
    if (currentFolderId === folder.id) setCurrentFolderId(null);
    try {
      await deleteFolderMeta(user.uid, folder.id);
      await Promise.all(
        affected.map((f) => saveFileMeta(user.uid, { ...f, folderId: undefined })),
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
    if (!user) return;
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
      await saveFileMeta(user.uid, updated);
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
    if (!user) return;
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
      await saveFolderMeta(user.uid, updated);
      show(t.filesRenameSuccess);
    } catch {
      setFolders(previous);
      setError(t.filesSaveFailed);
    }
  };

  const downloadFile = async (file: StoredFile) => {
    // Instant path: open CDN URL during the click gesture — never buffer bytes first.
    const direct = (file.downloadUrl || '').trim();
    if (direct && !direct.startsWith('data:') && !direct.startsWith('blob:')) {
      if (openDownloadUrlNow(direct, file.name)) return;
    }
    if (downloadingId === file.id) return;
    setDownloadingId(file.id);
    setError('');
    const clearGuard = window.setTimeout(() => setDownloadingId(null), 20_000);
    try {
      await downloadStoredFile(file, user?.uid);
    } catch (err) {
      console.error('File download failed', err);
      const msg = isMissingStorageError(err) ? t.filesMissingInStorage : t.filesDownloadFailed;
      setError(msg);
      show(msg);
      window.alert(msg);
    } finally {
      window.clearTimeout(clearGuard);
      setDownloadingId((id) => (id === file.id ? null : id));
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
                  <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">{formatFileSize(file.size)} · {t.filesStored}</div>
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

      {previewFile && (
        <FilePreviewModal
          file={previewFile}
          uid={user?.uid}
          onClose={() => setPreviewFile(null)}
          onDelete={(f) => void removeFile(f)}
          t={t}
          onDownload={(f) => void downloadFile(f)}
          downloading={downloadingId === previewFile.id}
        />
      )}
    </div>
  );
}
