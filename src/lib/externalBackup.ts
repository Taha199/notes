import type { ChatConversation, Note, QuizFolder, QuizItem, QuizSet } from '../types';

export interface FullBackupPayload {
  version: 1;
  exportedAt: string;
  notes: Note[];
  quizzes: QuizItem[];
  quizSets: QuizSet[];
  quizFolders: QuizFolder[];
  chats: ChatConversation[];
}

const AUTO_FOLDER_BACKUP_KEY = 'malacadhati_auto_folder_backup';
const LAST_FOLDER_BACKUP_KEY = 'malacadhati_last_folder_backup';
const FOLDER_BACKUP_INTERVAL_MS = 3_600_000;
const IDB_NAME = 'tahanote-backup';
const IDB_STORE = 'handles';
const DIR_HANDLE_KEY = 'backupDir';

type BackupDirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function buildFullBackupPayload(data: Omit<FullBackupPayload, 'version' | 'exportedAt'>): FullBackupPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: data.notes,
    quizzes: data.quizzes,
    quizSets: data.quizSets,
    quizFolders: data.quizFolders,
    chats: data.chats,
  };
}

export function backupFilename(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `tahanote-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}.json`;
}

export function downloadBackupJson(payload: FullBackupPayload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  a.click();
  URL.revokeObjectURL(url);
}

function openBackupDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown) {
  const db = await openBackupDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isAutoFolderBackupEnabled() {
  try {
    return localStorage.getItem(AUTO_FOLDER_BACKUP_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoFolderBackupEnabled(enabled: boolean) {
  try {
    localStorage.setItem(AUTO_FOLDER_BACKUP_KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
}

export function getLastFolderBackupAt() {
  try {
    return Number(localStorage.getItem(LAST_FOLDER_BACKUP_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markFolderBackupDone(at = Date.now()) {
  try {
    localStorage.setItem(LAST_FOLDER_BACKUP_KEY, String(at));
  } catch { /* ignore */ }
}

export function shouldRunHourlyFolderBackup(now = Date.now()) {
  if (!isAutoFolderBackupEnabled()) return false;
  return now - getLastFolderBackupAt() >= FOLDER_BACKUP_INTERVAL_MS;
}

export async function pickBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(DIR_HANDLE_KEY, handle);
    return handle;
  } catch {
    return null;
  }
}

export async function getSavedBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<BackupDirHandle>(DIR_HANDLE_KEY);
  if (!handle) return null;
  try {
    if (handle.queryPermission && handle.requestPermission) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return handle;
      const req = await handle.requestPermission({ mode: 'readwrite' });
      return req === 'granted' ? handle : null;
    }
    return handle;
  } catch {
    return null;
  }
}

export async function writeBackupToFolder(payload: FullBackupPayload): Promise<boolean> {
  const dir = await getSavedBackupFolder();
  if (!dir) return false;
  try {
    const file = await dir.getFileHandle(backupFilename(), { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    markFolderBackupDone();
    return true;
  } catch {
    return false;
  }
}

export function supportsFolderBackup() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}
