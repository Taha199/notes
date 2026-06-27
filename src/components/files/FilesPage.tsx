import { useEffect, useId, useMemo, useState } from 'react';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { FB_DB_URL, storage } from '../../lib/firebase';

interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  downloadUrl?: string;
  storagePath?: string;
  /** Legacy uploads stored inline in Realtime Database */
  dataUrl?: string;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function normalizeFiles(data: unknown): StoredFile[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.filter((file): file is StoredFile => !!file && typeof file === 'object' && 'id' in file);
  }
  if (typeof data === 'object') {
    return Object.values(data as Record<string, StoredFile>).filter(
      (file) => !!file && typeof file === 'object' && 'id' in file,
    );
  }
  return [];
}

function fileHref(file: StoredFile) {
  return file.downloadUrl || file.dataUrl || '#';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export function FilesPage({ search }: { search: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const inputId = useId();
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setFiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`${FB_DB_URL}/users/${user.uid}/files.json`);
        const cloudFiles = await res.json();
        if (!cancelled) {
          setFiles(
            normalizeFiles(cloudFiles).sort(
              (a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime(),
            ),
          );
        }
      } catch {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const saveFileMeta = async (file: StoredFile) => {
    if (!user) throw new Error('no-user');
    const res = await fetch(`${FB_DB_URL}/users/${user.uid}/files/${file.id}.json`, {
      method: 'PUT',
      body: JSON.stringify(file),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error('save-failed');
  };

  const deleteFileMeta = async (fileId: string) => {
    if (!user) return;
    await fetch(`${FB_DB_URL}/users/${user.uid}/files/${fileId}.json`, { method: 'DELETE' });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => file.name.toLowerCase().includes(q) || file.type.toLowerCase().includes(q));
  }, [files, search]);

  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_RTDB_FILE_SIZE = 2 * 1024 * 1024;

  const uploadOneFile = async (file: File): Promise<StoredFile> => {
    if (!user) throw new Error('no-user');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const base: Omit<StoredFile, 'downloadUrl' | 'storagePath' | 'dataUrl'> = {
      id,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      addedAt: new Date().toLocaleString(),
    };

    try {
      const storagePath = `users/${user.uid}/files/${id}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: base.type });
      const downloadUrl = await getDownloadURL(storageRef);
      return { ...base, downloadUrl, storagePath };
    } catch {
      if (file.size > MAX_RTDB_FILE_SIZE) throw new Error('storage-unavailable');
      const dataUrl = await readFileAsDataUrl(file);
      return { ...base, dataUrl };
    }
  };

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !user) return;
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
      for (const file of selected) {
        const stored = await uploadOneFile(file);
        await saveFileMeta(stored);
        uploaded.push(stored);
      }
      if (uploaded.length) {
        setFiles((prev) => [...uploaded, ...prev]);
      }
    } catch {
      setError(t.filesUploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: StoredFile) => {
    setError('');
    const previous = files;
    setFiles((prev) => prev.filter((item) => item.id !== file.id));
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

  return (
    <div className="px-3 py-4 sm:px-5 sm:py-5">
      <div className="mb-5 rounded-3xl border border-app-border bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-2xl shadow-sm shadow-primary/10 dark:bg-primary/20">
              ☁️
            </div>
            <div>
              <h3 className="text-lg font-bold text-app-text dark:text-gray-100">{t.filesTitle}</h3>
              <p className="mt-1 text-sm text-app-text-secondary dark:text-gray-400">{t.filesSub}</p>
            </div>
          </div>
          <label
            htmlFor={inputId}
            aria-disabled={uploading}
            className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark ${
              uploading ? 'pointer-events-none cursor-not-allowed opacity-60' : ''
            }`}
          >
            <span className="text-base">{uploading ? '☁️' : '☁️➕'}</span>
            <span>{uploading ? t.cloudSaving : t.filesUpload}</span>
          </label>
          <input
            id={inputId}
            type="file"
            multiple
            disabled={uploading}
            className="sr-only"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          ⚠️ {error}
        </div>
      )}

      {loading || !filtered.length ? (
        <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
          <span className="mb-3 text-5xl opacity-30">📎</span>
          <p className="text-sm">{loading ? t.cloudSaving : search ? t.emptySearch : t.filesEmpty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((file) => (
            <div key={file.id} className="rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-xl text-primary">📄</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-app-text dark:text-gray-100">{file.name}</div>
                  <div className="mt-1 text-xs text-app-text-secondary dark:text-gray-400">{formatSize(file.size)} · {t.filesStored}</div>
                  <div className="mt-0.5 truncate text-[11px] text-app-text-secondary/70 dark:text-gray-500">{file.addedAt}</div>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={fileHref(file)}
                  download={file.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                >
                  {t.filesOpen}
                </a>
                <button onClick={() => void removeFile(file)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                  {t.filesDelete}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
