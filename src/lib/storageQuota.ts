export const DEFAULT_STORAGE_LIMIT_MB = 50;
export const MIN_STORAGE_LIMIT_MB = 10;
export const MAX_STORAGE_LIMIT_MB = 10_000;

export function mbToBytes(mb: number) {
  return mb * 1024 * 1024;
}

export function getStorageLimitMB(profile: Record<string, unknown> | null | undefined): number {
  const raw = profile?.storageLimitMB;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= MIN_STORAGE_LIMIT_MB) {
    return Math.min(raw, MAX_STORAGE_LIMIT_MB);
  }
  return DEFAULT_STORAGE_LIMIT_MB;
}

export function getStorageLimitBytes(profile: Record<string, unknown> | null | undefined): number {
  return mbToBytes(getStorageLimitMB(profile));
}

export function calculateUserStorageBytes(userData: Record<string, unknown> | null | undefined): number {
  return new TextEncoder().encode(JSON.stringify(userData ?? {})).length;
}

export function storageLimitPresetsMB(): number[] {
  return [50, 100, 200, 500, 1000, 2000];
}
