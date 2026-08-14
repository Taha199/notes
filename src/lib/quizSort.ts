import type { QuizItem } from '../types';

/** Sort key from question creation — uses createdAt or item.id (Date.now() at create). */
export function quizItemCreatedAtMs(item: QuizItem): number {
  if (item.createdAt) return new Date(item.createdAt).getTime();
  return item.id;
}

export function sortQuizItemsByCreatedDesc(items: QuizItem[]): QuizItem[] {
  return [...items].sort((a, b) => quizItemCreatedAtMs(b) - quizItemCreatedAtMs(a));
}

/** Active questions shown in the set/list UI (excludes trashed and in-progress drafts). */
export function isVisibleQuizItem(item: QuizItem): boolean {
  return !item.trashed && !item.draft;
}

export function visibleQuizItems(items: QuizItem[] | undefined | null): QuizItem[] {
  return (items ?? []).filter(isVisibleQuizItem);
}

export function countVisibleQuizItems(items: QuizItem[] | undefined | null): number {
  return visibleQuizItems(items).length;
}

/** Sidebar count — prefer live items, else durable itemsOrder on empty shells. */
export function countQuizSetQuestions(set: { items?: QuizItem[] | null; itemsOrder?: number[] | null }): number {
  const live = countVisibleQuizItems(set.items);
  if (live > 0) return live;
  return (set.itemsOrder ?? []).length;
}
