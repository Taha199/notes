import {
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { storage } from '../firebase';
import { getRtdbAuthToken } from '../rtdb';
import { saveFileMeta } from './fileApi';
import {
  UPLOAD_TOTAL_MS,
  firebaseErrorCode,
  withTimeout,
  type StoredFile,
} from './fileTypes';

/** Friday threshold: files at or under this size go inline in RTDB (no Storage). */
export const MAX_RTDB_FILE_SIZE = 7 * 1024 * 1024;

/** Convert a legacy inline base64/text data URL back into a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIdx = dataUrl.indexOf(',');
  const meta = commaIdx === -1 ? '' : dataUrl.slice(5, commaIdx);
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

/**
 * Fast async dataUrl → Blob for downloads.
 * Prefer native fetch decode (non-blocking); fall back to chunked atob with progress.
 */
export async function dataUrlToBlobWithProgress(
  dataUrl: string,
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  const report = (pct: number) => onProgress?.(Math.max(0, Math.min(100, Math.round(pct))));
  report(5);

  // Browser-native decode is much faster than a main-thread atob loop.
  try {
    const res = await fetch(dataUrl);
    report(55);
    const blob = await res.blob();
    report(100);
    if (blob.size > 0) return blob;
  } catch {
    /* fall through to chunked decode */
  }

  const commaIdx = dataUrl.indexOf(',');
  const meta = commaIdx === -1 ? '' : dataUrl.slice(5, commaIdx);
  const payload = commaIdx === -1 ? '' : dataUrl.slice(commaIdx + 1);
  const contentType = meta.split(';')[0] || 'application/octet-stream';

  if (!/;base64/i.test(meta)) {
    report(80);
    const blob = new Blob([decodeURIComponent(payload)], { type: contentType });
    report(100);
    return blob;
  }

  // Chunked base64 decode (multiples of 4) so the UI can paint % progress.
  const chunkChars = 256 * 1024;
  const parts: BlobPart[] = [];
  const total = payload.length || 1;
  for (let i = 0; i < payload.length; i += chunkChars) {
    const slice = payload.slice(i, Math.min(i + chunkChars, payload.length));
    const binary = atob(slice);
    const bytes = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
    parts.push(bytes);
    report(Math.min(99, 10 + ((i + slice.length) / total) * 90));
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  report(100);
  return new Blob(parts, { type: contentType });
}

function readFileAsDataUrl(file: File, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        onProgress?.(Math.min(95, Math.round((ev.loaded / ev.total) * 100)));
      }
    };
    reader.onload = () => {
      onProgress?.(100);
      resolve(String(reader.result));
    };
    onProgress?.(5);
    reader.readAsDataURL(file);
  });
}

/**
 * Friday upload (b18c0ca):
 * - ≤7MB → read as dataUrl, save to RTDB only (no Storage — rocket fast)
 * - >7MB → client SDK uploadBytes + getDownloadURL
 */
export async function uploadFileToStorage(
  uid: string,
  file: File,
  folderId: string | null,
  onProgress: (pct: number) => void,
): Promise<StoredFile> {
  const token = await getRtdbAuthToken(true);
  if (!token) throw Object.assign(new Error('no-token'), { code: 'no-token' });

  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const base: Omit<StoredFile, 'downloadUrl' | 'storagePath' | 'dataUrl' | 'folderId'> = {
    id,
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    addedAt: new Date().toLocaleString(),
  };
  const withFolder = folderId ? { ...base, folderId } : base;

  // Small files: inline dataUrl in RTDB — never touch Storage (avoids Chrome CORS).
  if (file.size <= MAX_RTDB_FILE_SIZE) {
    const dataUrl = await readFileAsDataUrl(file, onProgress);
    return { ...withFolder, dataUrl };
  }

  // Large files only: Friday Storage path with original file.name.
  const storagePath = `users/${uid}/files/${id}/${file.name}`;
  const storageRef = ref(storage, storagePath);

  onProgress(10);
  await withTimeout(
    uploadBytes(storageRef, file, { contentType: base.type }),
    UPLOAD_TOTAL_MS,
    'upload-timeout',
  );
  onProgress(90);
  const downloadUrl = await withTimeout(
    getDownloadURL(storageRef),
    20_000,
    'download-url-timeout',
  );
  onProgress(100);
  return { ...withFolder, downloadUrl, storagePath };
}

/**
 * Optional one-off move of an inline file into Storage.
 * Not used automatically — small files stay as dataUrl (Friday behavior).
 */
export async function migrateInlineFileToStorage(uid: string, file: StoredFile): Promise<StoredFile> {
  if (!file.dataUrl) return file;
  const blob = dataUrlToBlob(file.dataUrl);
  const storagePath = file.storagePath || `users/${uid}/files/${file.id}/${file.name}`;
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, { contentType: file.type || 'application/octet-stream' });
  const downloadUrl = await getDownloadURL(storageRef);
  const migrated: StoredFile = { ...file, downloadUrl, storagePath };
  delete migrated.dataUrl;
  await saveFileMeta(uid, migrated);
  return migrated;
}

export function uploadErrorMessage(
  err: unknown,
  t: {
    filesUploadPermissionDenied: string;
    filesUploadAuthError: string;
    filesUploadStuck: string;
    filesUploadNetworkError: string;
    filesQuotaExceeded: string;
    filesUploadFailed: string;
  },
): string {
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
    || code === 'upload-bytes-timeout'
    || code === 'upload-timeout'
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
}
