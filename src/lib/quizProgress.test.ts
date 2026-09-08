import { describe, expect, it } from 'vitest';
import type { QuizSet } from '../types';
import { buildQuizDashboardRows, studyStatusForSet, type QuizProgressMap } from './quizProgress';

function set(partial: Partial<QuizSet> & Pick<QuizSet, 'id' | 'name'>): QuizSet {
  return {
    items: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('quizProgress dashboard', () => {
  it('classifies not started / started / done from known+learning marks', () => {
    const quiz = set({
      id: 's1',
      name: 'Hygiene',
      items: [
        { id: 1, noteId: 0, noteTitle: '', question: 'Q1', answer: 'A', date: '' },
        { id: 2, noteId: 0, noteTitle: '', question: 'Q2', answer: 'A', date: '' },
      ],
    });
    expect(studyStatusForSet(quiz, {})).toBe('notStarted');
    expect(studyStatusForSet(quiz, { s1: { 1: 'learning' } })).toBe('started');
    expect(studyStatusForSet(quiz, { s1: { 1: 'known' } })).toBe('started');
    expect(studyStatusForSet(quiz, { s1: { 1: 'known', 2: 'known' } })).toBe('done');
  });

  it('skips favorites, trash, and empty sets', () => {
    const progress: QuizProgressMap = {};
    const rows = buildQuizDashboardRows(
      [
        set({ id: 'fav', name: 'Favoriter', system: 'favorites', items: [
          { id: 9, noteId: 0, noteTitle: '', question: 'Q', answer: 'A', date: '' },
        ] }),
        set({ id: 'trash', name: 'Old', trashed: true, items: [
          { id: 8, noteId: 0, noteTitle: '', question: 'Q', answer: 'A', date: '' },
        ] }),
        set({ id: 'empty', name: 'Empty', items: [] }),
        set({
          id: 'live',
          name: 'Live',
          folderId: 'f1',
          items: [{ id: 1, noteId: 0, noteTitle: '', question: 'Q', answer: 'A', date: '' }],
        }),
      ],
      [{ id: 'f1', name: 'Pediatrics', createdAt: '2026-01-01T00:00:00.000Z' }],
      progress,
    );
    expect(rows.notStarted.map((r) => r.id)).toEqual(['live']);
    expect(rows.notStarted[0]?.folderName).toBe('Pediatrics');
    expect(rows.started).toEqual([]);
    expect(rows.done).toEqual([]);
  });
});
