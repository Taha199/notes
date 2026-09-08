import type { QuizItem, QuizSet } from '../types';
import { coerceQuizItems } from './quizSetMerge';
import { quizItemCreatedAtMs } from './quizSort';

/** Local calendar day key YYYY-MM-DD. */
export function toDayKey(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(ms) || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local calendar month key YYYY-MM. */
export function toMonthKey(ms: number): string {
  const day = toDayKey(ms);
  return day ? day.slice(0, 7) : '';
}

export function parseYearMonth(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** Deduped live quiz questions (skips trash, drafts, favorites copies). */
export function collectQuizItemsForStats(
  quizzes: QuizItem[],
  quizSets: QuizSet[],
): QuizItem[] {
  const byId = new Map<number, QuizItem>();
  for (const set of quizSets) {
    if (set.trashed || set.system === 'favorites') continue;
    for (const item of coerceQuizItems(set.items)) {
      if (!item || item.trashed || item.draft || item.favOf != null) continue;
      byId.set(item.id, item);
    }
  }
  for (const q of quizzes) {
    if (!q || q.trashed || q.draft || q.favOf != null) continue;
    if (!byId.has(q.id)) byId.set(q.id, q);
  }
  return [...byId.values()];
}

export function countQuestionsByDay(items: QuizItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = toDayKey(quizItemCreatedAtMs(item));
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function countQuestionsByMonth(items: QuizItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) {
    const key = toMonthKey(quizItemCreatedAtMs(item));
    if (!key) continue;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export type DayBar = { day: number; key: string; count: number };

/** One bar per calendar day in the month (zeros included). */
export function buildMonthDayBars(
  byDay: Map<string, number>,
  year: number,
  month: number,
): DayBar[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const bars: DayBar[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    bars.push({ day, key, count: byDay.get(key) ?? 0 });
  }
  return bars;
}

export type HourBar = { hour: number; key: string; count: number };

/** Counts for a single local calendar day, keyed by hour 0–23. */
export function countQuestionsByHourForDay(
  items: QuizItem[],
  dayKey: string,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const item of items) {
    const ms = quizItemCreatedAtMs(item);
    if (toDayKey(ms) !== dayKey) continue;
    const hour = new Date(ms).getHours();
    map.set(hour, (map.get(hour) ?? 0) + 1);
  }
  return map;
}

/** One vertical bar per hour of the day (zeros included). */
export function buildTodayHourBars(
  items: QuizItem[],
  dayKey: string,
): HourBar[] {
  const byHour = countQuestionsByHourForDay(items, dayKey);
  const bars: HourBar[] = [];
  for (let hour = 0; hour < 24; hour++) {
    bars.push({
      hour,
      key: `${dayKey}T${String(hour).padStart(2, '0')}`,
      count: byHour.get(hour) ?? 0,
    });
  }
  return bars;
}

export type MonthBar = { month: number; key: string; count: number };

/** Jan–Dec for a year. */
export function buildYearMonthBars(
  byMonth: Map<string, number>,
  year: number,
): MonthBar[] {
  const bars: MonthBar[] = [];
  for (let month = 1; month <= 12; month++) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    bars.push({ month, key, count: byMonth.get(key) ?? 0 });
  }
  return bars;
}

export function sumCounts(values: Iterable<number>): number {
  let total = 0;
  for (const n of values) total += n;
  return total;
}

export function maxCount(values: Iterable<number>): number {
  let max = 0;
  for (const n of values) if (n > max) max = n;
  return max;
}

/** Distinct years that have at least one question, newest first. */
export function yearsWithData(byDay: Map<string, number>): number[] {
  const years = new Set<number>();
  for (const key of byDay.keys()) {
    const y = Number(key.slice(0, 4));
    if (Number.isFinite(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a);
}

/** Distinct YYYY-MM keys with data, newest first. */
export function monthsWithData(byDay: Map<string, number>): string[] {
  const months = new Set<string>();
  for (const key of byDay.keys()) {
    if (key.length >= 7) months.add(key.slice(0, 7));
  }
  return [...months].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export function currentYearMonth(now = new Date()): { year: number; month: number; key: string } {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
  };
}

/** Rolling last N calendar months including the current month, oldest first. */
export function lastNMonthKeys(n: number, now = new Date()): string[] {
  const keys: string[] = [];
  const count = Math.max(0, Math.floor(n));
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    keys.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return keys;
}

export function sumMonthKeys(byMonth: Map<string, number>, keys: Iterable<string>): number {
  let total = 0;
  for (const key of keys) total += byMonth.get(key) ?? 0;
  return total;
}
