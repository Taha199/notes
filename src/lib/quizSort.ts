import type { QuizItem } from '../types';

/** Sort key from question creation — uses createdAt or item.id (Date.now() at create). */
export function quizItemCreatedAtMs(item: QuizItem): number {
  if (item.createdAt) return new Date(item.createdAt).getTime();
  return item.id;
}

export function sortQuizItemsByCreatedDesc(items: QuizItem[]): QuizItem[] {
  return [...items].sort((a, b) => quizItemCreatedAtMs(b) - quizItemCreatedAtMs(a));
}
