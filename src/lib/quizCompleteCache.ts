/**
 * Durable "last-good" complete quiz snapshot for instant correct first paint.
 *
 * Boot must not choose between "wait for ById" and "paint stale LS-9".
 * After any full successful merge we persist the complete sets (bodies + order).
 * Next open reads this synchronously from localStorage and paints immediately.
 *
 * IndexedDB mirror survives QuotaExceeded on the LS key; async hydrate still
 * beats waiting on the network.
 */
import type { QuizItem, QuizSet } from '../types';
import {
  bumpMaxKnownLiveBySet,
  countLiveQuizItems,
  isQuizSetsLocalWriteSafe,
  quizListsHaveNewerOrderStamps,
  quizListsHaveStrictlyNewerItems,
  quizSetsMembershipShrunk,
  quizSetsSoftTrashExplainsShrink,
  unionQuizSetsForCommit,
} from './quizSetMerge';

export { quizListsHaveNewerOrderStamps, quizListsHaveStrictlyNewerItems };

export const QUIZ_COMPLETE_CACHE_LS_KEY = 'malacadhati_quiz_sets_complete_cache';

const IDB_NAME = 'malacadhati_items_v1';
const COMPLETE_STORE = 'quizCompleteCache';
const COMPLETE_KEY = 'lastGood';
/** Bump when adding stores; must stay >= itemsStore version (2). */
const IDB_VERSION = 3;

export type QuizCompleteCacheSnapshot = {
  quizzes: QuizItem[];
  sets: QuizSet[];
  savedAt: number;
  liveItemCount: number;
};

/** True when at least one item carries real Q/A body text (not a structure shell). */
export function quizSetsHaveCompleteBodies(sets: QuizSet[]): boolean {
  for (const set of sets) {
    for (const item of set.items ?? []) {
      if (String(item.question || '').trim() || String(item.answer || '').trim()) {
        return true;
      }
    }
  }
  return false;
}

function normalizeSnapshot(
  quizzes: QuizItem[],
  sets: QuizSet[],
  savedAt = Date.now(),
): QuizCompleteCacheSnapshot {
  return {
    quizzes,
    sets: sets.map((set) => ({ ...set, items: set.items ?? [] })),
    savedAt,
    liveItemCount: countLiveQuizItems(sets),
  };
}

function parseSnapshot(raw: unknown): QuizCompleteCacheSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<QuizCompleteCacheSnapshot>;
  if (!Array.isArray(obj.sets) || !obj.sets.length) return null;
  const sets = obj.sets.map((set) => ({ ...set, items: set.items ?? [] }));
  if (!quizSetsHaveCompleteBodies(sets)) return null;
  const quizzes = Array.isArray(obj.quizzes) ? obj.quizzes : [];
  return normalizeSnapshot(quizzes, sets, typeof obj.savedAt === 'number' ? obj.savedAt : Date.now());
}

/** Sync read — used on first paint. */
export function readQuizCompleteCache(): QuizCompleteCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(QUIZ_COMPLETE_CACHE_LS_KEY);
    if (!raw) return null;
    return parseSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/**
 * Persist last-good. Never overwrite a richer complete snapshot with a shorter
 * incomplete shell (classic 11→9 poison). Soft-deletes that explain shrink win.
 */
export function writeQuizCompleteCache(quizzes: QuizItem[], sets: QuizSet[]): boolean {
  if (!sets.length || !quizSetsHaveCompleteBodies(sets)) return false;
  const prev = readQuizCompleteCache();
  if (prev) {
    const maxKnown = new Map<string, number>();
    bumpMaxKnownLiveBySet(maxKnown, prev.sets);
    if (!isQuizSetsLocalWriteSafe(sets, maxKnown, prev.sets)) return false;
    if (
      quizSetsMembershipShrunk(prev.sets, sets)
      && !quizSetsSoftTrashExplainsShrink(prev.sets, sets)
      && countLiveQuizItems(sets) < countLiveQuizItems(prev.sets)
    ) {
      return false;
    }
  }
  const snap = normalizeSnapshot(quizzes, sets);
  try {
    localStorage.setItem(QUIZ_COMPLETE_CACHE_LS_KEY, JSON.stringify(snap));
    return true;
  } catch (err) {
    console.error('[quizCompleteCache] localStorage write failed', err);
    return false;
  }
}

export function clearQuizCompleteCache(): void {
  try {
    localStorage.removeItem(QUIZ_COMPLETE_CACHE_LS_KEY);
  } catch {
    /* ignore */
  }
  void clearQuizCompleteCacheIdb();
}

function openCompleteDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Keep parity with itemsStore stores if this DB is created here first.
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('quizItems')) {
        db.createObjectStore('quizItems', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('quizSets')) {
        db.createObjectStore('quizSets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(COMPLETE_STORE)) {
        db.createObjectStore(COMPLETE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open-failed'));
  });
}

export async function writeQuizCompleteCacheIdb(
  quizzes: QuizItem[],
  sets: QuizSet[],
): Promise<boolean> {
  if (!sets.length || !quizSetsHaveCompleteBodies(sets)) return false;
  const prev = await readQuizCompleteCacheIdb();
  if (prev) {
    const maxKnown = new Map<string, number>();
    bumpMaxKnownLiveBySet(maxKnown, prev.sets);
    if (!isQuizSetsLocalWriteSafe(sets, maxKnown, prev.sets)) return false;
  }
  const snap = { id: COMPLETE_KEY, ...normalizeSnapshot(quizzes, sets) };
  try {
    const db = await openCompleteDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPLETE_STORE, 'readwrite');
      tx.objectStore(COMPLETE_STORE).put(snap);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (err) {
    console.error('[quizCompleteCache] IndexedDB write failed', err);
    return false;
  }
}

export async function readQuizCompleteCacheIdb(): Promise<QuizCompleteCacheSnapshot | null> {
  try {
    const db = await openCompleteDb();
    const row = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(COMPLETE_STORE, 'readonly');
      const req = tx.objectStore(COMPLETE_STORE).get(COMPLETE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
    return parseSnapshot(row);
  } catch {
    return null;
  }
}

async function clearQuizCompleteCacheIdb(): Promise<void> {
  try {
    const db = await openCompleteDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPLETE_STORE, 'readwrite');
      tx.objectStore(COMPLETE_STORE).delete(COMPLETE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

/** Persist both LS (sync boot) and IDB (quota / durability). */
export function persistQuizCompleteCache(quizzes: QuizItem[], sets: QuizSet[]): void {
  writeQuizCompleteCache(quizzes, sets);
  void writeQuizCompleteCacheIdb(quizzes, sets);
}

/**
 * Pick sync boot lists: last-good complete cache beats incomplete LS shells.
 * In-memory session cache (React remount) is preferred when at least as rich.
 */
export function pickBootQuizLists(opts: {
  localQuizzes: QuizItem[];
  localSets: QuizSet[];
  lastGood: QuizCompleteCacheSnapshot | null;
  memory: { quizzes: QuizItem[]; sets: QuizSet[] } | null;
}): {
  quizzes: QuizItem[];
  sets: QuizSet[];
  fromLastGood: boolean;
  source: 'memory' | 'last-good' | 'local';
} {
  const localLive = countLiveQuizItems(opts.localSets);
  const localComplete = quizSetsHaveCompleteBodies(opts.localSets);

  if (
    opts.memory
    && opts.memory.sets.length > 0
    && (
      countLiveQuizItems(opts.memory.sets) >= localLive
      || (quizSetsHaveCompleteBodies(opts.memory.sets) && !localComplete)
    )
  ) {
    const sets = unionQuizSetsForCommit(opts.memory.sets, opts.localSets, opts.lastGood?.sets ?? []);
    return {
      quizzes: opts.memory.quizzes.length ? opts.memory.quizzes : opts.localQuizzes,
      sets,
      fromLastGood: true,
      source: 'memory',
    };
  }

  if (opts.lastGood && opts.lastGood.sets.length > 0 && quizSetsHaveCompleteBodies(opts.lastGood.sets)) {
    const lastLive = countLiveQuizItems(opts.lastGood.sets);
    // Last-good wins over incomplete / shorter LS. Never boot-paint LS-9 over cache-11.
    if (lastLive >= localLive || !localComplete) {
      const sets = unionQuizSetsForCommit(opts.lastGood.sets, opts.localSets);
      return {
        quizzes: opts.lastGood.quizzes.length ? opts.lastGood.quizzes : opts.localQuizzes,
        sets,
        fromLastGood: true,
        source: 'last-good',
      };
    }
  }

  return {
    quizzes: opts.localQuizzes,
    sets: opts.localSets,
    fromLastGood: false,
    source: 'local',
  };
}

/**
 * Background merge may update UI when membership grew, bodies are strictly
 * newer, or order stamps moved — never replace last-good with older/shorter.
 */
export function shouldApplyBackgroundQuizUpdate(painted: QuizSet[], next: QuizSet[]): boolean {
  if (!painted.length && next.length) return true;
  if (!next.length) return false;
  if (countLiveQuizItems(next) > countLiveQuizItems(painted)) return true;
  if (
    quizSetsMembershipShrunk(painted, next)
    && !quizSetsSoftTrashExplainsShrink(painted, next)
    && countLiveQuizItems(next) < countLiveQuizItems(painted)
  ) {
    return false;
  }
  if (quizListsHaveStrictlyNewerItems(painted, next)) return true;
  if (quizListsHaveNewerOrderStamps(painted, next)) return true;
  if (quizSetsSoftTrashExplainsShrink(painted, next)) return true;
  return false;
}
