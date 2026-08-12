/**
 * Durable per-item persistence for notes (and quiz items).
 *
 * WHY THIS EXISTS
 * ---------------
 * Saving used to rewrite the ENTIRE notes / quizSets arrays into localStorage
 * and Firebase on every edit. With legacy base64 images that payload is multi-MB,
 * localStorage throws QuotaExceeded, and a refresh mid-upload cancels the cloud
 * write — so an image note that "looked saved" vanished. Forever.
 *
 * This module is the radical fix:
 *  1. Every note is written alone into IndexedDB (large quota, awaitable).
 *  2. Every note is written alone into RTDB at users/{uid}/notesById/{id}.
 *     A single-item update is small and finishes in milliseconds.
 *  3. On boot we merge notesById (cloud) + IndexedDB into the notes list
 *     BEFORE trusting the big array — so a cancelled full-array sync cannot
 *     erase a just-saved note.
 *
 * The big-array sync can keep running in the background for compatibility;
 * this path is what actually guarantees survival across refresh.
 */
import { ref as dbRef, remove, set, update } from 'firebase/database';
import type { Note, QuizFolder, QuizItem, QuizSet } from '../types';
import { database } from './firebase';
import { applyQuizItemsOrder } from './quizSetMerge';
import { rtdbFetch } from './rtdb';

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const IDB_NAME = 'malacadhati_items_v1';
const NOTES_STORE = 'notes';
const QUIZ_STORE = 'quizItems';
const QUIZ_SETS_STORE = 'quizSets';
/** Keep in sync with quizCompleteCache IDB_VERSION (adds quizCompleteCache store). */
const IDB_VERSION = 3;
const QUIZ_COMPLETE_CACHE_STORE = 'quizCompleteCache';

export type StoredQuizItem = QuizItem & { setId?: string | null };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUIZ_STORE)) {
        db.createObjectStore(QUIZ_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUIZ_SETS_STORE)) {
        db.createObjectStore(QUIZ_SETS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(QUIZ_COMPLETE_CACHE_STORE)) {
        db.createObjectStore(QUIZ_COMPLETE_CACHE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb-open-failed'));
  });
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return openDb().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  ).catch(() => [] as T[]);
}

function idbDelete(store: string, id: number | string): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  ).catch(() => undefined);
}

function syncTime(item: { updatedAt?: string; createdAt?: string; savedAt?: string }) {
  return Date.parse(item.updatedAt || item.savedAt || item.createdAt || '') || 0;
}

/** Merge by id; newer wins. */
export function mergeByIdNewer<T extends { id: number | string; updatedAt?: string; createdAt?: string; savedAt?: string; trashed?: boolean }>(
  ...lists: T[][]
): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      if (!item || item.id == null) continue;
      const key = String(item.id);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
        continue;
      }
      if (!!existing.trashed !== !!item.trashed) {
        map.set(key, item.trashed ? item : existing);
        continue;
      }
      if (syncTime(item) >= syncTime(existing)) map.set(key, item);
    }
  }
  return [...map.values()];
}

// ── Notes ──────────────────────────────────────────────────────────────────

export async function putNoteLocal(note: Note): Promise<void> {
  try {
    await idbPut(NOTES_STORE, note);
  } catch (err) {
    console.error('[itemsStore] IndexedDB note write failed', err);
  }
}

export async function getAllNotesLocal(): Promise<Note[]> {
  return idbGetAll<Note>(NOTES_STORE);
}

export async function deleteNoteLocal(id: number): Promise<void> {
  await idbDelete(NOTES_STORE, id);
}

/** Single-note cloud write — independent of the giant notes[] array. */
export async function putNoteCloud(uid: string, note: Note): Promise<boolean> {
  try {
    await update(dbRef(database, `users/${uid}/notesById/${note.id}`), note);
    return true;
  } catch (err) {
    console.error('[itemsStore] notesById cloud write failed', err);
    try {
      const res = await rtdbFetch(`/users/${uid}/notesById/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      return res.ok;
    } catch (err2) {
      console.error('[itemsStore] notesById REST fallback failed', err2);
      return false;
    }
  }
}

export async function fetchNotesByIdCloud(uid: string): Promise<Note[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/notesById`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, Note>).filter((n) => n && typeof n === 'object' && n.id != null);
  } catch {
    return [];
  }
}

/**
 * Persist one note durably: IndexedDB first (survives refresh even offline),
 * then a single-item cloud write. Returns whether the cloud write succeeded.
 */
export async function persistNoteDurable(uid: string | null | undefined, note: Note): Promise<boolean> {
  await putNoteLocal(note);
  if (!uid) return false;
  return putNoteCloud(uid, note);
}

/** Soft-delete tombstone — must run on every trash so IndexedDB/notesById
 *  cannot resurrect the live copy after refresh. */
export async function tombstoneNoteDurable(
  uid: string | null | undefined,
  note: Note,
): Promise<boolean> {
  const trashAt = new Date().toISOString();
  const stored: Note = {
    ...note,
    trashed: true,
    deletedAt: note.deletedAt || trashAt,
    savedAt: trashAt,
  };
  return persistNoteDurable(uid, stored);
}

/** Permanent delete from IndexedDB + notesById. */
export async function removeNoteDurable(
  uid: string | null | undefined,
  id: number,
): Promise<void> {
  await deleteNoteLocal(id);
  if (!uid) return;
  try {
    await remove(dbRef(database, `users/${uid}/notesById/${id}`));
  } catch {
    try {
      await rtdbFetch(`/users/${uid}/notesById/${id}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  }
}

// ── Quiz items ─────────────────────────────────────────────────────────────

export async function putQuizItemLocal(item: StoredQuizItem): Promise<void> {
  try {
    await idbPut(QUIZ_STORE, item);
  } catch (err) {
    console.error('[itemsStore] IndexedDB quiz write failed', err);
  }
}

export async function getAllQuizItemsLocal(): Promise<StoredQuizItem[]> {
  return idbGetAll<StoredQuizItem>(QUIZ_STORE);
}

export async function deleteQuizItemLocal(id: number): Promise<void> {
  await idbDelete(QUIZ_STORE, id);
}

/** Soft-delete tombstone for cross-device realtime sync (small single-item write). */
export async function tombstoneQuizItemDurable(
  uid: string | null | undefined,
  item: QuizItem,
  setId?: string | null,
): Promise<boolean> {
  const trashAt = new Date().toISOString();
  const stored: StoredQuizItem = stripUndefined({
    ...item,
    setId: setId ?? null,
    trashed: true,
    deletedAt: item.deletedAt || trashAt,
    updatedAt: trashAt,
  });
  await putQuizItemLocal(stored);
  if (!uid) return false;
  try {
    await set(dbRef(database, `users/${uid}/quizItemsById/${item.id}`), stored);
    return true;
  } catch (err) {
    console.error('[itemsStore] quizItemsById tombstone failed', err);
    try {
      const res = await rtdbFetch(`/users/${uid}/quizItemsById/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stored),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Permanent delete from IndexedDB + quizItemsById. */
export async function removeQuizItemDurable(
  uid: string | null | undefined,
  id: number,
): Promise<void> {
  await deleteQuizItemLocal(id);
  if (!uid) return;
  try {
    await remove(dbRef(database, `users/${uid}/quizItemsById/${id}`));
  } catch {
    try {
      await rtdbFetch(`/users/${uid}/quizItemsById/${id}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  }
}

const quizCloudWriteTimers = new Map<number, ReturnType<typeof setTimeout>>();
const quizCloudWriteLatest = new Map<number, { uid: string; stored: StoredQuizItem }>();

async function flushQuizItemCloud(id: number): Promise<boolean> {
  const pending = quizCloudWriteLatest.get(id);
  quizCloudWriteLatest.delete(id);
  quizCloudWriteTimers.delete(id);
  if (!pending) return false;
  const { uid, stored } = pending;
  try {
    // Full replace (set) so removed optional fields clear and listeners fire fast.
    await set(dbRef(database, `users/${uid}/quizItemsById/${id}`), stored);
    return true;
  } catch (err) {
    console.error('[itemsStore] quizItemsById cloud write failed', err);
    try {
      const res = await rtdbFetch(`/users/${uid}/quizItemsById/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stored),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Live-safe quiz item write: IndexedDB immediately, cloud coalesced (~80ms) so
 * other devices see typing without a multi-MB quizSets rewrite on every key.
 */
export async function persistQuizItemDurable(
  uid: string | null | undefined,
  item: QuizItem,
  setId?: string | null,
  opts?: { immediate?: boolean },
): Promise<boolean> {
  const stored: StoredQuizItem = stripUndefined({ ...item, setId: setId ?? null });
  await putQuizItemLocal(stored);
  if (!uid) return false;

  quizCloudWriteLatest.set(item.id, { uid, stored });
  const existingTimer = quizCloudWriteTimers.get(item.id);
  if (opts?.immediate) {
    if (existingTimer) clearTimeout(existingTimer);
    return flushQuizItemCloud(item.id);
  }
  if (existingTimer) return true;
  quizCloudWriteTimers.set(
    item.id,
    setTimeout(() => { void flushQuizItemCloud(item.id); }, 80),
  );
  return true;
}

export async function fetchQuizItemsByIdCloud(uid: string): Promise<StoredQuizItem[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/quizItemsById`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, StoredQuizItem>).filter(
      (q) => q && typeof q === 'object' && q.id != null,
    );
  } catch {
    return [];
  }
}

/** Slim set shell for IndexedDB — membership/metadata only (items live in quizItems). */
function quizSetShell(set: QuizSet): QuizSet {
  const itemsOrder = (set.items ?? []).length
    ? (set.items ?? []).map((item) => item.id)
    : (set.itemsOrder ?? []);
  return stripUndefined({
    ...set,
    items: [],
    ...(itemsOrder.length ? { itemsOrder } : {}),
  });
}

export async function putQuizSetLocal(set: QuizSet): Promise<void> {
  try {
    await idbPut(QUIZ_SETS_STORE, quizSetShell(set));
  } catch (err) {
    console.error('[itemsStore] IndexedDB quizSet write failed', err);
  }
}

export async function getAllQuizSetsLocal(): Promise<QuizSet[]> {
  const rows = await idbGetAll<QuizSet>(QUIZ_SETS_STORE);
  return rows
    .filter((s) => s && typeof s === 'object' && s.id != null)
    .map((set) => ({ ...set, items: set.items ?? [] }));
}

export async function deleteQuizSetLocal(id: string): Promise<void> {
  await idbDelete(QUIZ_SETS_STORE, id);
}

/** Single-set cloud write — finishes in ms; does not wait on giant quizSets[]. */
export async function putQuizSetCloud(uid: string, quizSet: QuizSet): Promise<boolean> {
  // Keep items on the cloud mirror (rename/trash must not blank questions).
  // Create paths pass items: [] so the row stays tiny and lands immediately.
  const payload = stripUndefined({ ...quizSet, items: quizSet.items ?? [] });
  try {
    await set(dbRef(database, `users/${uid}/quizSetsById/${quizSet.id}`), payload);
    return true;
  } catch (err) {
    console.error('[itemsStore] quizSetsById cloud write failed', err);
    try {
      const res = await rtdbFetch(`/users/${uid}/quizSetsById/${quizSet.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return res.ok;
    } catch (err2) {
      console.error('[itemsStore] quizSetsById REST fallback failed', err2);
      return false;
    }
  }
}

/**
 * Durable set create/rename/trash: IndexedDB first (survives refresh + quota),
 * then await ById cloud write. Giant quizSets[] can catch up in the background.
 */
export async function persistQuizSetDurable(
  uid: string | null | undefined,
  quizSet: QuizSet,
): Promise<boolean> {
  await putQuizSetLocal(quizSet);
  if (!uid) return false;
  return putQuizSetCloud(uid, quizSet);
}

export async function removeQuizSetDurable(
  uid: string | null | undefined,
  id: string,
): Promise<void> {
  await deleteQuizSetLocal(id);
  if (!uid) return;
  try {
    await remove(dbRef(database, `users/${uid}/quizSetsById/${id}`));
  } catch {
    try {
      await rtdbFetch(`/users/${uid}/quizSetsById/${id}`, { method: 'DELETE' });
    } catch {
      /* best-effort */
    }
  }
}

/** Per-set mirror — survives quizSets[] LWW / localStorage quota failures. */
export async function fetchQuizSetsByIdCloud(uid: string): Promise<QuizSet[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/quizSetsById`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, QuizSet>)
      .filter((s) => s && typeof s === 'object' && s.id != null)
      .map((set) => ({ ...set, items: set.items ?? [] }));
  } catch {
    return [];
  }
}

/** Per-folder mirror — same durability pattern as quizSetsById. */
export async function fetchQuizFoldersByIdCloud(uid: string): Promise<QuizFolder[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/quizFoldersById`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, QuizFolder>).filter(
      (f) => f && typeof f === 'object' && f.id != null,
    );
  } catch {
    return [];
  }
}

/**
 * Fold durable quiz items into quizzes / quizSets.
 * - Trashed durable items always win (instant cross-device delete).
 * - Live durable items update ANY set row with the same id when newer
 *   (setId is a hint for adds only — live typing must still land).
 */
export function applyDurableQuizItems(
  quizzes: QuizItem[],
  sets: import('../types').QuizSet[],
  durable: StoredQuizItem[],
): { quizzes: QuizItem[]; sets: import('../types').QuizSet[] } {
  if (!durable.length) return { quizzes, sets };
  let nextQuizzes = quizzes;
  let nextSets = sets;

  for (const item of durable) {
    const { setId, ...quiz } = item;
    const bare: QuizItem = quiz;

    if (bare.trashed) {
      nextQuizzes = nextQuizzes.some((q) => q.id === bare.id)
        ? nextQuizzes.map((q) => (q.id === bare.id ? { ...q, ...bare } : q))
        : [...nextQuizzes, bare];
      nextSets = nextSets.map((set) => {
        if (setId && set.id !== setId && !set.items.some((i) => i.id === bare.id)) return set;
        if (!set.items.some((i) => i.id === bare.id)) {
          if (setId && set.id === setId) {
            return { ...set, items: [...set.items, bare] };
          }
          return set;
        }
        return {
          ...set,
          items: set.items.map((i) => (i.id === bare.id ? { ...i, ...bare } : i)),
        };
      });
      continue;
    }

    let matchedInSet = false;
    nextSets = nextSets.map((set) => {
      const existing = set.items.find((i) => i.id === bare.id);
      if (existing) {
        matchedInSet = true;
        // Soft-delete always wins over a live durable copy. Restore writes
        // trashed:false locally first and clears the tombstone.
        if (existing.trashed && !bare.trashed) return set;
        if (existing.trashed && syncTime(existing) > syncTime(bare)) return set;
        if (syncTime(existing) > syncTime(bare)) return set;
        // Prefer incoming when timestamps tie but content changed (live typing).
        if (syncTime(existing) === syncTime(bare)
          && existing.question === bare.question
          && existing.answer === bare.answer
          && existing.explanation === bare.explanation) {
          return set;
        }
        return {
          ...set,
          items: set.items.map((i) => (i.id === bare.id ? bare : i)),
        };
      }
      if (setId && set.id === setId) {
        // Keep-more-data: a newer set shell (rename / partial array) must never
        // block re-attaching a live durable item that is missing from items[].
        matchedInSet = true;
        return { ...set, items: [...set.items, bare] };
      }
      return set;
    });

    if (!matchedInSet) {
      const existing = nextQuizzes.find((q) => q.id === bare.id);
      if (existing) {
        if (existing.trashed && !bare.trashed) continue;
        if (existing.trashed && syncTime(existing) > syncTime(bare)) continue;
        if (syncTime(existing) > syncTime(bare)) continue;
        nextQuizzes = nextQuizzes.map((q) => (q.id === bare.id ? bare : q));
      } else if (!setId) {
        nextQuizzes = [...nextQuizzes, bare];
      }
    } else {
      // Keep top-level quizzes list in sync when the same id exists there.
      const existing = nextQuizzes.find((q) => q.id === bare.id);
      if (existing?.trashed && !bare.trashed) {
        /* keep trash */
      } else if (existing && syncTime(bare) >= syncTime(existing)) {
        nextQuizzes = nextQuizzes.map((q) => (q.id === bare.id ? bare : q));
      }
    }
  }
  // IDB/cloud item bodies arrive in store / Object.values order. Re-apply any
  // durable Manual itemsOrder stamped on the set shell so refresh cannot scramble.
  nextSets = nextSets.map((set) => {
    if (!set.itemsOrder?.length || !(set.items ?? []).length) return set;
    const ordered = applyQuizItemsOrder(set.items ?? [], set.itemsOrder);
    if (ordered === set.items) return set;
    return { ...set, items: ordered };
  });
  return { quizzes: nextQuizzes, sets: nextSets };
}
