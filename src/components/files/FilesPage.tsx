import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { FB_DB_URL, storage } from '../../lib/firebase';
import { calculateUserStorageBytes, getStorageLimitBytes } from '../../lib/storageQuota';

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
}

interface FileFolder {
  id: string;
  name: string;
  createdAt: string;
}

type PreviewMode = 'image' | 'pdf' | 'text' | 'unsupported';

const FILE_INPUT_ID = 'files-upload-input';
const FILES_FOLDER_KEY = 'malacadhati_files_folder';

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
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
  return res.text();
}

function FilePreviewModal({ file, onClose, t }: { file: StoredFile; onClose: () => void; t: { filesDownload: string; filesPreviewUnavailable: string } }) {
  const href = fileHref(file);
  const mode = previewModeFor(file);
  const [textContent, setTextContent] = useState('');
  const [loadingText, setLoadingText] = useState(mode === 'text');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (mode !== 'text') return;
    let cancelled = false;
    setLoadingText(true);
    (async () => {
      try {
        const body = await loadTextPreview(file, href);
        if (!cancelled) setTextContent(body);
      } catch {
        if (!cancelled) setTextContent(t.filesPreviewUnavailable);
      } finally {
        if (!cancelled) setLoadingText(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file, href, mode, t.filesPreviewUnavailable]);

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
          <a
            href={href}
            download={file.name}
            className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-gray-900 hover:bg-gray-100"
            onClick={(e) => e.stopPropagation()}
          >
            {t.filesDownload}
          </a>
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
        {mode === 'image' && (
          <img src={href} alt={file.name} className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl" />
        )}
        {mode === 'pdf' && (
          <iframe title={file.name} src={href} className="h-[85vh] w-full max-w-5xl rounded-lg bg-white shadow-2xl" />
        )}
        {mode === 'text' && (
          <pre className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-4 text-left text-sm text-gray-900 shadow-2xl dark:bg-gray-900 dark:text-gray-100">
            {loadingText ? '…' : textContent}
          </pre>
        )}
        {mode === 'unsupported' && (
          <p className="rounded-xl bg-white/10 px-4 py-3 text-sm text-white">{t.filesPreviewUnavailable}</p>
        )}
      </div>
    </div>,
    document.body,
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
      try {
        const [filesRes, foldersRes] = await Promise.all([
          fetch(`${FB_DB_URL}/users/${user.uid}/files.json`),
          fetch(`${FB_DB_URL}/users/${user.uid}/fileFolders.json`),
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
    const res = await fetch(`${FB_DB_URL}/users/${user.uid}/files/${file.id}.json`, {
      method: 'PUT',
      body: JSON.stringify(file),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('save-failed');
  };

  const saveFolderMeta = async (folder: FileFolder) => {
    if (!user) throw new Error('no-user');
    const res = await fetch(`${FB_DB_URL}/users/${user.uid}/fileFolders/${folder.id}.json`, {
      method: 'PUT',
      body: JSON.stringify(folder),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('save-failed');
  };

  const deleteFileMeta = async (fileId: string) => {
    if (!user) return;
    await fetch(`${FB_DB_URL}/users/${user.uid}/files/${fileId}.json`, { method: 'DELETE' });
  };

  const deleteFolderMeta = async (folderId: string) => {
    if (!user) return;
    await fetch(`${FB_DB_URL}/users/${user.uid}/fileFolders/${folderId}.json`, { method: 'DELETE' });
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
  const MAX_RTDB_FILE_SIZE = 7 * 1024 * 1024;

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

    if (file.size <= MAX_RTDB_FILE_SIZE) {
      const dataUrl = await readFileAsDataUrl(file);
      return { ...withFolder, dataUrl };
    }

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
      const userRes = await fetch(`${FB_DB_URL}/users/${user.uid}.json`);
      const userData = (await userRes.json()) ?? {};
      const profile = (userData.profile ?? {}) as Record<string, unknown>;
      const usedBytes = calculateUserStorageBytes(userData);
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
          <span className="mb-3 text-5xl opacity-30">{currentFolderId ? '📁' : '📎'}</span>
          <p className="text-sm">
            {loading ? t.cloudSaving : search ? t.emptySearch : currentFolderId ? t.filesFolderEmpty : t.filesEmpty}
          </p>
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
                {canPreview(file) && (
                  <button
                    type="button"
                    onClick={() => setPreviewFile(file)}
                    className="rounded-lg border border-app-border bg-app-bg px-3 py-1.5 text-xs font-semibold text-app-text hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-gray-100 dark:hover:bg-white/10"
                  >
                    {t.filesPreview}
                  </button>
                )}
                <a
                  href={fileHref(file)}
                  download={file.name}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                >
                  {t.filesDownload}
                </a>
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
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} t={t} />
      )}
    </div>
  );
}
