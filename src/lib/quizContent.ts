import type { QuizItem, QuizSet } from '../types';

const QUIZ_CONTENT_KEYS = [
  'question',
  'answer',
  'options',
  'correctIndex',
  'correctIndexes',
  'explanation',
  'draft',
  'trashed',
] as const;

type QuizContentKey = (typeof QUIZ_CONTENT_KEYS)[number];

function fieldEqual(key: QuizContentKey, a: QuizItem[QuizContentKey], b: QuizItem[QuizContentKey]): boolean {
  if (key === 'options' || key === 'correctIndexes') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return a === b;
}

export function quizItemContentEquals(a: QuizItem, b: QuizItem): boolean {
  return QUIZ_CONTENT_KEYS.every((key) => fieldEqual(key, a[key], b[key]));
}

export function quizPatchChangesContent(
  existing: QuizItem,
  patch: Partial<Pick<QuizItem, QuizContentKey>>,
): boolean {
  return QUIZ_CONTENT_KEYS.some((key) => {
    if (patch[key] === undefined) return false;
    return !fieldEqual(key, patch[key] as QuizItem[QuizContentKey], existing[key]);
  });
}

export function quizzesEqualForUI(a: QuizItem[], b: QuizItem[]): boolean {
  if (a.length !== b.length) return false;
  // Manual in-set order is UI state — comparing by id map alone let cloud
  // echoes rewrite localStorage while React kept a stale sequence (same bug
  // as set-list order before quizSetsEqualForUI checked positions).
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
    if (!quizItemContentEquals(a[i], b[i])) return false;
  }
  return true;
}

export function quizSetEqualForUI(a: QuizSet, b: QuizSet): boolean {
  return (
    a.id === b.id
    && a.name === b.name
    && a.folderId === b.folderId
    && !!a.trashed === !!b.trashed
    && a.color === b.color
    && quizzesEqualForUI(a.items ?? [], b.items ?? [])
  );
}

export function quizSetsEqualForUI(a: QuizSet[], b: QuizSet[]): boolean {
  if (a.length !== b.length) return false;
  // Manual set-list order is UI state — comparing by id map alone let cloud
  // echoes rewrite refs/localStorage while React kept a stale sequence.
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id) return false;
  }
  return a.every((set, i) => quizSetEqualForUI(set, b[i]));
}
