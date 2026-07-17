import { ADMIN_EMAIL } from './firebase';

export const FREE_STORAGE_LIMIT_MB = 100;
export const PLUS_STORAGE_LIMIT_MB = 1000;
export const MIN_STORAGE_LIMIT_MB = 10;
export const MAX_STORAGE_LIMIT_MB = 10_000;
export const DEFAULT_STORAGE_LIMIT_MB = FREE_STORAGE_LIMIT_MB;

export function mbToBytes(mb: number) {
  return mb * 1024 * 1024;
}

export function isPlusUser(
  profile: Record<string, unknown> | null | undefined,
  email?: string | null,
): boolean {
  if (email === ADMIN_EMAIL) return true;
  return profile?.isPlus === true;
}

export function hasAiAccess(
  profile: Record<string, unknown> | null | undefined,
  email?: string | null,
): boolean {
  return isPlusUser(profile, email);
}

export function getStorageLimitMB(
  profile: Record<string, unknown> | null | undefined,
  email?: string | null,
): number {
  if (email === ADMIN_EMAIL) {
    const raw = profile?.storageLimitMB;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= MIN_STORAGE_LIMIT_MB) {
      return Math.min(raw, MAX_STORAGE_LIMIT_MB);
    }
    return MAX_STORAGE_LIMIT_MB;
  }
  return isPlusUser(profile, email) ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}

export function getStorageLimitBytes(
  profile: Record<string, unknown> | null | undefined,
  email?: string | null,
): number {
  return mbToBytes(getStorageLimitMB(profile, email));
}

export function jsonUtf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}

export interface StorageBreakdown {
  notesBytes: number;
  quizBytes: number;
  chatBytes: number;
  filesBytes: number;
  total: number;
}

export function calculateStorageBreakdownFromUserData(
  userData: Record<string, unknown> | null | undefined,
): StorageBreakdown {
  return calculateStorageBreakdown({
    notes: userData?.notes,
    quizzes: userData?.quizzes,
    quizSets: userData?.quizSets,
    quizFolders: userData?.quizFolders,
    chats: userData?.chats,
    filesUserData: userData ?? null,
  });
}

export function calculateStorageBreakdown(input: {
  notes: unknown;
  quizzes: unknown;
  quizSets: unknown;
  quizFolders: unknown;
  chats: unknown;
  filesUserData?: Record<string, unknown> | null;
}): StorageBreakdown {
  const notesBytes = jsonUtf8Bytes(input.notes);
  const quizBytes = jsonUtf8Bytes([
    ...(Array.isArray(input.quizzes) ? input.quizzes : []),
    ...(Array.isArray(input.quizSets) ? input.quizSets : []),
    ...(Array.isArray(input.quizFolders) ? input.quizFolders : []),
  ]);
  const chatBytes = jsonUtf8Bytes(input.chats);
  const filesBytes = calculateFilesStorageBytes(input.filesUserData);
  return {
    notesBytes,
    quizBytes,
    chatBytes,
    filesBytes,
    total: notesBytes + quizBytes + chatBytes + filesBytes,
  };
}

export function calculateUserStorageBytes(userData: Record<string, unknown> | null | undefined): number {
  return jsonUtf8Bytes(userData ?? {});
}

export function calculateFilesStorageBytes(userData: Record<string, unknown> | null | undefined): number {
  const files = userData?.files;
  if (!files || typeof files !== 'object') return 0;
  const list = Array.isArray(files) ? files : Object.values(files as Record<string, { size?: number }>);
  return list.reduce((sum, file) => {
    if (!file || typeof file !== 'object') return sum;
    const size = (file as { size?: number }).size;
    return sum + (typeof size === 'number' && size > 0 ? size : 0);
  }, 0);
}

export function storageLimitPresetsMB(): number[] {
  return [100, 200, 500, 1000, 2000, 5000];
}

export function plusStorageLimitForToggle(isPlus: boolean): number {
  return isPlus ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}
