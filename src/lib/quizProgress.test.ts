import { describe, expect, it } from 'vitest';
import type { QuizSet } from '../types';
import { buildQuizDashboardRows, dashboardStatusForSet } from './quizProgress';

function set(partial: Partial<QuizSet> & Pick<QuizSet, 'id' | 'name'>): QuizSet {
  return {
    items: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('quizProgress dashboard', () => {
  it('defaults missing status to notStarted', () => {
    expect(dashboardStatusForSet(set({ id: 's1', name: 'New' }))).toBe('notStarted');
    expect(dashboardStatusForSet(set({ id: 's2', name: 'Go', dashboardStatus: 'started' }))).toBe('started');
    expect(dashboardStatusForSet(set({ id: 's3', name: 'Done', dashboardStatus: 'done' }))).toBe('done');
  });

  it('groups by manual dashboardStatus, not study marks', () => {
    const rows = buildQuizDashboardRows(
      [
        set({ id: 'fav', name: 'Favoriter', system: 'favorites' }),
        set({ id: 'trash', name: 'Old', trashed: true }),
        set({
          id: 'a',
          name: 'Alpha',
          folderId: 'f1',
          items: [{ id: 1, noteId: 0, noteTitle: '', question: 'Q', answer: 'A', date: '' }],
        }),
        set({ id: 'b', name: 'Beta', dashboardStatus: 'started' }),
        set({ id: 'c', name: 'Gamma', dashboardStatus: 'done' }),
      ],
      [{ id: 'f1', name: 'Pediatrics', createdAt: '2026-01-01T00:00:00.000Z' }],
    );
    expect(rows.notStarted.map((r) => r.id)).toEqual(['a']);
    expect(rows.notStarted[0]?.folderName).toBe('Pediatrics');
    expect(rows.started.map((r) => r.id)).toEqual(['b']);
    expect(rows.done.map((r) => r.id)).toEqual(['c']);
  });
});
