import { describe, expect, it } from 'vitest';
import { quizSetsEqualForUI } from './quizContent';
import type { QuizSet } from '../types';

function set(id: string, name: string): QuizSet {
  return { id, name, items: [], createdAt: '2026-01-01T00:00:00.000Z' };
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
