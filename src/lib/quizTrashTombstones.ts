/**
 * Tiny durable quiz trash markers (items/sets/folders).
 *
 * The last-good complete cache is multi-MB and often fills localStorage.
 * If a soft-delete tombstone cannot be written, the next refresh paints
 * last-good live copies and Trash reverts. These keys are a few hundred
 * bytes — they must win quota over the complete cache.
 */
import type { QuizItem, QuizSet } from '../types';
import {
  applyQuizItemTrashTombstones,
  applyQuizItemTrashTombstonesToSets,
  applySetTrashTombstones,
} from './quizSetMerge';

export const QUIZ_SET_TRASH_TOMBSTONE_KEY = 'malacadhati_quiz_set_trash_tombstones';
export const QUIZ_FOLDER_TRASH_TOMBSTONE_KEY = 'malacadhati_quiz_folder_trash_tombstones';
export const QUIZ_ITEM_TRASH_TOMBSTONE_KEY = 'malacadhati_quiz_item_trash_tombstones';
export const TRASH_EMPTIED_AT_KEY = 'malacadhati_trash_emptied_at';
export const PERM_DELETED_KEY = 'malacadhati_perm_deleted';
const LAST_GOOD_LS_KEY = 'malacadhati_quiz_sets_complete_cache';

export type TrashTombstones = Record<string, number>;

const IDB_NAME = 'malacadhati_items_v1';
const IDB_VERSION = 4;
const TOMBSTONE_STORE = 'quizTrashTombstones';
const TOMBSTONE_ROW = 'all';

export function normalizeTombstoneMap(raw: unknown): TrashTombstones {
  if (!raw || typeof raw !== 'object') return {};
  const out: TrashTombstones = {};
  for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(at);
    if (id && Number.isFinite(n)) out[id] = n;
  }
  return out;
}

export function readTrashTombstones(key: string): TrashTombstones {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return normalizeTombstoneMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

function writeLs(key: string, json: string): boolean {
  try {
    localStorage.setItem(key, json);
    return true;
  } catch {
    try {
      localStorage.removeItem(LAST_GOOD_LS_KEY);
      localStorage.setItem(key, json);
      return true;
    } catch {
      return false;
    }
  }
}

export function writeTrashTombstones(key: string, tombstones: TrashTombstones): void {
  writeLs(key, JSON.stringify(tombstones));
  void persistAllTombstonesIdb();
}

/** Tiny keys must win quota over the multi-MB last-good cache. */
export function writeTinyDurableValue(key: string, value: string): boolean {
  const ok = writeLs(key, value);
  void persistAllTombstonesIdb();
  return ok;
}

export function readTrashEmptiedAt(): number {
  try {
    return Number(localStorage.getItem(TRASH_EMPTIED_AT_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function writeTrashEmptiedAt(at: number): void {
  if (!Number.isFinite(at) || at <= 0) return;
  if (at <= readTrashEmptiedAt()) return;
  writeLs(TRASH_EMPTIED_AT_KEY, String(at));
  void persistAllTombstonesIdb();
}

function readPermDeletedLite(): { quizzes: number[]; quizSets: string[] } {
  try {
    const raw = localStorage.getItem(PERM_DELETED_KEY);
    if (!raw) return { quizzes: [], quizSets: [] };
    const parsed = JSON.parse(raw) as { quizzes?: unknown; quizSets?: unknown };
    return {
      quizzes: Array.isArray(parsed.quizzes)
        ? [...new Set(parsed.quizzes.map(Number).filter(Number.isFinite))]
        : [],
      quizSets: Array.isArray(parsed.quizSets) ? [...new Set(parsed.quizSets.map(String))] : [],
    };
  } catch {
    return { quizzes: [], quizSets: [] };
  }
}

function entityTime(row: { updatedAt?: string; createdAt?: string; savedAt?: string }): number {
  return Date.parse(row.updatedAt || row.savedAt || row.createdAt || '') || 0;
}

/**
 * Drop Empty-Trash / permanent-delete ghosts so last-good cannot resurrect
 * them into Quiz or Trash after refresh.
 */
export function pruneQuizListsAgainstTrashState(
  quizzes: QuizItem[],
  sets: QuizSet[],
  tombstones = readAllQuizTrashTombstones(),
): { quizzes: QuizItem[]; sets: QuizSet[] } {
  const emptiedAt = readTrashEmptiedAt();
  const dead = readPermDeletedLite();
  const deadQ = new Set(dead.quizzes);
  const deadS = new Set(dead.quizSets);
  const dropItem = (item: QuizItem) =>
    deadQ.has(item.id) || (!!item.trashed && emptiedAt > 0 && entityTime(item) <= emptiedAt);
  const dropSet = (set: QuizSet) =>
    deadS.has(set.id) || (!!set.trashed && emptiedAt > 0 && entityTime(set) <= emptiedAt);
  const nextSets = sets.filter((set) => !dropSet(set)).map((set) => {
    const items = (set.items ?? []).filter((item) => !dropItem(item));
    return items.length === (set.items ?? []).length ? set : { ...set, items };
  });
  const nextQuizzes = quizzes.filter((item) => !dropItem(item));
  return honorQuizListsWithTrashTombstones(nextQuizzes, nextSets, tombstones);
}

export function readAllQuizTrashTombstones(): {
  items: TrashTombstones;
  sets: TrashTombstones;
  folders: TrashTombstones;
} {
  return {
    items: readTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY),
    sets: readTrashTombstones(QUIZ_SET_TRASH_TOMBSTONE_KEY),
    folders: readTrashTombstones(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY),
  };
}

/** Stamp last-good / boot lists with durable trash markers before paint or save. */
export function honorQuizListsWithTrashTombstones(
  quizzes: QuizItem[],
  sets: QuizSet[],
  tombstones = readAllQuizTrashTombstones(),
): { quizzes: QuizItem[]; sets: QuizSet[] } {
  const emptiedAt = readTrashEmptiedAt();
  return {
    quizzes: applyQuizItemTrashTombstones(quizzes, tombstones.items, { emptiedAt }),
    sets: applySetTrashTombstones(
      applyQuizItemTrashTombstonesToSets(sets, tombstones.items, { emptiedAt }),
      tombstones.sets,
      { emptiedAt },
    ),
  };
}

function openTombstoneDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quizItems')) db.createObjectStore('quizItems', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quizSets')) db.createObjectStore('quizSets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('quizCompleteCache')) {
        db.createObjectStore('quizCompleteCache', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
        db.createObjectStore(TOMBSTONE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open-failed'));
  });
}

async function persistAllTombstonesIdb(): Promise<void> {
  const dead = readPermDeletedLite();
  const all = {
    id: TOMBSTONE_ROW,
    ...readAllQuizTrashTombstones(),
    emptiedAt: readTrashEmptiedAt(),
    permDeletedQuizzes: dead.quizzes,
    permDeletedSets: dead.quizSets,
  };
  try {
    const db = await openTombstoneDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TOMBSTONE_STORE, 'readwrite');
      tx.objectStore(TOMBSTONE_STORE).put(all);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function readQuizTrashTombstonesIdb(): Promise<{
  items: TrashTombstones;
  sets: TrashTombstones;
  folders: TrashTombstones;
  emptiedAt?: number;
  permDeletedQuizzes?: number[];
  permDeletedSets?: string[];
} | null> {
  try {
    const db = await openTombstoneDb();
    const row = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(TOMBSTONE_STORE, 'readonly');
      const req = tx.objectStore(TOMBSTONE_STORE).get(TOMBSTONE_ROW);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    if (!row || typeof row !== 'object') return null;
    const obj = row as {
      items?: unknown;
      sets?: unknown;
      folders?: unknown;
      emptiedAt?: unknown;
      permDeletedQuizzes?: unknown;
      permDeletedSets?: unknown;
    };
    return {
      items: normalizeTombstoneMap(obj.items),
      sets: normalizeTombstoneMap(obj.sets),
      folders: normalizeTombstoneMap(obj.folders),
      emptiedAt: Number(obj.emptiedAt) || 0,
      permDeletedQuizzes: Array.isArray(obj.permDeletedQuizzes)
        ? obj.permDeletedQuizzes.map(Number).filter(Number.isFinite)
        : [],
      permDeletedSets: Array.isArray(obj.permDeletedSets) ? obj.permDeletedSets.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function mergeTombstoneMaps(local: TrashTombstones, extra: TrashTombstones): TrashTombstones {
  const merged = { ...local };
  for (const [id, at] of Object.entries(extra)) {
    merged[id] = Math.max(merged[id] ?? 0, at);
  }
  return merged;
}
