import { safeStorageFileName, type StoredFile } from './fileTypes';

export function storagePathFromDownloadUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const idx = u.pathname.indexOf('/o/');
    if (idx === -1) return undefined;
    const encoded = u.pathname.slice(idx + 3);
    return encoded ? decodeURIComponent(encoded) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * All plausible Storage object paths for a file row.
 * Prefer downloadUrl-derived path — it reflects where the object actually lives.
 */
export function candidateStoragePaths(file: StoredFile, uid?: string): string[] {
  const paths: string[] = [];
  const add = (p?: string) => {
    if (p && !paths.includes(p)) paths.push(p);
  };
  if (file.downloadUrl) add(storagePathFromDownloadUrl(file.downloadUrl));
  add(file.storagePath);
  if (uid && file.id && file.name) {
    add(`users/${uid}/files/${file.id}/${safeStorageFileName(file.name)}`);
    add(`users/${uid}/files/${file.id}/${file.name}`);
    const underscored = file.name.replace(/\s+/g, '_');
    if (underscored !== file.name) {
      add(`users/${uid}/files/${file.id}/${underscored}`);
      add(`users/${uid}/files/${file.id}/${safeStorageFileName(underscored)}`);
    }
  }
  return paths;
}

export function resolveStoragePath(file: StoredFile, uid?: string): string | undefined {
  return candidateStoragePaths(file, uid)[0];
}

/** Friday path shape — raw file.name (matches historical client uploads). */
export function defaultStoragePath(uid: string, fileId: string, fileName: string): string {
  return `users/${uid}/files/${fileId}/${fileName}`;
}
