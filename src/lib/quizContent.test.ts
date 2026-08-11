import { describe, expect, it } from 'vitest';
import { quizSetsEqualForUI, quizzesEqualForUI } from './quizContent';
import type { QuizItem, QuizSet } from '../types';

function set(id: string, name: string, items: QuizItem[] = []): QuizSet {
  return { id, name, items, createdAt: '2026-01-01T00:00:00.000Z' };
}

function item(id: number, question: string): QuizItem {
  return {
    id,
    noteId: 0,
    noteTitle: '',
    question,
    answer: `a${id}`,
    date: '2026-01-01T00:00:00.000Z',
  };
}

describe('quizSetsEqualForUI', () => {
  it('treats different Manual list order as a UI change', () => {
    const a = [set('1', 'ABL'), set('2', 'Tub'), set('3', 'Neuro')];
    const b = [set('3', 'Neuro'), set('1', 'ABL'), set('2', 'Tub')];
    expect(quizSetsEqualForUI(a, b)).toBe(false);
  });

  it('still treats identical order + content as equal', () => {
    const a = [set('1', 'ABL'), set('2', 'Tub')];
    const b = [set('1', 'ABL'), set('2', 'Tub')];
    expect(quizSetsEqualForUI(a, b)).toBe(true);
  });
});

describe('quizzesEqualForUI', () => {
  it('treats different Manual in-set item order as a UI change', () => {
    const a = [item(1, 'A'), item(2, 'B'), item(3, 'C')];
    const b = [item(3, 'C'), item(1, 'A'), item(2, 'B')];
    expect(quizzesEqualForUI(a, b)).toBe(false);
  });

  it('still treats identical order + content as equal', () => {
    const a = [item(1, 'A'), item(2, 'B')];
    const b = [item(1, 'A'), item(2, 'B')];
    expect(quizzesEqualForUI(a, b)).toBe(true);
  });
});
