import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { auth, storage } from './firebase';
import { dataUrlToBlob } from './files/fileStorage';
import { withTimeout } from './files/fileTypes';

const UPLOAD_TIMEOUT_MS = 60_000;
const DOWNLOAD_URL_TIMEOUT_MS = 20_000;

/**
 * Broadcast for "base64 image finished uploading, use this URL instead".
 *
 * The editor swaps the src in its own DOM, but if the user saves and closes
 * the editor before the background upload finishes, the persisted note/quiz
 * item still holds the multi-hundred-KB base64 copy — exactly the payload
 * size that used to overflow localStorage and stall cloud writes. The data
 * layer (NotesContext) subscribes here and rewrites any persisted content
 * containing the base64 form, so the swap lands even after the editor is gone.
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

/**
 * Upload an editor image (as a data URL) to Firebase Storage and return its
 * download URL, so note/quiz HTML stores a short link instead of megabytes of
 * base64. Inline base64 blows past localStorage quota and the Realtime
 * Database's practical write size as images pile up, which is how image-heavy
 * notes/questions used to silently fail to persist.
 *
 * Returns null when signed out — the caller keeps the inline base64 fallback.
 * Uploads live under the files feature's `users/{uid}/files/...` prefix so the
 * existing Storage security rules apply unchanged.
 */
export async function uploadEditorImage(dataUrl: string): Promise<string | null> {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  const blob = dataUrlToBlob(dataUrl);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `users/${uid}/files/${id}/editor-image.${extForMime(blob.type)}`;
  const storageRef = ref(storage, path);
  await withTimeout(
    uploadBytes(storageRef, blob, { contentType: blob.type || 'image/jpeg' }),
    UPLOAD_TIMEOUT_MS,
    'upload-timeout',
  );
  return withTimeout(getDownloadURL(storageRef), DOWNLOAD_URL_TIMEOUT_MS, 'download-url-timeout');
}
