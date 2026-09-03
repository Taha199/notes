export interface StoredFile {
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
  /** Server withheld the inline blob; recover via /api/file-download */
  inlinePending?: boolean;
}

export interface FileFolder {
  id: string;
  name: string;
  createdAt: string;
}

export type PreviewMode = 'image' | 'pdf' | 'text' | 'docx' | 'unsupported';

export type UploadProgressItem = {
  key: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
};

export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const LIST_TIMEOUT_MS = 15_000;
export const UPLOAD_STUCK_MS = 10_000;
export const UPLOAD_TOTAL_MS = 90_000;
export const PROFILE_TIMEOUT_MS = 5_000;
export const FILES_FOLDER_KEY = 'malacadhati_files_folder';
export const FILES_SORT_KEY = 'malacadhati_files_sort';
export const FILE_INPUT_ID = 'files-upload-input';

export type FileSort = 'date-new' | 'date-old' | 'size-large' | 'size-small';

export function isFileSort(value: string): value is FileSort {
  return value === 'date-new' || value === 'date-old' || value === 'size-large' || value === 'size-small';
}

function localDateMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * Parse StoredFile.addedAt. Uploads used toLocaleString(), so values mix
 * `2026-07-21 00:38:32` and `29/07/2026, 09:58:32`. Date.parse treats the latter
 * as US MM/DD (or NaN), which made "nyast" look unchanged.
 */
export function fileAddedAtMs(addedAt: string): number {
  const raw = (addedAt || '').trim();
  if (!raw) return 0;

  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    if (/Z|[+-]\d{2}:\d{2}\s*$/i.test(raw)) {
      const iso = Date.parse(raw);
      if (!Number.isNaN(iso)) return iso;
    }
    return localDateMs(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  }

  m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const first = +m[1];
    const second = +m[2];
    const year = +m[3];
    const hour = m[4] ? +m[4] : 0;
    const minute = m[5] ? +m[5] : 0;
    const secondOf = m[6] ? +m[6] : 0;
    let day = first;
    let month = second;
    if (first <= 12 && second > 12) {
      month = first;
      day = second;
    }
    return localDateMs(year, month, day, hour, minute, secondOf);
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function formatFileAddedAt(addedAt: string): string {
  const ms = fileAddedAtMs(addedAt);
  if (!ms) return addedAt;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function sortStoredFiles(files: StoredFile[], sort: FileSort): StoredFile[] {
  const next = [...files];
  next.sort((a, b) => {
    if (sort === 'size-large') return (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name);
    if (sort === 'size-small') return (a.size || 0) - (b.size || 0) || a.name.localeCompare(b.name);
    const da = fileAddedAtMs(a.addedAt);
    const db = fileAddedAtMs(b.addedAt);
    if (sort === 'date-old') return da - db || a.name.localeCompare(b.name);
    return db - da || a.name.localeCompare(b.name);
  });
  return next;
}

export function safeStorageFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\?#%[\]*]+/g, '_')
    // Spaces / unicode whitespace → underscore (avoids awkward %20 paths)
    .replace(/[\s\u00A0]+/g, '_')
    .replace(/_+/g, '_')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function previewModeFor(file: StoredFile): PreviewMode {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html?)$/i.test(name)) return 'text';
  return 'unsupported';
}

export function canPreviewFile(file: StoredFile): boolean {
  return previewModeFor(file) !== 'unsupported';
}

/** Prefer recoverable inline blob over a possibly-stale Storage URL. */
export function fileHref(file: StoredFile): string {
  if (file.dataUrl?.startsWith('data:')) return file.dataUrl.trim();
  return (file.downloadUrl || '').trim();
}

/** True when the list entry is a Friday ≤7MB inline file whose dataUrl was stripped. */
export function isInlinePendingFile(file: StoredFile): boolean {
  if (file.dataUrl?.startsWith('data:')) return false;
  if (file.inlinePending === true) return true;
  const url = (file.downloadUrl || '').trim();
  if (url && !url.startsWith('data:') && !url.startsWith('blob:')) return false;
  // No CDN URL and no Storage path → must be (or was) RTDB-inline.
  return !file.storagePath;
}

/** Merge a hydrated RTDB record onto list metadata (restore dataUrl, clear pending). */
export function withHydratedInline(base: StoredFile, full: StoredFile): StoredFile {
  const dataUrl = full.dataUrl?.startsWith('data:') ? full.dataUrl : base.dataUrl;
  const downloadUrl = (full.downloadUrl || base.downloadUrl || '').trim() || undefined;
  const storagePath = (full.storagePath || base.storagePath || '').trim() || undefined;
  const next: StoredFile = {
    ...base,
    ...full,
    id: base.id,
    downloadUrl,
    storagePath,
    dataUrl,
  };
  if (dataUrl?.startsWith('data:')) {
    delete next.inlinePending;
  }
  return next;
}

/** Drop heavy base64 payloads so the UI never holds multi‑MB strings. */
export function lightFileMeta(file: StoredFile): StoredFile {
  if (!file.dataUrl) return file;
  const { dataUrl, ...rest } = file;
  void dataUrl;
  return { ...rest, inlinePending: true };
}

export function normalizeList<T extends { id: string }>(data: unknown): T[] {
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

export function firebaseErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  if (err instanceof Error && err.message) return err.message;
  return '';
}

export function isMissingStorageError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = firebaseErrorCode(err);
  return (
    msg === 'MISSING_IN_STORAGE'
    || msg === 'no-file-source'
    || /storage-object-not-found|storage\/object-not-found|object-not-found/i.test(msg)
    || code === 'storage/object-not-found'
  );
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
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
