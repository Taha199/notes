import type { QuizFolder, QuizSet } from '../types';
import { visibleQuizItems } from './quizSort';
import { safeLocalStorageSet } from './safeStorage';

export const QUIZ_PROGRESS_KEY = 'malacadhati_quiz_progress';
export const QUIZ_SELECTION_KEY = 'malacadhati_quiz_selection';

export type QuizStudyStatus = 'notStarted' | 'started' | 'done';

export type QuizProgressMap = Record<string, Record<number, 'known' | 'learning'>>;

export function loadQuizProgress(): QuizProgressMap {
  try {
    return JSON.parse(localStorage.getItem(QUIZ_PROGRESS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveQuizSelection(folderId: string | null, setId: string | null) {
  safeLocalStorageSet(QUIZ_SELECTION_KEY, JSON.stringify({ folderId, setId }));
}

export function progressCountsForSet(
  set: QuizSet,
  allProgress: QuizProgressMap,
): { known: number; learning: number; total: number; touched: number } {
  const items = visibleQuizItems(set.items);
  const prog = allProgress[set.id] ?? {};
  let known = 0;
  let learning = 0;
  for (const item of items) {
    const status = prog[item.id];
    if (status === 'known') known += 1;
    else if (status === 'learning') learning += 1;
  }
  return { known, learning, total: items.length, touched: known + learning };
}

/** Classify a set from study progress (local flashcard / checkbox marks). */
export function studyStatusForSet(
  set: QuizSet,
  allProgress: QuizProgressMap,
): QuizStudyStatus | null {
  const { known, total, touched } = progressCountsForSet(set, allProgress);
  if (total === 0) return null;
  if (known === total) return 'done';
  if (touched > 0) return 'started';
  return 'notStarted';
}

export type QuizDashboardRow = {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  total: number;
  known: number;
  status: QuizStudyStatus;
};

export function buildQuizDashboardRows(
  quizSets: QuizSet[],
  quizFolders: QuizFolder[],
  allProgress: QuizProgressMap = loadQuizProgress(),
): { notStarted: QuizDashboardRow[]; started: QuizDashboardRow[]; done: QuizDashboardRow[] } {
  const folderName = new Map(
    quizFolders.filter((f) => !f.trashed).map((f) => [f.id, f.name] as const),
  );
  const notStarted: QuizDashboardRow[] = [];
  const started: QuizDashboardRow[] = [];
  const done: QuizDashboardRow[] = [];

  for (const set of quizSets) {
    if (set.trashed || set.system === 'favorites') continue;
    const status = studyStatusForSet(set, allProgress);
    if (!status) continue;
    const { known, total } = progressCountsForSet(set, allProgress);
    const row: QuizDashboardRow = {
      id: set.id,
      name: set.name,
      folderId: set.folderId ?? null,
      folderName: set.folderId ? (folderName.get(set.folderId) ?? null) : null,
      total,
      known,
      status,
    };
    if (status === 'notStarted') notStarted.push(row);
    else if (status === 'started') started.push(row);
    else done.push(row);
  }

  const byName = (a: QuizDashboardRow, b: QuizDashboardRow) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  notStarted.sort(byName);
  started.sort(byName);
  done.sort(byName);
  return { notStarted, started, done };
}
