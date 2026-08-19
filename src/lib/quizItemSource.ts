import type { QuizFolder, QuizItem, QuizSet } from '../types';
import { coerceQuizItems } from './quizSetMerge';

const FAVORITES_SET_ID = 'system-favorites-set';

export type QuizItemSource = {
  setId: string | null;
  setName: string | null;
  folderId: string | null;
  folderName: string | null;
  fromNotes: boolean;
};

/** Where a quiz question lives (set/folder or notes), excluding favorites copies. */
export function findQuizItemSource(
  itemId: number,
  quizSets: QuizSet[],
  quizFolders: QuizFolder[],
  quizzes: QuizItem[],
): QuizItemSource | null {
  const orphan = quizzes.find((q) => q.id === itemId && !q.trashed);
  if (orphan) {
    return {
      setId: null,
      setName: orphan.noteTitle?.trim() || null,
      folderId: null,
      folderName: null,
      fromNotes: true,
    };
  }

  for (const set of quizSets) {
    if (set.trashed || set.id === FAVORITES_SET_ID || set.system === 'favorites') continue;
    const hasItem = coerceQuizItems(set.items).some((i) => i.id === itemId && !i.trashed);
    if (!hasItem) continue;
    const folder = set.folderId
      ? quizFolders.find((f) => f.id === set.folderId && !f.trashed)
      : undefined;
    return {
      setId: set.id,
      setName: set.name,
      folderId: set.folderId ?? null,
      folderName: folder?.name ?? null,
      fromNotes: false,
    };
  }

  return null;
}
