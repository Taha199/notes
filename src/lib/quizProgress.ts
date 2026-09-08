import type { QuizFolder, QuizSet } from '../types';
import { visibleQuizItems } from './quizSort';
import { safeLocalStorageSet } from './safeStorage';

export const QUIZ_SELECTION_KEY = 'malacadhati_quiz_selection';

export type QuizStudyStatus = 'notStarted' | 'started' | 'done';

export function saveQuizSelection(folderId: string | null, setId: string | null) {
  safeLocalStorageSet(QUIZ_SELECTION_KEY, JSON.stringify({ folderId, setId }));
}

/** Manual dashboard column — new sets without a value count as not started. */
export function dashboardStatusForSet(set: QuizSet): QuizStudyStatus {
  if (set.dashboardStatus === 'started' || set.dashboardStatus === 'done') return set.dashboardStatus;
  return 'notStarted';
}

export type QuizDashboardRow = {
  id: string;
  name: string;
  folderId: string | null;
  folderName: string | null;
  total: number;
  createdAt: string;
  color: string | null;
  status: QuizStudyStatus;
};

export function buildQuizDashboardRows(
  quizSets: QuizSet[],
  quizFolders: QuizFolder[],
): { notStarted: QuizDashboardRow[]; started: QuizDashboardRow[]; done: QuizDashboardRow[] } {
  const folderName = new Map(
    quizFolders.filter((f) => !f.trashed).map((f) => [f.id, f.name] as const),
  );
  const notStarted: QuizDashboardRow[] = [];
  const started: QuizDashboardRow[] = [];
  const done: QuizDashboardRow[] = [];

  for (const set of quizSets) {
    if (set.trashed || set.system === 'favorites') continue;
    const status = dashboardStatusForSet(set);
    const row: QuizDashboardRow = {
      id: set.id,
      name: set.name,
      folderId: set.folderId ?? null,
      folderName: set.folderId ? (folderName.get(set.folderId) ?? null) : null,
      total: visibleQuizItems(set.items).length,
      createdAt: set.createdAt,
      color: set.color ?? null,
      status,
    };
    if (status === 'notStarted') notStarted.push(row);
    else if (status === 'started') started.push(row);
    else done.push(row);
  }

  return { notStarted, started, done };
}
