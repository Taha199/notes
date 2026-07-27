import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage, storageLegacy } from './firebase';
import { dataUrlToBlob } from './files/fileStorage';
import { withTimeout } from './files/fileTypes';

const UPLOAD_TIMEOUT_MS = 45_000;
const DOWNLOAD_URL_TIMEOUT_MS = 15_000;

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
 */
export async function uploadEditorImage(dataUrl: string): Promise<string | null> {
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
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `users/${uid}/files/${id}/editor-image.${extForMime(blob.type || 'image/jpeg')}`;
  pendingUploadCount += 1;
  try {
    try {
      return await uploadToBucket(storage, path, blob);
    } catch (primaryErr) {
      console.warn('[imageUpload] primary bucket failed, trying legacy', primaryErr);
      return await uploadToBucket(storageLegacy, path, blob);
    }
  } catch (err) {
    console.error('[imageUpload] both buckets failed', err);
    return null;
  } finally {
    pendingUploadCount = Math.max(0, pendingUploadCount - 1);
  }
}
