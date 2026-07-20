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
export const FILE_INPUT_ID = 'files-upload-input';

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
