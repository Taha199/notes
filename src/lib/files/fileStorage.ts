import {
  getDownloadURL,
  ref,
  uploadBytes,
  uploadBytesResumable,
} from 'firebase/storage';
import { storage } from '../firebase';
import { getRtdbAuthToken } from '../rtdb';
import { saveFileMeta } from './fileApi';
import { defaultStoragePath } from './filePaths';
import {
  UPLOAD_STUCK_MS,
  UPLOAD_TOTAL_MS,
  firebaseErrorCode,
  withTimeout,
  type StoredFile,
} from './fileTypes';

/** Stay under Vercel Hobby ~4.5MB request body limit. */
export const SERVER_UPLOAD_MAX_BYTES = 3_500_000;

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

function isChromium(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua);
}

/**
 * Resumable upload with stagnation detection.
 * Aborts after UPLOAD_STUCK_MS with no increase in bytesTransferred
 * (including the classic CORS hang stuck at ~5%).
 */
function uploadResumableOrStuck(
  storageRef: ReturnType<typeof ref>,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, { contentType });
    let lastBytes = 0;
    let lastProgressAt = Date.now();
    let settled = false;

    const failStuck = () => {
      if (settled) return;
      settled = true;
      window.clearInterval(watchdog);
      try { task.cancel(); } catch { /* ignore */ }
      reject(Object.assign(new Error('storage/upload-stuck'), { code: 'storage/upload-stuck' }));
    };

    const watchdog = window.setInterval(() => {
      if (Date.now() - lastProgressAt >= UPLOAD_STUCK_MS) failStuck();
    }, 500);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.bytesTransferred > lastBytes) {
          lastBytes = snapshot.bytesTransferred;
          lastProgressAt = Date.now();
        }
        const total = snapshot.totalBytes || file.size || 1;
        onProgress(Math.min(99, Math.round((snapshot.bytesTransferred / total) * 100)));
      },
      (err) => {
        if (settled) return;
        settled = true;
        window.clearInterval(watchdog);
        reject(err);
      },
      () => {
        if (settled) return;
        settled = true;
        window.clearInterval(watchdog);
        resolve();
      },
    );
  });
}

function isClientUploadFailure(err: unknown): boolean {
  const code = firebaseErrorCode(err);
  return (
    code === 'storage/upload-stuck'
    || code === 'storage/canceled'
    || code === 'upload-bytes-timeout'
    || code === 'upload-timeout'
    || code === 'storage/retry-limit-exceeded'
    || code.includes('network')
    || code.includes('cors')
    || (err instanceof TypeError && /fetch|network|failed/i.test(err.message))
  );
}

/**
 * Server-side Storage write via /api/my-files (bypasses browser CORS entirely).
 * Limited by Vercel Hobby body size — only for smaller files.
 */
async function uploadViaServerProxy(
  file: File,
  fileId: string,
  folderId: string | null,
  onProgress: (pct: number) => void,
): Promise<Pick<StoredFile, 'downloadUrl' | 'storagePath'>> {
  const token = await getRtdbAuthToken(true);
  if (!token) throw Object.assign(new Error('no-token'), { code: 'no-token' });

  onProgress(15);
  const res = await withTimeout(
    fetch('/api/my-files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Id': fileId,
        ...(folderId ? { 'X-Folder-Id': folderId } : {}),
      },
      body: file,
    }),
    UPLOAD_TOTAL_MS,
    'server-upload-timeout',
  );

  onProgress(85);
  if (!res.ok) {
    let details = '';
    try {
      const body = await res.json() as { error?: string; details?: string };
      details = body.details || body.error || '';
    } catch { /* ignore */ }
    const code = details || `server-upload-failed:${res.status}`;
    throw Object.assign(new Error(code), { code });
  }

  const data = await res.json() as { downloadUrl?: string; storagePath?: string };
  if (!data.downloadUrl || !data.storagePath) {
    throw Object.assign(new Error('server-upload-incomplete'), { code: 'server-upload-incomplete' });
  }
  return { downloadUrl: data.downloadUrl, storagePath: data.storagePath };
}

/**
 * Upload file bytes to Storage FIRST, then return metadata for RTDB.
 * Never writes RTDB until Storage succeeds.
 *
 * Strategy (Chrome custom-domain CORS often breaks resumable + PUT):
 * 1. Prefer simple uploadBytes (single PUT) — especially on Chromium
 * 2. Fall back to resumable with stuck detection
 * 3. Fall back to server proxy for files under SERVER_UPLOAD_MAX_BYTES
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

  const storagePath = defaultStoragePath(uid, id, file.name);
  const storageRef = ref(storage, storagePath);

  const tryUploadBytes = async (timeoutMs: number) => {
    onProgress(5);
    await withTimeout(
      uploadBytes(storageRef, file, { contentType: base.type }),
      timeoutMs,
      'upload-bytes-timeout',
    );
  };

  const tryResumable = async () => {
    onProgress(5);
    await uploadResumableOrStuck(storageRef, file, base.type, onProgress);
  };

  const runClientUpload = async () => {
    // Chromium + custom domain: resumable often hangs at 0% — try simple PUT first.
    // Fail fast (~12s) so server proxy can take over before the user gives up.
    // Other browsers: try resumable first for better progress, then simple PUT.
    if (isChromium()) {
      try {
        await tryUploadBytes(12_000);
        return;
      } catch (err) {
        if (!isClientUploadFailure(err)) throw err;
      }
      await tryResumable();
      return;
    }

    try {
      await tryResumable();
    } catch (err) {
      if (!isClientUploadFailure(err)) throw err;
      onProgress(10);
      await tryUploadBytes(45_000);
    }
  };

  let downloadUrl: string;
  let finalPath = storagePath;

  try {
    await withTimeout(runClientUpload(), UPLOAD_TOTAL_MS, 'upload-timeout');
    onProgress(95);
    downloadUrl = await withTimeout(getDownloadURL(storageRef), 20_000, 'download-url-timeout');
  } catch (clientErr) {
    // Do not surface "stuck at 0%" until server fallback has been tried (when eligible).
    if (file.size <= SERVER_UPLOAD_MAX_BYTES && isClientUploadFailure(clientErr)) {
      try {
        const proxied = await uploadViaServerProxy(file, id, folderId, onProgress);
        downloadUrl = proxied.downloadUrl!;
        finalPath = proxied.storagePath!;
      } catch (serverErr) {
        // Prefer the more specific server error; keep client code as cause chain.
        const serverCode = firebaseErrorCode(serverErr);
        if (serverCode) throw serverErr;
        throw clientErr;
      }
    } else {
      throw clientErr;
    }
  }

  onProgress(100);
  return { ...withFolder, downloadUrl, storagePath: finalPath };
}

/**
 * Move a legacy inline (base64) file into Storage and drop the heavy dataUrl.
 * Storage success FIRST → then RTDB meta (retry via saveFileMeta).
 */
export async function migrateInlineFileToStorage(uid: string, file: StoredFile): Promise<StoredFile> {
  if (!file.dataUrl) return file;
  const blob = dataUrlToBlob(file.dataUrl);
  const storagePath = file.storagePath || defaultStoragePath(uid, file.id, file.name);
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
    || code === 'server-upload-timeout'
  ) {
    return t.filesUploadStuck;
  }
  if (
    code.includes('network')
    || code === 'storage/retry-limit-exceeded'
    || code === 'storage/canceled'
    || code === 'timeout'
    || code.includes('server-upload')
    || (err instanceof TypeError && /fetch|network/i.test(err.message))
  ) {
    return `${t.filesUploadNetworkError}${code ? ` (${code})` : ''}`;
  }
  if (code === 'quota-exceeded' || code === 'storage/quota-exceeded') {
    return t.filesQuotaExceeded;
  }
  return `${t.filesUploadFailed}${code ? ` (${code})` : ''}`;
}
