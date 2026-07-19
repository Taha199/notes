import { randomUUID } from 'node:crypto';
import { STORAGE_BUCKET } from './firebaseAdmin.js';

export const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** Extract Storage object path from a Firebase download URL. */
export function storagePathFromDownloadUrl(url) {
  if (!url || typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    const marker = '/o/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return undefined;
    const encoded = u.pathname.slice(idx + marker.length);
    if (!encoded) return undefined;
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

export function firebaseMediaUrl(objectPath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/** Upload bytes and attach a Firebase download token. Throws if either step fails. */
export async function uploadToStorage(storageToken, objectPath, buffer, contentType) {
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    body: buffer,
  });
  if (!uploadRes.ok) throw new Error(`storage-upload-failed:${uploadRes.status}`);
  return mintDownloadToken(storageToken, objectPath, contentType);
}

/** Attach / refresh a Firebase download token on an existing object. */
export async function mintDownloadToken(storageToken, objectPath, contentType) {
  const token = randomUUID();
  const patchUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}`;
  const body = {
    metadata: { firebaseStorageDownloadTokens: token },
  };
  if (contentType) body.contentType = contentType;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!patchRes.ok) throw new Error(`storage-token-failed:${patchRes.status}`);
  return firebaseMediaUrl(objectPath, token);
}

/** Download object bytes via GCS JSON API (service account). */
export async function downloadFromStorage(storageToken, objectPath) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}?alt=media`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${storageToken}` },
  });
  if (!res.ok) throw new Error(`storage-download-failed:${res.status}`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

export function resolveStoragePath(file, uid) {
  if (!file || typeof file !== 'object') return undefined;
  return (
    file.storagePath
    || (file.downloadUrl ? storagePathFromDownloadUrl(file.downloadUrl) : undefined)
    || (uid && file.id && file.name ? `users/${uid}/files/${file.id}/${file.name}` : undefined)
  );
}
