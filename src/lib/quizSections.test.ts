import { describe, expect, it } from 'vitest';
import type { QuizItem } from '../types';
import { buildQuizListRows } from './quizSections';

function item(id: number): QuizItem {
  return {
    id,
    noteId: 1,
    noteTitle: 'n',
    question: 'q',
    answer: 'a',
    date: '2026-01-01',
  };
}

describe('buildQuizListRows', () => {
  it('inserts section rows before the anchor question without changing numbering', () => {
    const rows = buildQuizListRows(
      [item(10), item(20), item(30)],
      [{ id: 's1', title: 'Medications', beforeItemId: 20 }],
    );
    expect(rows.map((row) => row.type)).toEqual(['item', 'section', 'item', 'item']);
    expect(rows.filter((row) => row.type === 'item').map((row) => row.questionNumber)).toEqual([1, 2, 3]);
  });
});
