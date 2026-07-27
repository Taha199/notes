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

/** Drop undefined keys so spreads cannot wipe existing MCQ options / explanation. */
export function compactQuizPatch<T extends Record<string, unknown>>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(patch) as (keyof T)[]).forEach((key) => {
    if (patch[key] !== undefined) out[key] = patch[key];
  });
  return out;
}

export function quizzesEqualForUI(a: QuizItem[], b: QuizItem[]): boolean {
  if (a.length !== b.length) return false;
  // Compare by position so order-only sync updates re-render the list.
  return a.every((item, index) => {
    const other = b[index];
    return other != null && other.id === item.id && quizItemContentEquals(item, other);
  });
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
  const bById = new Map(b.map((set) => [set.id, set]));
  return a.every((set) => {
    const other = bById.get(set.id);
    return other != null && quizSetEqualForUI(set, other);
  });
}
