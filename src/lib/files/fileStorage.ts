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
 * Upload file bytes to Storage FIRST, then return metadata for RTDB.
 * Never writes RTDB until Storage succeeds.
 *
 * Friday working path (b18c0ca): client SDK uploadBytes + getDownloadURL only.
 * No server proxy — GCS JSON API via service account returns "bucket does not exist"
 * for both firebasestorage.app and appspot.com on this project.
 */
export async function uploadFileToStorage(
  uid: string,
  file: File,
  folderId: string | null,
  onProgress: (pct: number) => void,
): Promise<StoredFile> {
  // Ensure auth is ready (fresh token) before touching Storage.
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

  // Same path shape as Friday FilesPage: users/{uid}/files/{id}/{file.name}
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
 * Move a legacy inline (base64) file into Storage and drop the heavy dataUrl.
 * Storage success FIRST → then RTDB meta (retry via saveFileMeta).
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
