import { afterEach, describe, expect, it } from 'vitest';
import {
  mergeTodos,
  monthGrid,
  normalizeTodo,
  toDateKey,
  TODOS_LS_KEY,
} from './todosStore';

afterEach(() => {
  try {
    localStorage.removeItem(TODOS_LS_KEY);
  } catch {
    /* ignore */
  }
});

describe('todosStore calendar helpers', () => {
  it('formats local YYYY-MM-DD keys', () => {
    expect(toDateKey(new Date(2026, 7, 12))).toBe('2026-08-12');
  });

  it('builds a Monday-first 6-week grid', () => {
    const cells = monthGrid(2026, 7);
    expect(cells).toHaveLength(42);
    expect(cells[0].getDay()).toBe(1);
    expect(toDateKey(cells[16])).toBe('2026-08-12');
  });

  it('keeps the newer copy and drops deleted ids', () => {
    const local = [normalizeTodo({
      id: 'a', title: 'old', done: false, date: '2026-08-12', createdAt: 1, updatedAt: 1,
    })!];
    const remote = [normalizeTodo({
      id: 'a', title: 'new', done: true, date: '2026-08-12', createdAt: 1, updatedAt: 2,
    })!, normalizeTodo({
      id: 'b', title: 'gone', done: false, date: '2026-08-13', createdAt: 1, updatedAt: 1,
    })!];
    const merged = mergeTodos(local, remote, ['b']);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('new');
    expect(merged[0].done).toBe(true);
  });
});
