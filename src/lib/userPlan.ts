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

export function calculateUserStorageBytes(userData: Record<string, unknown> | null | undefined): number {
  return new TextEncoder().encode(JSON.stringify(userData ?? {})).length;
}

export function storageLimitPresetsMB(): number[] {
  return [100, 200, 500, 1000, 2000, 5000];
}

export function plusStorageLimitForToggle(isPlus: boolean): number {
  return isPlus ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}
