import type { Note, QuizItem, QuizSet, QuizFolder, Page } from '../types';
import type { Translation } from '../i18n/translations';
import {
  noteMatchesSearch,
  countNoteSearchHits,
  countSearchMatchesInText,
  decodeBasicEntities,
  normalizeSearch,
  getNoteSearchPlainText,
} from './noteSearch';

/** Global search stays idle until the query is at least this long (avoids 1-char freezes). */
export const MIN_GLOBAL_SEARCH_CHARS = 2;
/** Hard cap on rendered results — full highlight of hundreds of cards freezes the UI. */
export const MAX_GLOBAL_SEARCH_RESULTS = 80;

export type GlobalSearchResultType = 'note' | 'quiz';

export interface GlobalSearchResult {
  type: GlobalSearchResultType;
  id: number;
  categoryLabel: string;
  isFavorite: boolean;
  sortOrder: number;
  note?: Note;
  targetPage?: Page;
  title: string;
  snippet: string;
  quizItem?: QuizItem;
  quizSetId?: string | null;
  quizSetName?: string | null;
  quizFolderId?: string | null;
  quizFolderName?: string | null;
  quizCreatedAt?: string | null;
}

const SORT_FAVORITE = 0;
const SORT_OTHER = 1;

const FAVORITES_SET_ID = 'system-favorites-set';

function stripHtml(html: string) {
  return decodeBasicEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function getQuizSearchPlainText(item: QuizItem) {
  return [
    item.noteTitle,
    stripHtml(item.question),
    stripHtml(item.answer),
    item.explanation ?? '',
    ...(item.options ?? []).map(stripHtml),
  ].filter(Boolean).join(' ');
}

export function quizMatchesSearch(item: QuizItem, search: string) {
  const query = normalizeSearch(search);
  if (!query) return true;
  const haystack = quizSearchHaystack(item);
  return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
}

export function countQuizSearchHits(item: QuizItem, search: string) {
  return countSearchMatchesInText(getQuizSearchPlainText(item), search);
}

export function formatQuizItemCreatedAt(item: QuizItem): string {
  if (item.createdAt) return new Date(item.createdAt).toLocaleString();
  return new Date(item.id).toLocaleString();
}

function noteCategory(note: Note, t: Translation): { label: string; page: Page } {
  if (note.trashed) return { label: t.searchCategoryTrash, page: 'trash' };
  if (note.fav) return { label: t.searchCategoryFavorites, page: 'fav' };
  if (note.archived) return { label: t.searchCategoryArchive, page: 'archive' };
  if (note.read) return { label: t.searchCategoryRead, page: 'read' };
  if (!note.read) return { label: t.searchCategoryUnread, page: 'unread' };
  return { label: t.searchCategoryLibrary, page: 'home' };
}

type CollectedQuiz = {
  item: QuizItem;
  setId: string | null;
  setName: string | null;
  folderId: string | null;
  fromNotes: boolean;
};

export type { CollectedQuiz };

type HaystackCacheEntry = { key: string; haystack: string };
const quizHaystackCache = new WeakMap<QuizItem, HaystackCacheEntry>();

function quizHaystackKey(item: QuizItem) {
  return [
    item.id,
    item.noteTitle ?? '',
    item.question ?? '',
    item.answer ?? '',
    item.explanation ?? '',
    ...(item.options ?? []),
  ].join('\0');
}

function quizSearchHaystack(item: QuizItem) {
  const key = quizHaystackKey(item);
  const cached = quizHaystackCache.get(item);
  if (cached?.key === key) return cached.haystack;
  const haystack = normalizeSearch(getQuizSearchPlainText(item));
  quizHaystackCache.set(item, { key, haystack });
  return haystack;
}

export function collectQuizItems(quizzes: QuizItem[], quizSets: QuizSet[]): CollectedQuiz[] {
  const seen = new Set<number>();
  const results: CollectedQuiz[] = [];

  for (const set of quizSets) {
    if (set.trashed) continue;
    const isFavSet = set.id === FAVORITES_SET_ID || set.system === 'favorites';
    for (const item of set.items ?? []) {
      if (item.trashed) continue;
      if (item.favOf != null && !isFavSet) continue;
      const canonicalId = item.favOf ?? item.id;
      if (seen.has(canonicalId)) continue;
      seen.add(canonicalId);
      results.push({
        item,
        setId: set.id,
        setName: set.name,
        folderId: set.folderId ?? null,
        fromNotes: false,
      });
    }
  }

  for (const item of quizzes) {
    if (item.trashed) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    results.push({
      item,
      setId: null,
      setName: null,
      folderId: null,
      fromNotes: true,
    });
  }

  return results;
}

export function buildGlobalSearchResults(
  notes: Note[],
  quizzes: QuizItem[],
  quizSets: QuizSet[],
  quizFolders: QuizFolder[],
  search: string,
  t: Translation,
  favQuizIds: Set<number>,
  collectedQuizzes?: CollectedQuiz[],
): GlobalSearchResult[] {
  const query = normalizeSearch(search);
  if (!query || query.length < MIN_GLOBAL_SEARCH_CHARS) return [];

  const folderNameById = new Map(
    quizFolders.filter((folder) => !folder.trashed).map((folder) => [folder.id, folder.name]),
  );

  const results: GlobalSearchResult[] = [];
  const quizItems = collectedQuizzes ?? collectQuizItems(quizzes, quizSets);

  for (const note of notes) {
    if (results.length >= MAX_GLOBAL_SEARCH_RESULTS) break;
    if (!noteMatchesSearch(note, search)) continue;
    const cat = noteCategory(note, t);
    const body = getNoteSearchPlainText(note);
    const title = note.title?.trim() || body.slice(0, 80) || '…';
    results.push({
      type: 'note',
      id: note.id,
      categoryLabel: cat.label,
      isFavorite: !!note.fav,
      sortOrder: note.fav ? SORT_FAVORITE : SORT_OTHER,
      note,
      targetPage: cat.page,
      title,
      snippet: body.slice(0, 220),
    });
  }

  for (const { item, setId, setName, folderId, fromNotes } of quizItems) {
    if (results.length >= MAX_GLOBAL_SEARCH_RESULTS) break;
    if (!quizMatchesSearch(item, search)) continue;
    const isFavorite = favQuizIds.has(item.id) || favQuizIds.has(item.favOf ?? -1) || setId === FAVORITES_SET_ID;
    let categoryLabel: string;
    if (isFavorite) {
      categoryLabel = t.searchCategoryQuizFavorites;
    } else if (fromNotes) {
      categoryLabel = t.searchCategoryQuiz;
    } else if (setName) {
      categoryLabel = t.searchCategoryQuizSet.replace('{name}', setName);
    } else {
      categoryLabel = t.searchCategoryQuiz;
    }
    const question = stripHtml(item.question);
    const folderName = folderId
      ? (folderNameById.get(folderId) ?? null)
      : fromNotes
        ? t.searchCategoryQuiz
        : null;
    const displaySetName = setName ?? (fromNotes ? item.noteTitle || null : null);
    results.push({
      type: 'quiz',
      id: item.id,
      categoryLabel,
      isFavorite,
      sortOrder: isFavorite ? SORT_FAVORITE : SORT_OTHER,
      quizItem: item,
      quizSetId: setId,
      quizSetName: displaySetName,
      quizFolderId: folderId,
      quizFolderName: folderName,
      quizCreatedAt: formatQuizItemCreatedAt(item),
      title: question.slice(0, 100) || '…',
      snippet: question.slice(0, 220),
    });
  }

  results.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.type !== b.type) return a.type === 'note' ? -1 : 1;
    return 0;
  });

  return results.slice(0, MAX_GLOBAL_SEARCH_RESULTS);
}

export function globalSearchResultKey(result: GlobalSearchResult) {
  return `${result.type}-${result.id}`;
}

export function buildGlobalSearchHitStarts(results: GlobalSearchResult[], search: string) {
  const starts: Record<string, number> = {};
  let total = 0;
  for (const result of results) {
    const key = globalSearchResultKey(result);
    starts[key] = total;
    if (result.type === 'note' && result.note) {
      total += countNoteSearchHits(result.note, search);
    } else if (result.type === 'quiz' && result.quizItem) {
      total += countQuizSearchHits(result.quizItem, search);
    }
  }
  return { starts, total };
}
