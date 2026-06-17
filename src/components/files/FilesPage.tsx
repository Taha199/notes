import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { FB_DB_URL } from '../../lib/firebase';

interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  addedAt: string;
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function readFile(file: File): Promise<StoredFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result),
        addedAt: new Date().toLocaleString(),
      });
    };
    reader.readAsDataURL(file);
  });
}

export function FilesPage({ search }: { search: string }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

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
        if (!cancelled) setFiles(Array.isArray(cloudFiles) ? cloudFiles : []);
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

  const saveFiles = async (next: StoredFile[]) => {
    if (!user) return;
    setFiles(next);
    await fetch(`${FB_DB_URL}/users/${user.uid}/files.json`, {
      method: 'PUT',
      body: JSON.stringify(next),
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter((file) => file.name.toLowerCase().includes(q) || file.type.toLowerCase().includes(q));
  }, [files, search]);

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !user) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(list).map(readFile));
      await saveFiles([...uploaded, ...files]);
      if (inputRef.current) inputRef.current.value = '';
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (file: StoredFile) => {
    await saveFiles(files.filter((item) => item.id !== file.id));
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
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="text-base">{uploading ? '☁️' : '☁️➕'}</span>
            <span>{uploading ? t.cloudSaving : t.filesUpload}</span>
          </button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
        </div>
      </div>

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
                <a href={file.dataUrl} download={file.name} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
                  {t.filesOpen}
                </a>
                <button onClick={() => removeFile(file)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
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
