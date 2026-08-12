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

function readTrashEmptiedAt(): number {
  try {
    return Number(localStorage.getItem('malacadhati_trash_emptied_at')) || 0;
  } catch {
    return 0;
  }
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
  const all = { id: TOMBSTONE_ROW, ...readAllQuizTrashTombstones() };
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
    const obj = row as { items?: unknown; sets?: unknown; folders?: unknown };
    return {
      items: normalizeTombstoneMap(obj.items),
      sets: normalizeTombstoneMap(obj.sets),
      folders: normalizeTombstoneMap(obj.folders),
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
