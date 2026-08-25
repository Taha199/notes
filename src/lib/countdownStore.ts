import type { CountdownFormat, CountdownItem, CountdownRepeat } from '../types';
import { safeLocalStorageSet } from './safeStorage';

export const COUNTDOWNS_LS_KEY = 'malacadhati_countdowns';

export const DEFAULT_COUNTDOWN_FORMAT: CountdownFormat = {
  years: false,
  months: false,
  weeks: false,
  days: true,
  hours: true,
  minutes: true,
  seconds: false,
};

const UNIT_MS = {
  year: 365.2425 * 86_400_000,
  month: 30.436875 * 86_400_000,
  week: 7 * 86_400_000,
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
} as const;

export type CountdownUnitKey = keyof typeof UNIT_MS;

export interface CountdownParts {
  years: number;
  months: number;
  weeks: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

export function readCountdownsLocal(): CountdownItem[] {
  try {
    const raw = localStorage.getItem(COUNTDOWNS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCountdown).filter((row): row is CountdownItem => !!row);
  } catch {
    return [];
  }
}

export function writeCountdownsLocal(items: CountdownItem[]) {
  safeLocalStorageSet(COUNTDOWNS_LS_KEY, JSON.stringify(items));
}

export function normalizeCountdown(raw: unknown): CountdownItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<CountdownItem>;
  if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.targetAt !== 'string') return null;
  const format = row.format && typeof row.format === 'object' ? row.format as Partial<CountdownFormat> : {};
  return {
    id: row.id,
    title: row.title.trim() || 'Countdown',
    targetAt: row.targetAt,
    repeat: row.repeat === 'daily' || row.repeat === 'weekly' || row.repeat === 'monthly' || row.repeat === 'yearly'
      ? row.repeat
      : 'none',
    format: {
      years: format.years === true,
      months: format.months === true,
      weeks: format.weeks === true,
      days: format.days !== false,
      hours: format.hours !== false,
      minutes: format.minutes !== false,
      seconds: format.seconds === true,
    },
    textShadow: row.textShadow !== false,
    background: row.background === 'ocean' || row.background === 'night' || row.background === 'minimal'
      ? row.background
      : 'sunset',
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date().toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  };
}

export function effectiveTargetDate(targetAt: string, repeat: CountdownRepeat, now = new Date()): Date {
  const target = new Date(targetAt);
  if (Number.isNaN(target.getTime())) return now;
  if (repeat === 'none' || target.getTime() > now.getTime()) return target;
  const next = new Date(target);
  let guard = 0;
  while (next.getTime() <= now.getTime() && guard < 10_000) {
    guard += 1;
    switch (repeat) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        return target;
    }
  }
  return next;
}

export function computeCountdownParts(targetAt: string, repeat: CountdownRepeat, format: CountdownFormat, now = new Date()): CountdownParts {
  const target = effectiveTargetDate(targetAt, repeat, now);
  let remaining = Math.max(0, target.getTime() - now.getTime());
  const expired = remaining <= 0 && repeat === 'none';

  const parts: CountdownParts = {
    years: 0,
    months: 0,
    weeks: 0,
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired,
  };

  const cascade: Array<[CountdownUnitKey, keyof CountdownFormat]> = [
    ['year', 'years'],
    ['month', 'months'],
    ['week', 'weeks'],
    ['day', 'days'],
    ['hour', 'hours'],
    ['minute', 'minutes'],
    ['second', 'seconds'],
  ];

  for (const [unit, key] of cascade) {
    if (!format[key]) continue;
    const unitMs = UNIT_MS[unit];
    const value = Math.floor(remaining / unitMs);
    parts[key === 'years' ? 'years' : key === 'months' ? 'months' : key === 'weeks' ? 'weeks' : key === 'days' ? 'days' : key === 'hours' ? 'hours' : key === 'minutes' ? 'minutes' : 'seconds'] = value;
    remaining -= value * unitMs;
  }

  return parts;
}

export type CountdownUnit = Exclude<keyof CountdownParts, 'expired'>;

export function enabledFormatUnits(format: CountdownFormat): CountdownUnit[] {
  const units: CountdownUnit[] = [];
  if (format.years) units.push('years');
  if (format.months) units.push('months');
  if (format.weeks) units.push('weeks');
  if (format.days) units.push('days');
  if (format.hours) units.push('hours');
  if (format.minutes) units.push('minutes');
  if (format.seconds) units.push('seconds');
  if (!units.length) units.push('days', 'hours', 'minutes');
  return units;
}

export function padCountdownUnit(value: number, unit: CountdownUnit): string {
  if (unit === 'years') return String(value);
  if (unit === 'days' && value >= 100) return String(value);
  return String(value).padStart(2, '0');
}

export function toDateTimeLocalValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}
