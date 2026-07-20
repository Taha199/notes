import { deleteObject, ref } from 'firebase/storage';
import { storageBuckets } from '../firebase';
import { getRtdbAuthToken, rtdbFetch } from '../rtdb';
import {
  LIST_TIMEOUT_MS,
  PROFILE_TIMEOUT_MS,
  lightFileMeta,
  normalizeList,
  withTimeout,
  type FileFolder,
  type StoredFile,
} from './fileTypes';

export type FilesListPayload = {
  files: StoredFile[];
  folders: FileFolder[];
  migratedRemaining?: boolean;
};

async function authFetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('no-token');
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });
  if (!res.ok) throw new Error(`load-failed:${res.status}`);
  return res.json() as Promise<T>;
}

function sortFiles(files: StoredFile[]): StoredFile[] {
  return files
    .map(lightFileMeta)
    .sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

function sortFolders(folders: FileFolder[]): FileFolder[] {
  return folders.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Metadata-only list via /api/my-files (strips legacy dataUrl blobs). */
export async function fetchFilesList(signal?: AbortSignal): Promise<FilesListPayload> {
  const data = await authFetchJson<{
    files?: StoredFile[];
    folders?: FileFolder[];
    migratedRemaining?: boolean;
  }>('/api/my-files', signal);
  return {
    files: sortFiles(data.files ?? []),
    folders: sortFolders(data.folders ?? []),
    migratedRemaining: data.migratedRemaining === true,
  };
}

/** Background migrate legacy inline blobs to Storage (small batches). */
export async function migrateFilesBatch(signal?: AbortSignal): Promise<FilesListPayload> {
  const data = await authFetchJson<{
    files?: StoredFile[];
    folders?: FileFolder[];
    migratedRemaining?: boolean;
  }>('/api/my-files?migrate=1', signal);
  return {
    files: sortFiles(data.files ?? []),
    folders: sortFolders(data.folders ?? []),
    migratedRemaining: data.migratedRemaining === true,
  };
}

/** Direct RTDB fallback when the list API is unreachable. */
export async function fetchFilesListFromRtdb(uid: string, signal?: AbortSignal): Promise<FilesListPayload> {
  const [filesRes, foldersRes] = await Promise.all([
    rtdbFetch(`/users/${uid}/files`, { signal }),
    rtdbFetch(`/users/${uid}/fileFolders`, { signal }),
  ]);
  if (!filesRes.ok || !foldersRes.ok) throw new Error('rtdb-fallback-failed');
  const cloudFiles = await filesRes.json();
  const cloudFolders = await foldersRes.json();
  return {
    files: sortFiles(normalizeList<StoredFile>(cloudFiles)),
    folders: sortFolders(normalizeList<FileFolder>(cloudFolders)),
  };
}

export async function loadFilesWithFallback(uid: string): Promise<{
  list: FilesListPayload;
  fromApi: boolean;
}> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
  try {
    const list = await fetchFilesList(controller.signal);
    return { list, fromApi: true };
  } catch {
    const fallbackCtrl = new AbortController();
    const fallbackTimer = window.setTimeout(() => fallbackCtrl.abort(), LIST_TIMEOUT_MS);
    try {
      const list = await fetchFilesListFromRtdb(uid, fallbackCtrl.signal);
      return { list, fromApi: false };
    } finally {
      window.clearTimeout(fallbackTimer);
    }
  } finally {
    window.clearTimeout(timer);
  }
}

/** Run background migration until done or cancelled (never blocks list paint). */
export async function runBackgroundMigration(
  onUpdate: (list: FilesListPayload) => void,
  cancelled: () => boolean,
): Promise<void> {
  let more = true;
  let guard = 0;
  while (more && !cancelled() && guard++ < 40) {
    const migCtrl = new AbortController();
    const migTimer = window.setTimeout(() => migCtrl.abort(), 60_000);
    try {
      const mig = await migrateFilesBatch(migCtrl.signal);
      if (cancelled()) return;
      onUpdate(mig);
      more = mig.migratedRemaining === true;
    } finally {
      window.clearTimeout(migTimer);
    }
  }
}

export async function saveFileMeta(uid: string, file: StoredFile, attempts = 3): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await rtdbFetch(`/users/${uid}/files/${file.id}`, {
        method: 'PUT',
        body: JSON.stringify(file),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`save-failed:${res.status}`);
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => window.setTimeout(r, 400 * (i + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('save-failed');
}

export async function saveFolderMeta(uid: string, folder: FileFolder): Promise<void> {
  const res = await rtdbFetch(`/users/${uid}/fileFolders/${folder.id}`, {
    method: 'PUT',
    body: JSON.stringify(folder),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('save-failed');
}

export async function deleteFileMeta(uid: string, fileId: string): Promise<void> {
  await rtdbFetch(`/users/${uid}/files/${fileId}`, { method: 'DELETE' });
}

export async function deleteFolderMeta(uid: string, folderId: string): Promise<void> {
  await rtdbFetch(`/users/${uid}/fileFolders/${folderId}`, { method: 'DELETE' });
}

/** Delete Storage object (try both buckets) then RTDB meta. */
export async function deleteFileFully(uid: string, file: StoredFile): Promise<void> {
  if (file.storagePath) {
    for (const bucket of storageBuckets) {
      try {
        await deleteObject(ref(bucket, file.storagePath));
        break;
      } catch {
        /* object may already be gone or in the other bucket */
      }
    }
  }
  await deleteFileMeta(uid, file.id);
}

export async function fetchUserProfile(uid: string): Promise<Record<string, unknown>> {
  try {
    const profileRes = await withTimeout(
      rtdbFetch(`/users/${uid}/profile`),
      PROFILE_TIMEOUT_MS,
      'profile-timeout',
    );
    if (!profileRes.ok) return {};
    const raw = await withTimeout(profileRes.json(), 5_000, 'profile-json-timeout');
    if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  } catch {
    /* default free/plus limits from email */
  }
  return {};
}
