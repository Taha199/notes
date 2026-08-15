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

export function visibleQuizItems(items: QuizItem[] | Record<string, QuizItem> | undefined | null): QuizItem[] {
  const list = Array.isArray(items)
    ? items
    : items && typeof items === 'object'
      ? Object.values(items)
      : [];
  return list.filter(Boolean).filter(isVisibleQuizItem);
}

export function countVisibleQuizItems(items: QuizItem[] | Record<string, QuizItem> | undefined | null): number {
  return visibleQuizItems(items).length;
}

function coerceQuizItemList(items: QuizItem[] | Record<string, QuizItem> | undefined | null): QuizItem[] {
  if (Array.isArray(items)) return items.filter(Boolean);
  if (items && typeof items === 'object') return Object.values(items).filter(Boolean);
  return [];
}

/**
 * Sidebar / loading count — prefer live items.
 * Fall back to durable itemsOrder only for true empty shells awaiting hydrate.
 * Never use stale itemsOrder when membership is known (e.g. all soft-deleted),
 * or the UI sticks on "Loading questions… 0/N".
 */
export function countQuizSetQuestions(set: { items?: QuizItem[] | Record<string, QuizItem> | null; itemsOrder?: number[] | null }): number {
  const list = coerceQuizItemList(set.items);
  const live = list.filter(isVisibleQuizItem).length;
  if (live > 0) return live;
  if (list.length > 0) return 0;
  return (set.itemsOrder ?? []).length;
}

/** Manual order of live questions only — drops soft-deleted ids from itemsOrder. */
export function liveQuizItemsOrder(set: {
  items?: QuizItem[] | Record<string, QuizItem> | null;
  itemsOrder?: number[] | null;
}): number[] {
  const list = coerceQuizItemList(set.items);
  if (!list.length) return (set.itemsOrder ?? []).slice();
  const liveIds = list.filter(isVisibleQuizItem).map((item) => Number(item.id)).filter(Number.isFinite);
  const liveSet = new Set(liveIds);
  const base = (set.itemsOrder?.length ? set.itemsOrder : liveIds)
    .map(Number)
    .filter((id) => liveSet.has(id));
  for (const id of liveIds) {
    if (!base.includes(id)) base.push(id);
  }
  return base;
}
