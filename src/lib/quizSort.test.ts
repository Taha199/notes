import { describe, expect, it } from 'vitest';
import { countQuizSetQuestions, liveQuizItemsOrder } from './quizSort';
import type { QuizItem } from '../types';

const item = (id: number, patch: Partial<QuizItem> = {}): QuizItem => ({
  id,
  noteId: 0,
  noteTitle: '',
  question: `Q${id}`,
  answer: `A${id}`,
  ...patch,
} as QuizItem);

describe('countQuizSetQuestions', () => {
  it('counts live items when present', () => {
    expect(countQuizSetQuestions({
      items: [item(1), item(2)],
      itemsOrder: [1, 2, 3],
    })).toBe(2);
  });

  it('uses itemsOrder only for empty shells awaiting hydrate', () => {
    expect(countQuizSetQuestions({
      items: [],
      itemsOrder: [10, 20],
    })).toBe(2);
  });

  it('does not inflate count from stale itemsOrder after soft-delete', () => {
    expect(countQuizSetQuestions({
      items: [item(1, { trashed: true }), item(2, { trashed: true })],
      itemsOrder: [1, 2],
    })).toBe(0);
  });

  it('ignores drafts and trashed when counting live items', () => {
    expect(countQuizSetQuestions({
      items: [item(1), item(2, { trashed: true }), item(3, { draft: true })],
      itemsOrder: [1, 2, 3],
    })).toBe(1);
  });
});

describe('liveQuizItemsOrder', () => {
  it('keeps live Manual order while dropping trashed ids', () => {
    expect(liveQuizItemsOrder({
      items: [item(1), item(2, { trashed: true }), item(3)],
      itemsOrder: [3, 2, 1],
    })).toEqual([3, 1]);
  });
});
