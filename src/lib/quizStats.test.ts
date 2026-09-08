import { describe, expect, it } from 'vitest';
import type { QuizItem, QuizSet } from '../types';
import {
  buildMonthDayBars,
  buildYearMonthBars,
  collectQuizItemsForStats,
  countQuestionsByDay,
  toDayKey,
} from './quizStats';

function item(partial: Partial<QuizItem> & Pick<QuizItem, 'id'>): QuizItem {
  return {
    noteId: 0,
    noteTitle: '',
    question: 'Q',
    answer: 'A',
    date: '01/01/2026',
    ...partial,
  };
}

describe('quizStats', () => {
  it('maps timestamps to local day keys', () => {
    const ms = new Date(2026, 8, 8, 15, 30).getTime(); // Sep 8 2026 local
    expect(toDayKey(ms)).toBe('2026-09-08');
  });

  it('dedupes items and skips trash/drafts/favorites', () => {
    const shared = item({ id: 1, createdAt: '2026-09-01T10:00:00.000Z' });
    const quizzes = [
      shared,
      item({ id: 2, draft: true, createdAt: '2026-09-02T10:00:00.000Z' }),
      item({ id: 3, trashed: true, createdAt: '2026-09-03T10:00:00.000Z' }),
    ];
    const sets: QuizSet[] = [
      {
        id: 's1',
        name: 'Set',
        items: [shared, item({ id: 4, createdAt: '2026-09-04T10:00:00.000Z' })],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'fav',
        name: 'Favoriter',
        system: 'favorites',
        items: [item({ id: 99, favOf: 1, createdAt: '2026-09-05T10:00:00.000Z' })],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const collected = collectQuizItemsForStats(quizzes, sets);
    expect(collected.map((i) => i.id).sort((a, b) => a - b)).toEqual([1, 4]);
  });

  it('counts questions per day and fills month bars', () => {
    const items = [
      item({ id: 10, createdAt: '2026-09-01T08:00:00.000Z' }),
      item({ id: 11, createdAt: '2026-09-01T20:00:00.000Z' }),
      item({ id: 12, createdAt: '2026-09-03T12:00:00.000Z' }),
    ];
    // Normalize via local day keys from createdAt ms
    const byDay = countQuestionsByDay(items);
    const d1 = toDayKey(new Date('2026-09-01T08:00:00.000Z').getTime());
    const d3 = toDayKey(new Date('2026-09-03T12:00:00.000Z').getTime());
    expect(byDay.get(d1)).toBe(2);
    expect(byDay.get(d3)).toBe(1);

    const year = Number(d1.slice(0, 4));
    const month = Number(d1.slice(5, 7));
    const bars = buildMonthDayBars(byDay, year, month);
    expect(bars.length).toBe(new Date(year, month, 0).getDate());
    expect(bars.find((b) => b.key === d1)?.count).toBe(2);
    expect(bars.find((b) => b.key === d3)?.count).toBe(1);
    expect(sumZeroDays(bars)).toBeGreaterThan(0);
  });

  it('builds twelve month bars for a year', () => {
    const byMonth = new Map([['2025-03', 4], ['2025-11', 1]]);
    const bars = buildYearMonthBars(byMonth, 2025);
    expect(bars).toHaveLength(12);
    expect(bars[2]?.count).toBe(4);
    expect(bars[10]?.count).toBe(1);
    expect(bars[0]?.count).toBe(0);
  });
});

function sumZeroDays(bars: { count: number }[]) {
  return bars.filter((b) => b.count === 0).length;
}
