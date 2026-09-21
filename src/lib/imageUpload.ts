import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage, storageLegacy } from './firebase';
import { dataUrlToBlob } from './files/fileStorage';
import { withTimeout } from './files/fileTypes';

const UPLOAD_TIMEOUT_MS = 8_000;
const DOWNLOAD_URL_TIMEOUT_MS = 6_000;
const STORAGE_BLOCKED_KEY = 'malacadhati_storage_blocked';

function readStoredStorageBlocked(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_BLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Session-wide: firebasestorage is blocked (CORS / hospital firewall). */
let cloudStorageBlocked = readStoredStorageBlocked();

export function isCloudStorageBlocked(): boolean {
  return cloudStorageBlocked;
}

export function markCloudStorageBlocked(): void {
  cloudStorageBlocked = true;
  try {
    sessionStorage.setItem(STORAGE_BLOCKED_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

export function resetCloudStorageBlockedForTests(): void {
  cloudStorageBlocked = false;
  try {
    sessionStorage.removeItem(STORAGE_BLOCKED_KEY);
  } catch {
    /* ignore */
  }
}

export function isLikelyStorageNetworkBlock(err: unknown): boolean {
  const code = String((err as { code?: string } | null)?.code || '');
  const msg = String((err as { message?: string } | null)?.message || err || '');
  if (cloudStorageBlocked) return true;
  if (/cors|xmlhttprequest|err_failed|failed to fetch|network error|network-request-failed/i.test(msg)) {
    return true;
  }
  if (
    code === 'storage/retry-limit-exceeded'
    || code === 'storage/canceled'
    || code === 'storage/unknown'
    || code.includes('network')
  ) {
    return true;
  }
  return false;
}

/**
 * Broadcast for "base64 image finished uploading, use this URL instead".
 * The editor inserts immediately for responsiveness; when this fires, both the
 * open editor DOM and any already-persisted note/quiz copy get rewritten.
 */
type ImageSwapListener = (fromUrl: string, toUrl: string) => void;
const swapListeners = new Set<ImageSwapListener>();

export function onEditorImageSwap(listener: ImageSwapListener): () => void {
  swapListeners.add(listener);
  return () => swapListeners.delete(listener);
}

export function emitEditorImageSwap(fromUrl: string, toUrl: string): void {
  swapListeners.forEach((listener) => listener(fromUrl, toUrl));
}

function extForMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

let pendingUploadCount = 0;

/** Uploads still in flight — the beforeunload guard warns while this is > 0. */
export function pendingEditorUploads(): number {
  return pendingUploadCount;
}

/** Force-clear after a hung upload so leave-page warnings cannot stick forever. */
export function clearPendingEditorUploads(): void {
  pendingUploadCount = 0;
}

async function uploadToBucket(
  bucket: typeof storage,
  path: string,
  blob: Blob,
): Promise<string> {
  const storageRef = ref(bucket, path);
  await withTimeout(
    uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' }),
    UPLOAD_TIMEOUT_MS,
    'upload-timeout',
  );
  return withTimeout(getDownloadURL(storageRef), DOWNLOAD_URL_TIMEOUT_MS, 'download-url-timeout');
}

/**
 * Upload an editor image to Firebase Storage and return its download URL.
 * Tries the primary bucket, then the legacy appspot bucket. Returns null when
 * signed out or both uploads fail — the caller keeps the already-inserted preview.
 *
 * Pass `{ trackPending: false }` for background migration so the beforeunload
 * guard and "Saving…" badge are not held open by silent housekeeping uploads.
 */
export async function uploadEditorImage(
  dataUrl: string,
  opts?: { trackPending?: boolean },
): Promise<string | null> {
  if (cloudStorageBlocked) return null;
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  let blob: Blob;
  try {
    blob = dataUrlToBlob(dataUrl);
  } catch (err) {
    console.error('[imageUpload] dataUrlToBlob failed', err);
    return null;
  }
  if (!blob.size) return null;
  const trackPending = opts?.trackPending !== false;
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `users/${uid}/files/${id}/editor-image.${extForMime(blob.type || 'image/jpeg')}`;
  if (trackPending) pendingUploadCount += 1;
  try {
    try {
      return await uploadToBucket(storage, path, blob);
    } catch (primaryErr) {
      if (isLikelyStorageNetworkBlock(primaryErr)) {
        markCloudStorageBlocked();
        return null;
      }
      console.warn('[imageUpload] primary bucket failed, trying legacy', primaryErr);
      return await uploadToBucket(storageLegacy, path, blob);
    }
  } catch (err) {
    if (isLikelyStorageNetworkBlock(err)) markCloudStorageBlocked();
    console.error('[imageUpload] both buckets failed', err);
    return null;
  } finally {
    if (trackPending) pendingUploadCount = Math.max(0, pendingUploadCount - 1);
  }
}
