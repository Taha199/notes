import { afterEach, describe, expect, it } from 'vitest';
import {
  compareTodosOnDay,
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

  it('keeps an optional time and drops invalid values', () => {
    expect(normalizeTodo({
      id: 'a', title: 'call', done: false, date: '2026-08-12', time: '14:30', createdAt: 1, updatedAt: 1,
    })?.time).toBe('14:30');
    expect(normalizeTodo({
      id: 'a', title: 'call', done: false, date: '2026-08-12', time: '25:99', createdAt: 1, updatedAt: 1,
    })?.time).toBeUndefined();
  });

  it('sorts timed tasks before untimed ones on the same day', () => {
    const late = normalizeTodo({
      id: 'late', title: 'late', done: false, date: '2026-08-12', time: '16:00', createdAt: 1, updatedAt: 1,
    })!;
    const early = normalizeTodo({
      id: 'early', title: 'early', done: false, date: '2026-08-12', time: '09:00', createdAt: 2, updatedAt: 2,
    })!;
    const none = normalizeTodo({
      id: 'none', title: 'none', done: false, date: '2026-08-12', createdAt: 3, updatedAt: 3,
    })!;
    expect([late, none, early].sort(compareTodosOnDay).map((row) => row.id)).toEqual(['early', 'late', 'none']);
  });
});
