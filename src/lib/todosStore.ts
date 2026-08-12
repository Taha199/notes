import type { TodoItem } from '../types';

export const TODOS_LS_KEY = 'malacadhati_todos';
export const TODOS_DELETED_LS_KEY = 'malacadhati_todos_deleted';
export const TODOS_UID_KEY = 'malacadhati_todos_uid';

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

export function normalizeTodo(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<TodoItem>;
  const id = String(obj.id || '').trim();
  const title = String(obj.title || '').trim();
  const date = String(obj.date || '').trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const createdAt = Number(obj.createdAt) || Date.now();
  const updatedAt = Number(obj.updatedAt) || createdAt;
  return { id, title, done: !!obj.done, date, createdAt, updatedAt };
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
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

export function todosForDate(todos: TodoItem[], dateKey: string): TodoItem[] {
  return todos.filter((todo) => todo.date === dateKey);
}

export function incompleteTodoCount(todos: TodoItem[]): number {
  return todos.filter((todo) => !todo.done).length;
}
