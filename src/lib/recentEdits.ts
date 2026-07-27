/**
 * Write-ahead journal for the last few note/quiz edits.
 *
 * Lives in IndexedDB (not localStorage) because image-bearing notes can be
 * several hundred KB of base64 — exactly the payload that already overflows
 * the localStorage quota. A journal entry that itself fails to write is useless.
 * IndexedDB has a much larger quota and is the durable last line of defence
 * when both the big localStorage arrays and an in-flight cloud write fail.
 */
import type { Note, QuizItem } from '../types';

const IDB_NAME = 'malacadhati_recent_edits';
const IDB_STORE = 'edits';
const IDB_KEY = 'entries';
const MAX_ENTRIES = 20;
const TTL_MS = 48 * 60 * 60 * 1000;

export type RecentEdit =
  | { kind: 'note'; at: number; note: Note }
  | { kind: 'quiz'; at: number; quiz: QuizItem }
  | { kind: 'setItem'; at: number; setId: string; item: QuizItem };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open-failed'));
  });
}

async function idbGet(): Promise<RecentEdit[]> {
  try {
    const db = await openDb();
    return await new Promise<RecentEdit[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        const raw = req.result;
        resolve(Array.isArray(raw) ? (raw as RecentEdit[]) : []);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

async function idbPut(entries: RecentEdit[]): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(entries, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('[recentEdits] IndexedDB write failed', err);
  }
}

function sameTarget(a: RecentEdit, b: RecentEdit): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'note' && b.kind === 'note') return a.note.id === b.note.id;
  if (a.kind === 'quiz' && b.kind === 'quiz') return a.quiz.id === b.quiz.id;
  if (a.kind === 'setItem' && b.kind === 'setItem') {
    return a.setId === b.setId && a.item.id === b.item.id;
  }
  return false;
}

function prune(entries: RecentEdit[]): RecentEdit[] {
  const cutoff = Date.now() - TTL_MS;
  return entries.filter((e) => e && typeof e.at === 'number' && e.at > cutoff).slice(0, MAX_ENTRIES);
}

/** In-memory mirror so sync callers (record on save) don't have to await. */
let memoryCache: RecentEdit[] = [];
let memoryReady = false;

export async function loadRecentEdits(): Promise<RecentEdit[]> {
  const fromDisk = prune(await idbGet());
  memoryCache = fromDisk;
  memoryReady = true;
  return fromDisk;
}

export function peekRecentEdits(): RecentEdit[] {
  return memoryCache;
}

export function recordRecentEdit(entry: RecentEdit): void {
  const rest = (memoryReady ? memoryCache : memoryCache).filter((e) => !sameTarget(e, entry));
  memoryCache = prune([entry, ...rest]);
  memoryReady = true;
  void idbPut(memoryCache);
}

export function entitySyncTime(item: { updatedAt?: string; createdAt?: string; savedAt?: string }) {
  return Date.parse(item.updatedAt || item.savedAt || item.createdAt || '') || 0;
}

/** Fold journaled edits into locally-loaded data; newer copies always win. */
export function applyRecentEditsToData<T extends {
  notes: Note[];
  quizzes: QuizItem[];
  sets: import('../types').QuizSet[];
}>(data: T, edits: RecentEdit[] = memoryCache): T {
  if (!edits.length) return data;
  let { notes, quizzes, sets } = data;
  for (const edit of [...edits].reverse()) {
    if (edit.kind === 'note') {
      const existing = notes.find((n) => n.id === edit.note.id);
      if (existing?.trashed) continue;
      if (existing && entitySyncTime(existing) >= entitySyncTime(edit.note)) continue;
      notes = existing
        ? notes.map((n) => (n.id === edit.note.id ? edit.note : n))
        : [edit.note, ...notes];
    } else if (edit.kind === 'quiz') {
      const existing = quizzes.find((q) => q.id === edit.quiz.id);
      if (existing?.trashed) continue;
      if (existing && entitySyncTime(existing) >= entitySyncTime(edit.quiz)) continue;
      quizzes = existing
        ? quizzes.map((q) => (q.id === edit.quiz.id ? edit.quiz : q))
        : [...quizzes, edit.quiz];
    } else {
      sets = sets.map((set) => {
        if (set.id !== edit.setId) return set;
        const existing = set.items.find((i) => i.id === edit.item.id);
        if (existing?.trashed) return set;
        if (existing && entitySyncTime(existing) >= entitySyncTime(edit.item)) return set;
        const items = existing
          ? set.items.map((i) => (i.id === edit.item.id ? edit.item : i))
          : [...set.items, edit.item];
        const editAtIso = new Date(edit.at).toISOString();
        return {
          ...set,
          items,
          updatedAt: !set.updatedAt || set.updatedAt < editAtIso ? editAtIso : set.updatedAt,
        };
      });
    }
  }
  return { ...data, notes, quizzes, sets };
}
