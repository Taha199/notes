import type { TodoItem, TodoRecurrenceMeta } from '../types';

export const TODOS_LS_KEY = 'malacadhati_todos';
export const TODOS_DELETED_LS_KEY = 'malacadhati_todos_deleted';
export const TODOS_UID_KEY = 'malacadhati_todos_uid';

/** Legacy ids were `todo-rec-{ts}-{rand}-{index}` without a seriesId field. */
const LEGACY_SERIES_ID_RE = /^todo-(rec-\d+-[a-z0-9]+)-\d+$/i;

export function getTodoSeriesId(todo: Pick<TodoItem, 'id' | 'seriesId'>): string | undefined {
  const explicit = String(todo.seriesId || '').trim();
  if (explicit) return explicit;
  const m = String(todo.id || '').match(LEGACY_SERIES_ID_RE);
  return m?.[1];
}

export function todosInSeries(todos: TodoItem[], seriesId: string): TodoItem[] {
  const id = seriesId.trim();
  if (!id) return [];
  return todos.filter((todo) => getTodoSeriesId(todo) === id);
}

function normalizeRecurrence(raw: unknown): TodoRecurrenceMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Partial<TodoRecurrenceMeta>;
  const mode = obj.mode;
  if (mode !== 'daily' && mode !== 'weekly' && mode !== 'monthly') return undefined;
  const startDate = String(obj.startDate || '').trim();
  const endDate = String(obj.endDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return undefined;
  const weekdays = Array.isArray(obj.weekdays)
    ? obj.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    : undefined;
  const monthDay = Number(obj.monthDay);
  return {
    mode,
    startDate,
    endDate,
    ...(weekdays?.length ? { weekdays } : {}),
    ...(Number.isFinite(monthDay) && monthDay >= 1 && monthDay <= 31 ? { monthDay: Math.round(monthDay) } : {}),
  };
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function isSameDateKey(a: string, b: string): boolean {
  return a === b;
}

/** Monday-first month grid (6 weeks × 7 days). */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const weekday = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - weekday);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** ISO-8601 week number (week starts Monday; week 1 contains Jan 4). */
export function isoWeekNumber(date: Date): number {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // Thursday of this week
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86_400_000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/** Six week rows for a month grid, each with ISO week number. */
export function monthWeekRows(year: number, month: number): { week: number; days: Date[] }[] {
  const cells = monthGrid(year, month);
  const rows: { week: number; days: Date[] }[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const days = cells.slice(i, i + 7);
    rows.push({ week: isoWeekNumber(days[0]!), days });
  }
  return rows;
}

export function normalizeTodoTime(raw: unknown): string | undefined {
  const value = String(raw || '').trim();
  if (!/^\d{2}:\d{2}$/.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) return undefined;
  return value;
}

export function compareTodosOnDay(a: TodoItem, b: TodoItem): number {
  if (a.time && b.time) return a.time.localeCompare(b.time) || a.createdAt - b.createdAt;
  if (a.time) return -1;
  if (b.time) return 1;
  return a.createdAt - b.createdAt;
}

export function normalizeTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<TodoItem>;
  const id = String(obj.id || '').trim();
  const title = String(obj.title || '').trim();
  const date = String(obj.date || '').trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const createdAt = Number(obj.createdAt) || Date.now();
  const updatedAt = Number(obj.updatedAt) || createdAt;
  const time = normalizeTodoTime(obj.time);
  const seriesId = getTodoSeriesId({ id, seriesId: obj.seriesId });
  const recurrence = normalizeRecurrence(obj.recurrence);
  return {
    id,
    title,
    done: !!obj.done,
    date,
    ...(time ? { time } : {}),
    ...(seriesId ? { seriesId } : {}),
    ...(recurrence ? { recurrence } : {}),
    createdAt,
    updatedAt,
  };
}

export function readTodosLocal(): TodoItem[] {
  try {
    const raw = localStorage.getItem(TODOS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTodo).filter((row): row is TodoItem => !!row);
  } catch {
    return [];
  }
}

export function writeTodosLocal(todos: TodoItem[]): void {
  try {
    localStorage.setItem(TODOS_LS_KEY, JSON.stringify(todos));
  } catch {
    /* quota */
  }
}

export function readDeletedTodoIds(): string[] {
  try {
    const raw = localStorage.getItem(TODOS_DELETED_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeDeletedTodoIds(ids: string[]): void {
  try {
    localStorage.setItem(TODOS_DELETED_LS_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* quota */
  }
}

export function mergeTodos(local: TodoItem[], remote: TodoItem[], deletedIds: Iterable<string> = []): TodoItem[] {
  const dead = new Set(deletedIds);
  const map = new Map<string, TodoItem>();
  for (const row of [...local, ...remote]) {
    if (!row?.id || dead.has(row.id)) continue;
    const prev = map.get(row.id);
    if (!prev || row.updatedAt >= prev.updatedAt) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || compareTodosOnDay(a, b));
}

export function todosForDate(todos: TodoItem[], dateKey: string): TodoItem[] {
  return todos.filter((todo) => todo.date === dateKey).sort(compareTodosOnDay);
}

export function incompleteTodoCount(todos: TodoItem[]): number {
  return todos.filter((todo) => !todo.done).length;
}

export type TodoRecurrenceMode = 'daily' | 'weekly' | 'monthly';

/**
 * Inclusive date keys from start→end.
 * - daily: every day
 * - weekly: any of the given JS weekdays (0=Sun … 6=Sat)
 * - monthly: same calendar day-of-month (skips months that lack that day)
 */
export function expandRecurringTodoDates(
  startKey: string,
  endKey: string,
  mode: TodoRecurrenceMode,
  opts?: { weekdays?: number[]; monthDay?: number },
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) return [];
  if (endKey < startKey) return [];
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const out: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const weekdaySet = new Set(
    (opts?.weekdays ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
  );
  const monthDay = Math.round(Number(opts?.monthDay));
  const MAX = 400;
  while (cursor.getTime() <= last.getTime() && out.length < MAX) {
    const key = toDateKey(cursor);
    if (mode === 'daily') {
      out.push(key);
    } else if (mode === 'weekly' && weekdaySet.has(cursor.getDay())) {
      out.push(key);
    } else if (
      mode === 'monthly'
      && Number.isFinite(monthDay)
      && monthDay >= 1
      && monthDay <= 31
      && cursor.getDate() === monthDay
    ) {
      out.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
