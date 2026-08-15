import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref as dbRef, remove, set, update } from 'firebase/database';
import type { Note, QuizItem, QuizSet, QuizFolder, ChatConversation } from '../types';
import { database, FB_DB_URL } from '../lib/firebase';
import { buildFullBackupPayload, shouldRunHourlyFolderBackup, writeBackupToFolder } from '../lib/externalBackup';
import { setTokenSink } from '../lib/gemini';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { quizPatchChangesContent, quizzesEqualForUI, quizSetsEqualForUI } from '../lib/quizContent';
import {
  clearQuizCompleteCache,
  persistQuizCompleteCache,
  pickBootQuizLists,
  quizSetsHaveCompleteBodies,
  readQuizCompleteCache,
  readQuizCompleteCacheIdb,
  shouldApplyBackgroundQuizUpdate,
  QUIZ_COMPLETE_CACHE_LS_KEY,
} from '../lib/quizCompleteCache';
import {
  adoptByIdMembershipWhenRicher,
  applyQuizItemTrashTombstones,
  applyQuizItemTrashTombstonesToSets,
  applySetTrashTombstones,
  bumpMaxKnownLiveBySet,
  countLiveItemsInSet,
  countLiveQuizItems,
  decideQuizListsUiPaint,
  enforceMaxKnownLiveMembership,
  isQuizSetsLocalWriteSafe,
  mergeQuizItemsUnion,
  overlayQuizTrashFlags,
  pickBetterQuizSet as pickBetterQuizSetCore,
  pickBetterQuizSetsListOrder,
  pickNewerQuizItem as pickNewerQuizItemCore,
  preferRicherQuizSetsMembership,
  applyQuizSetsListOrder,
  quizItemSyncTime,
  quizSetsListOrderIds,
  normalizeQuizSetsListOrder,
  coerceQuizItems,
  coerceQuizSetsList,
  withCoercedQuizSetItems,
  shouldHydrateQuizSetsUi,
  unionQuizSetsForCommit,
  quizSetsSoftTrashExplainsShrink,
  type QuizSetsListOrder,
} from '../lib/quizSetMerge';
import { getRtdbAuthToken, rtdbFetch } from '../lib/rtdb';
import {
  applyDurableQuizItems,
  fetchNoteByIdCloud,
  fetchNotesByIdCloud,
  fetchNotesByIdKeysCloud,
  fetchQuizFoldersByIdCloud,
  fetchQuizItemsByIdCloud,
  fetchQuizItemByIdCloud,
  fetchQuizSetsByIdCloud,
  getAllNotesLocal,
  getNoteLocal,
  getQuizItemLocal,
  noteHasDisplayableImage,
  putNoteLocal,
  putQuizItemLocal,
  peekPrefetchedNotes,
  prefetchAllNotesLocal,
  getAllQuizItemsLocal,
  getAllQuizSetsLocal,
  mergeByIdNewer,
  persistNoteDurable,
  persistQuizItemDurable,
  persistQuizSetDurable,
  peekQuizCatalog,
  prefetchQuizCatalog,
  writeQuizCatalogCloud,
  removeNoteDurable,
  removeQuizItemDurable,
  removeQuizSetDurable,
  tombstoneNoteDurable,
  tombstoneQuizItemDurable,
  type StoredQuizItem,
} from '../lib/itemsStore';
import { onEditorImageSwap, pendingEditorUploads, clearPendingEditorUploads, uploadEditorImage } from '../lib/imageUpload';
import {
  applyRecentEditsToData,
  loadRecentEdits,
  recordRecentEdit,
} from '../lib/recentEdits';
import { extractPlainText, hasRichContent } from '../lib/richContent';
import { sortNotesByCreatedDesc } from '../lib/noteSort';
import { safeLocalStorageSet } from '../lib/safeStorage';
import {
  clearNotesBootCache,
  clearNotesListCache,
  compactNotesForListCache,
  peekServerNotesCatalog,
  readNotesBootCache,
  readNotesListCache,
  purgeNotesFromListCache,
  rememberNotesBootCache,
  rememberServerNotesCatalog,
  writeNotesListCache,
  NOTES_LIST_CACHE_KEY,
} from '../lib/notesListCache';
import {
  honorQuizListsWithTrashTombstones,
  mergeTombstoneMaps,
  normalizeTombstoneMap,
  pruneQuizListsAgainstTrashState,
  readQuizTrashTombstonesIdb,
  readTrashEmptiedAt,
  readTrashTombstones,
  readSidebarCounts,
  writeSidebarCounts,
  writeTinyDurableValue,
  writeTrashEmptiedAt,
  writeTrashTombstones,
  PERM_DELETED_KEY,
  NOTE_TRASH_TOMBSTONE_KEY,
  QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
  QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
  QUIZ_SET_TRASH_TOMBSTONE_KEY,
  SIDEBAR_COUNTS_KEY,
  TRASH_EMPTIED_AT_KEY,
  type SidebarCounts,
  type TrashTombstones,
} from '../lib/quizTrashTombstones';

/**
 * localStorage can throw (QuotaExceededError) when quiz answers embed large
 * base64 images. If that exception escapes an unwrapped setItem call, it can
 * abort the rest of the caller (e.g. addItemToSet) — including the Firebase
 * cloud write — so a newly-saved question would show in the UI but vanish on
 * refresh because it was never persisted anywhere durable. Always go through
 * this helper so a storage failure never blocks cloud sync.
 */
function safeSetItem(key: string, value: string) {
  // Prunes disposable multi-MB caches on QuotaExceeded so tiny writes never
  // throw and white-screen Quiz (Restored/Favourites selection save).
  safeLocalStorageSet(key, value);
}

export interface Draft {
  id: string;
  title: string;
  html: string;
  /** Local edit timestamp — used to prefer fresher draft during cloud merge. */
  updatedAt?: number;
}

type CloudStatus = 'idle' | 'saving' | 'saved' | 'error';

type PersistSnapshot = {
  notes?: Note[];
  drafts?: Draft[];
  quizzes?: QuizItem[];
  chats?: ChatConversation[];
  quizSets?: QuizSet[];
  quizFolders?: QuizFolder[];
};

async function withAuth(url: string, getToken: () => Promise<string | null>): Promise<string> {
  try {
    const token = await getToken();
    if (token) return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
  } catch { /* ignore */ }
  const fallback = await getRtdbAuthToken();
  if (fallback) return `${url}${url.includes('?') ? '&' : '?'}auth=${encodeURIComponent(fallback)}`;
  return url;
}

function noteSyncKey(note: Note) {
  return `${note.title}\0${note.html}\0${note.read}\0${note.fav}\0${note.archived}\0${note.trashed}`;
}

/** Cheap notes[] equality — never JSON.stringify / full-HTML compare multi-MB notes. */
function notesMetaEqual(a: Note[], b: Note[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const bById = new Map<number, Note>();
  for (const note of b) {
    const id = Number(note.id);
    if (Number.isFinite(id)) bById.set(id, note);
  }
  if (bById.size !== a.length) return false;
  for (const left of a) {
    const id = Number(left.id);
    const right = bById.get(id);
    if (!right) return false;
    if ((left.savedAt || '') !== (right.savedAt || '')) return false;
    if (!!left.trashed !== !!right.trashed) return false;
    if (!!left.read !== !!right.read) return false;
    if (!!left.fav !== !!right.fav) return false;
    if (!!left.archived !== !!right.archived) return false;
    if ((left.title || '') !== (right.title || '')) return false;
    // Length proxy — avoid scanning multi-MB base64 HTML on every ById flush.
    if ((left.html || '').length !== (right.html || '').length) return false;
  }
  return true;
}

function notesIdSetEqual(a: Note[], b: Note[]): boolean {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((n) => Number(n.id)));
  for (const note of b) {
    if (!ids.has(Number(note.id))) return false;
  }
  return true;
}

/** Trash/read/fav/archive must still paint even when the id set is unchanged. */
function notesFlagsEqual(a: Note[], b: Note[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const bById = new Map<number, Note>();
  for (const note of b) {
    const id = Number(note.id);
    if (Number.isFinite(id)) bById.set(id, note);
  }
  if (bById.size !== a.length) return false;
  for (const left of a) {
    const right = bById.get(Number(left.id));
    if (!right) return false;
    if (!!left.trashed !== !!right.trashed) return false;
    if (!!left.read !== !!right.read) return false;
    if (!!left.fav !== !!right.fav) return false;
    if (!!left.archived !== !!right.archived) return false;
  }
  return true;
}

/** True when incoming notes have images/bodies the current list is missing. */
function notesBodiesRicher(incoming: Note[], current: Note[]): boolean {
  if (!current.length && incoming.length) return true;
  const cur = new Map(current.map((n) => [Number(n.id), n]));
  for (const note of incoming) {
    const prev = cur.get(Number(note.id));
    if (!prev) return true;
    if (noteContentLength(note) > noteContentLength(prev)) return true;
  }
  return incoming.length > current.length;
}

function mergeNotesPreferRicher(...lists: Note[][]): Note[] {
  const map = new Map<number, Note>();
  for (const list of lists) {
    for (const note of list) {
      if (!note || note.id == null) continue;
      const id = Number(note.id);
      if (!Number.isFinite(id)) continue;
      const normalized = id === note.id ? note : { ...note, id };
      const existing = map.get(id);
      map.set(id, existing ? pickBetterNote(existing, normalized) : normalized);
    }
  }
  return [...map.values()];
}

function quizSyncTime(item: QuizItem) {
  return quizItemSyncTime(item);
}

function pickNewerQuizItem(a: QuizItem, b: QuizItem) {
  return pickNewerQuizItemCore(a, b);
}

function noteContentLength(note: Note) {
  // Count images — stripping tags alone treats image-only notes as empty and
  // lets a shorter/empty remote copy win the merge after a failed cloud write.
  const text = (note.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length;
  const images = ((note.html || '').match(/<img\b/gi) || []).length * 50_000;
  return text + images + (note.title || '').trim().length;
}

interface PermanentlyDeletedIds {
  notes: number[];
  quizzes: number[];
  quizSets: string[];
  quizFolders: string[];
}

function emptyPermDeleted(): PermanentlyDeletedIds {
  return { notes: [], quizzes: [], quizSets: [], quizFolders: [] };
}

function readPermDeleted(): PermanentlyDeletedIds {
  try {
    const raw = localStorage.getItem(PERM_DELETED_KEY);
    if (!raw) return emptyPermDeleted();
    const parsed = JSON.parse(raw) as Partial<PermanentlyDeletedIds>;
    return {
      notes: Array.isArray(parsed.notes) ? [...new Set(parsed.notes.map(Number).filter(Number.isFinite))] : [],
      quizzes: Array.isArray(parsed.quizzes) ? [...new Set(parsed.quizzes.map(Number).filter(Number.isFinite))] : [],
      quizSets: Array.isArray(parsed.quizSets) ? [...new Set(parsed.quizSets.map(String))] : [],
      quizFolders: Array.isArray(parsed.quizFolders) ? [...new Set(parsed.quizFolders.map(String))] : [],
    };
  } catch {
    return emptyPermDeleted();
  }
}

function writePermDeleted(ids: PermanentlyDeletedIds) {
  writeTinyDurableValue(PERM_DELETED_KEY, JSON.stringify(ids));
}

function parseCloudPermDeleted(cloud: Record<string, unknown> | null | undefined): PermanentlyDeletedIds {
  return parsePermDeletedVal(cloud?.permanentlyDeletedIds);
}

/** Firebase may return dense arrays as Array or as `{0: id, 1: id}` objects. */
function cloudIdList(val: unknown): unknown[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter((v) => v != null && v !== false);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    const keys = Object.keys(obj);
    const mapStyle = keys.length > 0 && keys.every((k) => obj[k] === true || obj[k] === 1);
    if (mapStyle) return keys;
    return Object.values(obj).filter((v) => v != null && v !== false);
  }
  return [];
}

function parsePermDeletedVal(val: unknown): PermanentlyDeletedIds {
  if (!val || typeof val !== 'object') return emptyPermDeleted();
  const raw = val as Record<string, unknown>;
  return {
    notes: [...new Set(cloudIdList(raw.notes).map(Number).filter(Number.isFinite))],
    quizzes: [...new Set(cloudIdList(raw.quizzes).map(Number).filter(Number.isFinite))],
    quizSets: [...new Set(cloudIdList(raw.quizSets).map(String).filter(Boolean))],
    quizFolders: [...new Set(cloudIdList(raw.quizFolders).map(String).filter(Boolean))],
  };
}

function mergePermDeleted(local: PermanentlyDeletedIds, cloud: Record<string, unknown> | null | undefined): PermanentlyDeletedIds {
  const remote = parseCloudPermDeleted(cloud);
  const merged: PermanentlyDeletedIds = {
    notes: [...new Set([...local.notes, ...remote.notes])],
    quizzes: [...new Set([...local.quizzes, ...remote.quizzes])],
    quizSets: [...new Set([...local.quizSets, ...remote.quizSets])],
    quizFolders: [...new Set([...local.quizFolders, ...remote.quizFolders])],
  };
  writePermDeleted(merged);
  return merged;
}

function permDeletedToMap(ids: Array<string | number>): Record<string, true> {
  const map: Record<string, true> = {};
  for (const id of ids) {
    if (id == null || id === '') continue;
    map[String(id)] = true;
  }
  return map;
}

async function appendPermDeletedCloud(uid: string, local: PermanentlyDeletedIds): Promise<PermanentlyDeletedIds> {
  let remote = emptyPermDeleted();
  let gotRemote = false;
  try {
    const res = await rtdbFetch(`/users/${uid}/permanentlyDeletedIds`);
    if (res.ok) {
      remote = parsePermDeletedVal(await res.json());
      gotRemote = true;
    }
  } catch { /* keep local */ }
  const merged = addPermDeleted(local, remote);
  const patch: Record<string, unknown> = { cloudSyncAt: Date.now() };
  if (gotRemote) {
    patch.permanentlyDeletedIds = {
      notes: permDeletedToMap(merged.notes),
      quizzes: permDeletedToMap(merged.quizzes),
      quizSets: permDeletedToMap(merged.quizSets),
      quizFolders: permDeletedToMap(merged.quizFolders),
    };
  } else {
    if (local.notes.length) patch['permanentlyDeletedIds/notes'] = permDeletedToMap(local.notes);
    if (local.quizzes.length) patch['permanentlyDeletedIds/quizzes'] = permDeletedToMap(local.quizzes);
    if (local.quizSets.length) patch['permanentlyDeletedIds/quizSets'] = permDeletedToMap(local.quizSets);
    if (local.quizFolders.length) patch['permanentlyDeletedIds/quizFolders'] = permDeletedToMap(local.quizFolders);
  }
  await update(dbRef(database, `users/${uid}`), patch);
  return merged;
}

function addPermDeleted(local: PermanentlyDeletedIds, patch: Partial<PermanentlyDeletedIds>): PermanentlyDeletedIds {
  return {
    notes: [...new Set([...local.notes, ...(patch.notes ?? [])])],
    quizzes: [...new Set([...local.quizzes, ...(patch.quizzes ?? [])])],
    quizSets: [...new Set([...local.quizSets, ...(patch.quizSets ?? [])])],
    quizFolders: [...new Set([...local.quizFolders, ...(patch.quizFolders ?? [])])],
  };
}

function stripPermDeletedQuizzes(quizzes: QuizItem[], tombstones: PermanentlyDeletedIds): QuizItem[] {
  if (!tombstones.quizzes.length) return quizzes;
  const dead = new Set(tombstones.quizzes.map(Number).filter(Number.isFinite));
  if (!dead.size) return quizzes;
  let changed = false;
  const next = quizzes.filter((q) => {
    if (!dead.has(Number(q.id))) return true;
    changed = true;
    return false;
  });
  return changed ? next : quizzes;
}

function stripPermDeletedQuizSets(sets: QuizSet[], tombstones: PermanentlyDeletedIds): QuizSet[] {
  const deadSets = new Set(tombstones.quizSets.map(String));
  const deadQuizzes = new Set(tombstones.quizzes.map(Number).filter(Number.isFinite));
  // Hot path: most saves/syncs have no permanent-delete tombstones. Cloning every
  // set/items[] here used to freeze the UI for tens of seconds after Trash X.
  if (!deadSets.size && !deadQuizzes.size) return sets;
  let changed = false;
  const next: QuizSet[] = [];
  for (const set of sets) {
    if (deadSets.has(String(set.id))) {
      changed = true;
      continue;
    }
    if (!deadQuizzes.size) {
      next.push(set);
      continue;
    }
    const items = set.items ?? [];
    if (!Array.isArray(items)) {
      changed = true;
      next.push({
        ...set,
        items: Object.values(items as Record<string, QuizItem>).filter(Boolean)
          .filter((item) => !deadQuizzes.has(Number(item.id))),
      });
      continue;
    }
    if (!items.some((item) => deadQuizzes.has(Number(item.id)))) {
      next.push(set);
      continue;
    }
    changed = true;
    next.push({
      ...set,
      items: items.filter((item) => !deadQuizzes.has(Number(item.id))),
    });
  }
  return changed ? next : sets;
}

function entitySyncTime(item: { updatedAt?: string; createdAt?: string; savedAt?: string }) {
  return Date.parse(item.updatedAt || item.savedAt || item.createdAt || '') || 0;
}

/**
 * id -> soft-delete timestamp (ms). A durable proof that a set/folder/item was
 * trashed, independent of the (much larger, more failure-prone) array/ById
 * writes. Without this, a soft-delete that raced a partial cloud write could
 * lose its `trashed` flag on refresh even though the UI briefly showed
 * "Saved" — the tombstone always wins over a stale live copy until an
 * explicit restore/permanent-delete clears it.
 */

function markTrashTombstone(key: string, tombstones: TrashTombstones, id: string, at = Date.now()): TrashTombstones {
  const next = { ...tombstones, [id]: at };
  writeTrashTombstones(key, next);
  return next;
}

function clearTrashTombstone(key: string, tombstones: TrashTombstones, id: string): TrashTombstones {
  if (!(id in tombstones)) return tombstones;
  const next = { ...tombstones };
  delete next[id];
  writeTrashTombstones(key, next);
  return next;
}

/** Union local + cloud tombstones (newest timestamp per id wins) and persist locally. */
function mergeTrashTombstones(key: string, local: TrashTombstones, cloud: TrashTombstones): TrashTombstones {
  if (!Object.keys(cloud).length) return local;
  const merged: TrashTombstones = { ...local };
  for (const [id, at] of Object.entries(cloud)) {
    merged[id] = Math.max(merged[id] ?? 0, at);
  }
  writeTrashTombstones(key, merged);
  return merged;
}

async function fetchCloudTrashTombstones(uid: string): Promise<{
  sets: TrashTombstones;
  folders: TrashTombstones;
  items: TrashTombstones;
  notes: TrashTombstones;
}> {
  try {
    const [setsRes, foldersRes, itemsRes, notesRes] = await Promise.all([
      rtdbFetch(`/users/${uid}/quizTrash/sets`),
      rtdbFetch(`/users/${uid}/quizTrash/folders`),
      rtdbFetch(`/users/${uid}/quizTrash/items`),
      rtdbFetch(`/users/${uid}/quizTrash/notes`),
    ]);
    const sets = setsRes.ok ? normalizeTombstoneMap(await setsRes.json()) : {};
    const folders = foldersRes.ok ? normalizeTombstoneMap(await foldersRes.json()) : {};
    const items = itemsRes.ok ? normalizeTombstoneMap(await itemsRes.json()) : {};
    const notes = notesRes.ok ? normalizeTombstoneMap(await notesRes.json()) : {};
    return { sets, folders, items, notes };
  } catch {
    return { sets: {}, folders: {}, items: {}, notes: {} };
  }
}

function pushTrashTombstoneCloud(uid: string, path: 'sets' | 'folders' | 'items' | 'notes', id: string, at: number) {
  // Other devices apply the delete from this node, so a dropped SDK write here
  // would leave them showing the set until the (much larger) array/ById write
  // lands — retry over REST just like the ById mirrors do.
  void set(dbRef(database, `users/${uid}/quizTrash/${path}/${id}`), at).catch(() => (
    rtdbFetch(`/users/${uid}/quizTrash/${path}/${id}`, {
      method: 'PUT',
      body: JSON.stringify(at),
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {})
  ));
}

function clearTrashTombstoneCloud(uid: string, path: 'sets' | 'folders' | 'items' | 'notes', id: string) {
  void remove(dbRef(database, `users/${uid}/quizTrash/${path}/${id}`)).catch(() => {});
}

/**
 * Force `trashed: true` back onto any row whose tombstone timestamp is at
 * least as new as its own updatedAt. Called around boot merges AND around every
 * live remote merge so an incomplete/stale live copy pulled from the cloud
 * array can never resurrect a soft-delete that already has a durable tombstone.
 * `deletedAt` is only stamped when the row has none (Trash card label).
 * Empty-Trash watermark wins over soft tombstones for rows deleted at-or-before it.
 */
function applyTrashTombstones<T extends { id: string | number; trashed?: boolean; deletedAt?: string; updatedAt?: string; createdAt?: string }>(
  items: T[],
  tombstones: TrashTombstones,
  deletedAt?: string,
): T[] {
  if (!Object.keys(tombstones).length) return items;
  const emptiedAt = readTrashEmptiedAt();
  let changed = false;
  const next = items.map((item) => {
    const at = tombstones[String(item.id)];
    if (at === undefined || item.trashed) return item;
    if (emptiedAt && at <= emptiedAt) return item;
    // Durable quizTrash marker wins over a newer live last-good/ById echo.
    // Restore clears the tombstone before flipping trashed:false.
    changed = true;
    if (item.deletedAt || !deletedAt) return { ...item, trashed: true };
    return { ...item, trashed: true, deletedAt };
  });
  return changed ? next : items;
}

function noteContentKey(note: Note) {
  return `${note.title}\0${note.html}`;
}

/** Cloud note HTML is the shared source. Local shells must not hide photos. */
function adoptCloudNoteBodies(
  current: Note[],
  cloud: Note[],
  applyFlags = true,
  skipAddIds?: Set<number>,
): Note[] {
  const byId = new Map(current.map((n) => [Number(n.id), n]));
  for (const incoming of cloud) {
    const id = Number(incoming.id);
    if (!Number.isFinite(id)) continue;
    if (skipAddIds?.has(id)) continue;
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, incoming);
      continue;
    }
    const cloudImg = noteHasDisplayableImage(incoming.html);
    const localImg = noteHasDisplayableImage(cur.html);
    let next = cur;
    if (cloudImg && !localImg) {
      next = { ...next, html: incoming.html, text: incoming.text || next.text };
    } else if (!localImg && (incoming.html || '').length > (cur.html || '').length) {
      next = { ...next, html: incoming.html, text: incoming.text || next.text };
    }
    // notesById is the shared row — read/archive/fav/trash must match on every device.
    if (
      applyFlags
      && (
        !!incoming.archived !== !!next.archived
        || !!incoming.read !== !!next.read
        || !!incoming.fav !== !!next.fav
        || !!incoming.trashed !== !!next.trashed
      )
    ) {
      const incomingAt = Date.parse(incoming.savedAt || '') || 0;
      const curAt = Date.parse(next.savedAt || '') || 0;
      // A stale live copy on the other phone must not undelete a newer trash.
      const trashed = next.trashed && !incoming.trashed && incomingAt <= curAt
        ? true
        : !!incoming.trashed;
      next = {
        ...next,
        archived: !!incoming.archived,
        read: !!incoming.read,
        fav: !!incoming.fav,
        trashed,
        deletedAt: trashed ? (next.deletedAt || incoming.deletedAt) : incoming.deletedAt,
      };
    }
    if (next !== cur) byId.set(id, next);
  }
  return [...byId.values()];
}

function pickBetterNote(local: Note, remote: Note) {
  if (noteSyncKey(local) === noteSyncKey(remote)) return local;
  if (local.trashed !== remote.trashed) return remote.trashed ? remote : local;
  const localAt = entitySyncTime(local);
  const remoteAt = entitySyncTime(remote);
  // A newer text-only shell (hospital PC) must never beat an older copy that
  // still has the photos — that is exactly the laptop-vs-hospital mismatch.
  const localImg = noteHasDisplayableImage(local.html);
  const remoteImg = noteHasDisplayableImage(remote.html);
  if (localImg !== remoteImg) {
    const photos = localImg ? local : remote;
    const meta = localImg ? remote : local;
    if (entitySyncTime(meta) <= entitySyncTime(photos)) return photos;
    return {
      ...photos,
      read: meta.read,
      fav: meta.fav,
      archived: meta.archived,
      trashed: meta.trashed,
      deletedAt: meta.deletedAt,
      lastEdited: meta.lastEdited || photos.lastEdited,
      savedAt: meta.savedAt || photos.savedAt,
      title: meta.title || photos.title,
    };
  }
  // Same body, different meta (read/fav/archived): newer savedAt wins. On a
  // tie prefer local so a just-toggled read isn't overwritten by a stale
  // cloud echo that still has the old flag and the same timestamp.
  if (noteContentKey(local) === noteContentKey(remote)) {
    if (remoteAt !== localAt) return remoteAt > localAt ? remote : local;
    return local;
  }
  const localLen = noteContentLength(local);
  const remoteLen = noteContentLength(remote);
  if (remoteLen !== localLen) return remoteLen > localLen ? remote : local;
  if (remoteAt !== localAt) return remoteAt > localAt ? remote : local;
  return local;
}

function draftContentLength(d: Draft) {
  return (d.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length + (d.title || '').trim().length;
}

function pickBetterDraft(local: Draft, remote: Draft) {
  const localKey = `${local.title}\0${local.html}`;
  const remoteKey = `${remote.title}\0${remote.html}`;
  if (localKey === remoteKey) return local;
  const localLen = draftContentLength(local);
  const remoteLen = draftContentLength(remote);
  if (remoteLen !== localLen) return remoteLen > localLen ? remote : local;
  const localAt = local.updatedAt ?? 0;
  const remoteAt = remote.updatedAt ?? 0;
  if (remoteAt !== localAt) return remoteAt > localAt ? remote : local;
  return local;
}

function stampDraft(draft: Draft, at = Date.now()): Draft {
  return { ...draft, updatedAt: draft.updatedAt ?? at };
}

function stampDrafts(drafts: Draft[]): Draft[] {
  return drafts.map((d) => stampDraft(d));
}

function mergeDraftsForSync(local: Draft[], remote: Draft[]) {
  const map = new Map<string, Draft>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickBetterDraft(existing, item) : item);
  }
  return [...map.values()];
}

function parseCloudDeletedDraftIds(cloud: Record<string, unknown> | null): string[] {
  return firebaseToArray<string>(
    cloud?.deletedDraftIds as string[] | Record<string, string> | null | undefined,
  ).map(String).filter(Boolean);
}

function mergeDeletedDraftIds(local: Set<string>, cloud: Record<string, unknown> | null): Set<string> {
  const merged = new Set([...local, ...parseCloudDeletedDraftIds(cloud)]);
  writeDeletedDraftIds(merged);
  return merged;
}

/** Merge drafts on pull/load — respect cloud membership so deletes on other devices stick. */
function mergeDraftsForPull(
  local: Draft[],
  remote: Draft[],
  cloud: Record<string, unknown> | null,
  deletedIds: Set<string>,
  protectLocalIds: Set<string> = new Set(),
): Draft[] {
  const cloudDraftIds = firebaseToArray<string>(
    cloud?.drafts as string[] | Record<string, string> | null | undefined,
  ).map(String).filter(Boolean);
  const cloudHasMembership = !!cloud && 'drafts' in cloud;
  const cloudSyncAt = typeof cloud?.cloudSyncAt === 'number' ? cloud.cloudSyncAt : 0;

  const map = new Map<string, Draft>();
  for (const item of remote) {
    if (deletedIds.has(item.id)) continue;
    map.set(item.id, item);
  }
  for (const item of local) {
    if (deletedIds.has(item.id)) continue;
    const existing = map.get(item.id);
    if (existing) {
      map.set(item.id, pickBetterDraft(item, existing));
      continue;
    }
    if (protectLocalIds.has(item.id)) {
      map.set(item.id, item);
      continue;
    }
    if (cloudHasMembership && cloudDraftIds.length > 0 && !cloudDraftIds.includes(item.id)) {
      // Removed on another device — keep only if edited locally after last cloud sync.
      if (!item.updatedAt || item.updatedAt < cloudSyncAt) continue;
    }
    map.set(item.id, item);
  }

  if (remote.length) {
    const remoteIdSet = new Set(remote.map((d) => d.id));
    const ordered: Draft[] = remote.filter((d) => map.has(d.id)).map((d) => map.get(d.id)!);
    for (const d of map.values()) {
      if (!remoteIdSet.has(d.id)) ordered.push(d);
    }
    return ordered;
  }
  return [...map.values()];
}

/** notesById / IndexedDB must honor permanent-delete tombstones or trash X
 *  resurrects image notes on every refresh. */
function stripPermDeletedNotes(notes: Note[], tombstones: PermanentlyDeletedIds = readPermDeleted()): Note[] {
  if (!tombstones.notes.length) return notes;
  const dead = new Set(tombstones.notes.map(Number).filter(Number.isFinite));
  if (!dead.size) return notes;
  let changed = false;
  const next = notes.filter((n) => {
    if (!dead.has(Number(n.id))) return true;
    changed = true;
    return false;
  });
  return changed ? next : notes;
}

const NOTE_REJECT_TTL_MS = 10 * 60_000;

function pruneRejectedNoteIds(rejected: Map<number, number>, now = Date.now()): Set<number> {
  const live = new Set<number>();
  for (const [id, at] of rejected) {
    if (now - at > NOTE_REJECT_TTL_MS) rejected.delete(id);
    else live.add(id);
  }
  return live;
}

function blockedNoteIdSet(
  tombs: PermanentlyDeletedIds,
  rejected: Map<number, number>,
): Set<number> {
  const dead = new Set(tombs.notes.map(Number).filter(Number.isFinite));
  for (const id of pruneRejectedNoteIds(rejected)) dead.add(id);
  return dead;
}

function filterBlockedNotes(
  incoming: Note[],
  tombs: PermanentlyDeletedIds,
  rejected: Map<number, number>,
): Note[] {
  const dead = blockedNoteIdSet(tombs, rejected);
  if (!dead.size) return incoming;
  return incoming.filter((n) => !dead.has(Number(n.id)));
}

function mergeNotesForSync(local: Note[], remote: Note[], tombstones: PermanentlyDeletedIds = emptyPermDeleted()) {
  const dead = new Set(tombstones.notes.map(Number).filter(Number.isFinite));
  const remoteIds = new Set(remote.map((item) => Number(item.id)).filter(Number.isFinite));
  const map = new Map<number, Note>();
  for (const item of local) {
    const id = Number(item.id);
    if (!Number.isFinite(id) || dead.has(id)) continue;
    map.set(id, id === item.id ? item : { ...item, id });
  }
  for (const item of remote) {
    const id = Number(item.id);
    if (!Number.isFinite(id) || dead.has(id)) continue;
    const normalized = id === item.id ? item : { ...item, id };
    const existing = map.get(id);
    map.set(id, existing ? pickBetterNote(existing, normalized) : normalized);
  }
  return [...map.values()];
}

function mergeQuizzesForSync(
  local: QuizItem[],
  remote: QuizItem[],
  tombstones: PermanentlyDeletedIds = emptyPermDeleted(),
  orderFrom?: 'local' | 'remote',
) {
  // Notes-style ById union — never drop live items missing from one side.
  return mergeQuizItemsUnion(local, remote, {
    permanentlyDeletedIds: tombstones.quizzes,
    orderFrom,
  });
}

/** Adopt cloud Empty-Trash watermark so every device drops the same ghosts. */
function mergeTrashEmptiedAt(cloud: Record<string, unknown> | null | undefined): number {
  const remote = Number(cloud?.trashEmptiedAt);
  if (Number.isFinite(remote) && remote > 0) writeTrashEmptiedAt(remote);
  return readTrashEmptiedAt();
}

/** Drop soft-delete markers that Empty Trash already finalized. */
function pruneSoftTombstonesAfterEmpty(tombstones: TrashTombstones, key: string, emptiedAt: number): TrashTombstones {
  if (!emptiedAt || !Object.keys(tombstones).length) return tombstones;
  let changed = false;
  const next: TrashTombstones = {};
  for (const [id, at] of Object.entries(tombstones)) {
    if (at > emptiedAt) next[id] = at;
    else changed = true;
  }
  if (!changed) return tombstones;
  writeTrashTombstones(key, next);
  return next;
}

function filterResurrectedTrash<T extends { id: string | number; trashed?: boolean; updatedAt?: string; createdAt?: string; savedAt?: string }>(
  merged: T[],
  _local: T[],
  softTombstones?: TrashTombstones,
): T[] {
  const emptiedAt = readTrashEmptiedAt();
  return merged.filter((item) => {
    if (!item.trashed) return true;
    const softAt = softTombstones?.[String(item.id)];
    // Soft-delete after the last Empty Trash still belongs in Trash.
    if (softAt !== undefined && (!emptiedAt || softAt > emptiedAt)) return true;
    // Empty Trash watermark — drop ghosts deleted at-or-before that moment.
    if (emptiedAt && entitySyncTime(item) <= emptiedAt) return false;
    return true;
  });
}

/** In-set question Manual order stamp — never fall back to updatedAt/createdAt. */
function quizSetOrderTime(set: QuizSet) {
  return Date.parse(set.orderUpdatedAt || '') || 0;
}

/** Set-list Manual order stamp — separate from in-set orderUpdatedAt. */
function quizSetListOrderTime(set: QuizSet) {
  return Date.parse(set.listOrderUpdatedAt || '') || 0;
}

function quizFolderOrderTime(folder: QuizFolder) {
  return Date.parse(folder.orderUpdatedAt || '') || 0;
}

/**
 * Reorder drag→target in the SET LIST. When both rows share a folder (or are
 * both ungrouped), reorder only inside that group so other folders stay put.
 * Stamps listOrderUpdatedAt on every non-system set so this list order wins
 * merge against unrelated in-set orderUpdatedAt bumps.
 */
function reorderQuizSetsList(sets: QuizSet[], dragId: string, targetId: string, stamp: string): QuizSet[] | null {
  const drag = sets.find((s) => s.id === dragId);
  const target = sets.find((s) => s.id === targetId);
  if (!drag || !target || dragId === targetId) return null;
  if (drag.system || target.system) return null;

  const dragKey = drag.folderId || null;
  const targetKey = target.folderId || null;
  let next: QuizSet[];

  if (dragKey === targetKey) {
    const inGroup = (s: QuizSet) => {
      if (s.system || s.trashed) return false;
      return dragKey ? s.folderId === dragKey : !s.folderId;
    };
    const group = sets.filter(inGroup);
    const from = group.findIndex((s) => s.id === dragId);
    const to = group.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0 || from === to) return null;
    const nextGroup = [...group];
    const [item] = nextGroup.splice(from, 1);
    nextGroup.splice(to, 0, item);
    let gi = 0;
    next = sets.map((s) => (inGroup(s) ? nextGroup[gi++] : s));
  } else {
    const from = sets.findIndex((s) => s.id === dragId);
    const to = sets.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0 || from === to) return null;
    next = [...sets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
  }

  // Bump list-order authority on every user set so max(listOrderUpdatedAt)
  // reflects this rearrange — not a later question drag inside one set.
  return next.map((s) => (s.system ? s : { ...s, listOrderUpdatedAt: stamp }));
}

function pickBetterQuizSet(
  local: QuizSet,
  remote: QuizSet,
  tombstones: PermanentlyDeletedIds = emptyPermDeleted(),
  softTrashQuizItems?: TrashTombstones,
): QuizSet {
  // Union items by id (notes ById style). A newer parent updatedAt with a
  // shorter/partial items[] must never drop questions — only item tombstones do.
  return pickBetterQuizSetCore(local, remote, {
    quizzes: tombstones.quizzes,
    quizSets: tombstones.quizSets,
    softTrashQuizItems: softTrashQuizItems ? Object.keys(softTrashQuizItems) : undefined,
  });
}

/** Re-stamp soft-deleted questions so richer ById/array shells cannot revive them. */
function honorQuizItemTrashTombstones(
  sets: QuizSet[],
  itemTombstones: TrashTombstones,
  deletedAt?: string,
): QuizSet[] {
  return applyQuizItemTrashTombstonesToSets(sets, itemTombstones, {
    emptiedAt: readTrashEmptiedAt(),
    deletedAt,
  });
}

function honorQuizItemTrashTombstonesOnItems(
  items: QuizItem[],
  itemTombstones: TrashTombstones,
  deletedAt?: string,
): QuizItem[] {
  return applyQuizItemTrashTombstones(items, itemTombstones, {
    emptiedAt: readTrashEmptiedAt(),
    deletedAt,
  });
}

function pickBetterQuizFolder(local: QuizFolder, remote: QuizFolder): QuizFolder {
  if (!!local.trashed !== !!remote.trashed) {
    // Same "soft-delete wins unless strictly newer" rule as pickBetterQuizSet.
    const trashedSide = local.trashed ? local : remote;
    const liveSide = local.trashed ? remote : local;
    return entitySyncTime(liveSide) > entitySyncTime(trashedSide) ? liveSide : trashedSide;
  }
  const localGeneric = isGenericRecoveredFolderName(local.name);
  const remoteGeneric = isGenericRecoveredFolderName(remote.name);
  if (localGeneric !== remoteGeneric) return localGeneric ? remote : local;
  return entitySyncTime(remote) >= entitySyncTime(local) ? remote : local;
}

function foldersToFirebaseMap(folders: QuizFolder[]): Record<string, QuizFolder> {
  const out: Record<string, QuizFolder> = {};
  for (const folder of folders) {
    if (!folder?.id) continue;
    out[folder.id] = JSON.parse(JSON.stringify(folder)) as QuizFolder;
  }
  return out;
}

function setsToFirebaseMap(sets: QuizSet[]): Record<string, QuizSet> {
  const out: Record<string, QuizSet> = {};
  for (const set of sets) {
    if (!set?.id) continue;
    out[set.id] = JSON.parse(JSON.stringify({ ...set, items: set.items ?? [] })) as QuizSet;
  }
  return out;
}

/** Live (non-trashed, non-system) set ids — used to heal incomplete cloud arrays without deleting. */
function liveUserQuizSetIds(sets: QuizSet[]): Set<string> {
  return new Set(sets.filter((set) => set?.id && !set.trashed && !set.system).map((set) => set.id));
}

function quizSetsMissingFromRemote(merged: QuizSet[], remote: QuizSet[]): boolean {
  const remoteLive = liveUserQuizSetIds(remote);
  return [...liveUserQuizSetIds(merged)].some((id) => !remoteLive.has(id));
}

/** True when merged has more live items on any shared set than the remote array. */
function quizSetsRemoteMembershipIncomplete(merged: QuizSet[], remote: QuizSet[]): boolean {
  const remoteById = new Map(remote.map((set) => [set.id, set]));
  for (const set of merged) {
    if (!set?.id || set.trashed || set.system) continue;
    const remoteSet = remoteById.get(set.id);
    if (!remoteSet) continue;
    if (countLiveItemsInSet(set) > countLiveItemsInSet(remoteSet)) return true;
  }
  return false;
}

function chatSyncTime(chat: ChatConversation) {
  const last = chat.messages?.[chat.messages.length - 1]?.timestamp;
  return Date.parse(last || chat.createdAt || '') || 0;
}

function mergeChatsForSync(local: ChatConversation[], remote: ChatConversation[]) {
  const map = new Map<string, ChatConversation>();
  for (const chat of local) map.set(chat.id, chat);
  for (const chat of remote) {
    const existing = map.get(chat.id);
    if (!existing || chatSyncTime(chat) >= chatSyncTime(existing)) map.set(chat.id, chat);
  }
  return [...map.values()];
}

function mergeQuizSetsForSync(
  local: QuizSet[],
  remote: QuizSet[],
  tombstones: PermanentlyDeletedIds = emptyPermDeleted(),
  opts?: { preferLocalOrder?: boolean },
) {
  const dead = new Set(tombstones.quizSets);
  const remoteIds = new Set(remote.map((set) => set.id));
  const emptiedAt = readTrashEmptiedAt();
  const map = new Map<string, QuizSet>();
  for (const set of local) {
    if (dead.has(set.id)) continue;
    // Local-only trashed row omitted from remote: keep only while Empty Trash has
    // not already passed its delete time. Otherwise this is the ghost that used to
    // re-seed quizSetsById on the other device after Empty Trash.
    if (set.trashed && !remoteIds.has(set.id) && emptiedAt && entitySyncTime(set) <= emptiedAt) {
      continue;
    }
    // A local-only trashed set is a pending soft-delete that hasn't reached
    // the remote array yet — dropping it here (instead of keeping it so it
    // can sync) is exactly what let deletes resurrect after a refresh that
    // raced the cloud write. Only an explicit permanent-delete tombstone may
    // remove a row before Empty Trash.
    map.set(set.id, set);
  }
  for (const set of remote) {
    if (dead.has(set.id)) continue;
    if (set.trashed && emptiedAt && entitySyncTime(set) <= emptiedAt) continue;
    const existing = map.get(set.id);
    map.set(set.id, existing ? pickBetterQuizSet(existing, set, tombstones) : set);
  }
  // ById Object.values is membership-only — never let it scramble Manual order.
  // Array↔array merges prefer remote only when listOrderUpdatedAt is strictly
  // newer — never max(orderUpdatedAt), which item drag/reorder also bumps.
  const localMax = Math.max(0, ...local.map((set) => quizSetListOrderTime(set)));
  const remoteMax = Math.max(0, ...remote.map((set) => quizSetListOrderTime(set)));
  const orderSource = opts?.preferLocalOrder
    ? local
    : (remoteMax > localMax ? remote : local);
  const ordered: QuizSet[] = [];
  const seen = new Set<string>();
  for (const set of orderSource) {
    const merged = map.get(set.id);
    if (!merged || seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  // Unknown ids keep Map insertion order: local first, then remote-only — so
  // a brand-new set missing from orderSource lands at the bottom.
  for (const merged of map.values()) {
    if (seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  return stripPermDeletedQuizSets(ordered, tombstones);
}

/** Union ById rows into an ordered array without adopting ById key order. */
function unionQuizSetsFromById(
  base: QuizSet[],
  byId: QuizSet[],
  tombstones: PermanentlyDeletedIds = emptyPermDeleted(),
) {
  if (!byId.length) return base;
  return mergeQuizSetsForSync(base, byId, tombstones, { preferLocalOrder: true });
}

function mergeFoldersForSync(
  local: QuizFolder[],
  remote: QuizFolder[],
  tombstones: PermanentlyDeletedIds = emptyPermDeleted(),
  opts?: { remoteIsAuthority?: boolean },
) {
  const dead = new Set(tombstones.quizFolders);
  const remoteIds = new Set(remote.map((folder) => folder.id));
  const emptiedAt = readTrashEmptiedAt();
  // When cloud ById / array was loaded, membership comes from remote — local-only
  // live folders are ghosts (deleted elsewhere) and must not heal-push back.
  const remoteIsAuthority = opts?.remoteIsAuthority ?? remote.length > 0;
  const map = new Map<string, QuizFolder>();
  for (const folder of local) {
    if (dead.has(folder.id)) continue;
    if (folder.trashed && !remoteIds.has(folder.id) && emptiedAt && entitySyncTime(folder) <= emptiedAt) {
      continue;
    }
    if (remoteIsAuthority && !remoteIds.has(folder.id) && !folder.trashed && !folder.system) {
      continue;
    }
    // Keep local-only trashed folders (pending soft-delete not yet on the
    // remote array) so they persist through sync instead of resurrecting.
    map.set(folder.id, folder);
  }
  for (const folder of remote) {
    if (dead.has(folder.id)) continue;
    if (folder.trashed && emptiedAt && entitySyncTime(folder) <= emptiedAt) continue;
    const existing = map.get(folder.id);
    map.set(folder.id, existing ? pickBetterQuizFolder(existing, folder) : folder);
  }
  const localMax = Math.max(0, ...local.map((folder) => quizFolderOrderTime(folder)));
  const remoteMax = Math.max(0, ...remote.map((folder) => quizFolderOrderTime(folder)));
  const orderSource = remoteMax > localMax ? remote : local;
  const ordered: QuizFolder[] = [];
  const seen = new Set<string>();
  for (const folder of orderSource) {
    const merged = map.get(folder.id);
    if (!merged || seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  for (const merged of map.values()) {
    if (seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  return ordered;
}

export interface RecoverableCloudSummary {
  sources: {
    cloud: { notes: number; quizzes: number; sets: number; folders: number; chats: number };
    dataHistoryBest: { key: string | null; notes: number; quizzes: number; sets: number; folders: number; chats: number };
    drafts: number;
    chatUserMessages: number;
    folderHistoryKeys: number;
    dedicatedSets: number;
    dedicatedFolders: number;
    orphaned: { notes: number; quizzes: number; sets: number };
  };
  totalRecoverable: { notes: number; quizzes: number; sets: number; folders: number; chats: number };
  folderNames: string[];
}

interface NotesCtx {
  notes: Note[];
  drafts: Draft[];
  quizzes: QuizItem[];
  trashedQuizzes: QuizItem[];
  quizSets: QuizSet[];
  quizFolders: QuizFolder[];
  /** Instant sidebar badges — durable last-session truth, never waits on cloud. */
  sidebarCounts: SidebarCounts;
  chats: ChatConversation[];
  saveChats: (chats: ChatConversation[]) => void;
  cloudStatus: CloudStatus;
  cloudSyncedAt: number | null;
  loaded: boolean;
  /**
   * Quiz lists painted from local (LS/IDB) — does NOT wait for cloud (`loaded`).
   * Sidebar set shells use this; question card HTML waits on `quizContentReady`.
   */
  quizLocalReady: boolean;
  /**
   * Question card HTML is safe to paint after the first cloud quizItemsById
   * merge (or a short timeout / same-session boot cache). Prevents old→new FOUC.
   */
  quizContentReady: boolean;
  /** Drafts are usable (read/write/cloud) before the full account load finishes. */
  draftsReady: boolean;
  /** Fetching draft bundle from cloud (other devices). */
  draftsLoading: boolean;
  addQuiz: (item: Omit<QuizItem, 'id'>) => number;
  deleteQuiz: (id: number, fromSetId?: string | null) => void;
  restoreQuiz: (id: number) => void;
  permDeleteQuiz: (id: number) => void;
  updateQuiz: (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud?: boolean) => void;
  addQuizSet: (name: string, folderId?: string) => Promise<QuizSet>;
  deleteQuizSet: (id: string) => void;
  restoreQuizSet: (id: string) => void;
  permDeleteQuizSet: (id: string) => void;
  renameQuizSet: (id: string, name: string) => void;
  reorderQuizSets: (dragId: string, targetId: string) => void;
  setQuizSetColor: (id: string, color: string) => void;
  setQuizSetFolder: (id: string, folderId: string | undefined) => void;
  addQuizFolder: (name: string) => QuizFolder;
  renameQuizFolder: (id: string, name: string) => void;
  reorderQuizFolders: (dragId: string, targetId: string) => void;
  setQuizFolderColor: (id: string, color: string) => void;
  deleteQuizFolder: (id: string) => void;
  restoreQuizFolder: (id: string) => void;
  permDeleteQuizFolder: (id: string) => void;
  recoverQuizFolders: () => Promise<number>;
  listQuizFolderBackups: () => Promise<{ key: string; label: string; folderCount: number }[]>;
  restoreQuizFolderBackup: (key: string) => Promise<number>;
  hasQuizFolderBackups: () => Promise<boolean>;
  listDataBackups: () => Promise<{ key: string; label: string; notes: number; quizzes: number; sets: number; folders: number; chats: number }[]>;
  restoreDataBackup: (key: string) => Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }>;
  hasDataBackups: () => Promise<boolean>;
  scanRecoverableCloud: () => Promise<RecoverableCloudSummary>;
  emergencyRecoverFromCloud: () => Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }>;
  getLocalBackupSummary: () => { notes: number; quizzes: number; sets: number; folders: number; chats: number; hasData: boolean };
  restoreFromLocalBackup: () => Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }>;
  addItemToSet: (setId: string, item: Omit<QuizItem, 'id'>) => number;
  removeItemFromSet: (setId: string, itemId: number) => void;
  updateItemInSet: (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud?: boolean) => void;
  moveItemInSet: (setId: string, itemId: number, direction: 'up' | 'down') => void;
  reorderItemInSet: (setId: string, dragId: number, targetId: number) => void;
  setItemsOrderInSet: (setId: string, itemIds: number[]) => void;
  moveQuiz: (itemId: number, direction: 'up' | 'down') => void;
  reorderQuiz: (dragId: number, targetId: number) => void;
  setQuizzesOrder: (itemIds: number[]) => void;
  addDraft: () => void;
  removeDraft: (id: string) => void;
  updateDraft: (id: string, patch: Partial<Draft>) => void;
  submitDraft: (id: string) => void;
  toggleRead: (id: number) => void;
  toggleUnread: (id: number) => void;
  toggleFav: (id: number) => void;
  archive: (id: number) => void;
  unarchive: (id: number) => void;
  trash: (id: number) => void;
  restore: (id: number) => void;
  permDelete: (id: number) => void;
  emptyTrash: () => void;
  deleteMany: (ids: number[]) => void;
  updateNote: (id: number, patch: Partial<Note>) => void;
  /** Pull one note body from notesById — used when a fresh PC painted an empty shell. */
  hydrateNote: (id: number) => Promise<void>;
  /** Pull missing question bodies for one set — catalog shells show count before HTML lands. */
  hydrateQuizSet: (setId: string) => Promise<void>;
  nowStr: () => string;
}

const NotesContext = createContext<NotesCtx | null>(null);

function firebaseToArray<T>(data: T[] | Record<string, T> | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean);
  if (typeof data === 'object') return Object.values(data).filter(Boolean);
  return [];
}

function normalizeQuizSetRow(set: QuizSet): QuizSet {
  // Prefer coerceQuizItems — preserves array identity when already clean (avoids
  // re-render storms). firebaseToArray always .filter()s and allocates new arrays.
  return withCoercedQuizSetItems({
    ...set,
    items: coerceQuizItems(set.items as QuizItem[] | Record<string, QuizItem> | null | undefined),
  });
}

function normalizeQuizSetsRows(sets: QuizSet[]): QuizSet[] {
  return coerceQuizSetsList(sets.map(normalizeQuizSetRow));
}

function mergeById<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      if (item?.id) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function readLocalJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const LAST_UID_KEY = 'malacadhati_last_uid';
const CLOUD_SYNCED_AT_KEY = 'malacadhati_cloud_synced_at';
const DELETED_DRAFT_IDS_KEY = 'malacadhati_deleted_draft_ids';

const QUIZ_SETS_SHELL_KEY = 'malacadhati_quiz_sets_shells';
const QUIZ_SETS_LIST_ORDER_KEY = 'malacadhati_quiz_sets_list_order';

function readQuizSetsListOrderLocal(): QuizSetsListOrder | null {
  return normalizeQuizSetsListOrder(readLocalJson<QuizSetsListOrder>(QUIZ_SETS_LIST_ORDER_KEY));
}

function writeQuizSetsListOrderLocal(order: QuizSetsListOrder | null): void {
  if (order) {
    try {
      localStorage.setItem(QUIZ_SETS_LIST_ORDER_KEY, JSON.stringify(order));
    } catch { /* quota */ }
    return;
  }
  try {
    localStorage.removeItem(QUIZ_SETS_LIST_ORDER_KEY);
  } catch { /* ignore */ }
}

/** Re-apply durable Egen order — call after every union/ById merge that may scramble ids. */
function applyLocalQuizSetsListOrder(
  sets: QuizSet[],
  order: QuizSetsListOrder | null = readQuizSetsListOrderLocal(),
): QuizSet[] {
  if (!order?.ids?.length) return sets;
  return applyQuizSetsListOrder(sets, order.ids);
}

function buildQuizSetsListOrder(sets: QuizSet[], stamp: string): QuizSetsListOrder | null {
  const ids = quizSetsListOrderIds(sets);
  if (!ids.length || !stamp) return null;
  return { ids, updatedAt: stamp };
}

/**
 * In-memory last-known quiz lists for this JS session (survives React remount,
 * not a full tab reload). Used so refresh/hydration never paints a shorter
 * localStorage shell over a fuller list we already showed.
 */
let quizListsBootCache: { quizzes: QuizItem[]; sets: QuizSet[] } | null = null;

function rememberQuizListsBootCache(quizzes: QuizItem[], sets: QuizSet[], force = false) {
  const prev = quizListsBootCache;
  if (
    !force
    && prev
    && countLiveQuizItems(prev.sets) > countLiveQuizItems(sets)
    && prev.sets.length >= sets.length
    && !quizSetsSoftTrashExplainsShrink(prev.sets, sets)
  ) {
    return;
  }
  quizListsBootCache = { quizzes, sets };
}

/** Keep durable last-good in sync with user edits (delete/order/body). */
function rememberLastGoodComplete(quizzes: QuizItem[], sets: QuizSet[], force = false) {
  rememberQuizListsBootCache(quizzes, sets, force);
  if (quizSetsHaveCompleteBodies(sets)) {
    persistQuizCompleteCache(quizzes, sets, { force });
  } else if (force) {
    clearQuizCompleteCache();
  }
}

const LOCAL_DATA_KEYS = [
  'malacadhati',
  'malacadhati_drafts',
  'malacadhati_quiz',
  'malacadhati_quiz_sets',
  QUIZ_SETS_SHELL_KEY,
  QUIZ_SETS_LIST_ORDER_KEY,
  QUIZ_COMPLETE_CACHE_LS_KEY,
  'malacadhati_quiz_folders',
  'malacadhati_chats',
  QUIZ_SET_TRASH_TOMBSTONE_KEY,
  QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
  QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
  TRASH_EMPTIED_AT_KEY,
  PERM_DELETED_KEY,
  SIDEBAR_COUNTS_KEY,
  NOTES_LIST_CACHE_KEY,
] as const;

/** Tiny membership journal — survives when the full quizSets[] localStorage write hits QuotaExceeded. */
function writeQuizSetsShellJournal(sets: QuizSet[]) {
  const shells = sets.map((set) => {
    const itemsOrder = (set.items ?? []).length
      ? (set.items ?? []).map((item) => item.id)
      : (set.itemsOrder ?? []);
    return {
      ...set,
      items: [] as QuizItem[],
      ...(itemsOrder.length ? { itemsOrder } : {}),
    };
  });
  safeSetItem(QUIZ_SETS_SHELL_KEY, JSON.stringify(shells));
}

function readQuizSetsShellJournal(): QuizSet[] {
  return firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>(QUIZ_SETS_SHELL_KEY) ?? []).map((set) => ({
    ...set,
    items: set.items ?? [],
  }));
}

/** Add shell-only sets that the giant array failed to persist. Never blank existing items. */
function mergeSetsWithShellJournal(sets: QuizSet[]): QuizSet[] {
  const shells = readQuizSetsShellJournal();
  if (!shells.length) return sets;
  const have = new Set(sets.map((s) => s.id));
  const missing = shells.filter((s) => s?.id && !have.has(s.id));
  if (!missing.length) return sets;
  return [...sets, ...missing];
}

/**
 * If the durable Egen id-list is missing, recover it from the shell journal
 * (small, ordered, written on every structure change) — never from ById scramble.
 */
function ensureQuizSetsListOrderFromShells(): QuizSetsListOrder | null {
  const existing = readQuizSetsListOrderLocal();
  if (existing?.ids?.length) return existing;
  const shells = readQuizSetsShellJournal();
  if (!shells.length) return null;
  const stampMs = Math.max(0, ...shells.map((set) => Date.parse(set.listOrderUpdatedAt || '') || 0));
  if (stampMs <= 0) return null;
  const order = buildQuizSetsListOrder(shells, new Date(stampMs).toISOString());
  if (!order) return null;
  writeQuizSetsListOrderLocal(order);
  return order;
}

function insertQuizSetInFolderOrder(sets: QuizSet[], newSet: QuizSet): QuizSet[] {
  if (!newSet.folderId) return [...sets, newSet];
  let insertAt = sets.length;
  for (let i = sets.length - 1; i >= 0; i -= 1) {
    const row = sets[i];
    if (row.system || row.trashed) continue;
    if (row.folderId === newSet.folderId) {
      insertAt = i + 1;
      break;
    }
  }
  return [...sets.slice(0, insertAt), newSet, ...sets.slice(insertAt)];
}

function clearLocalNotesData() {
  for (const key of LOCAL_DATA_KEYS) localStorage.removeItem(key);
  quizListsBootCache = null;
  clearQuizCompleteCache();
  clearNotesListCache();
  clearNotesBootCache();
}

/** Clear cached notes when a different account signs in (keys are not uid-scoped). */
function syncAccountLocalStorage(uid: string) {
  const prev = localStorage.getItem(LAST_UID_KEY);
  if (prev && prev !== uid) clearLocalNotesData();
  safeSetItem(LAST_UID_KEY, uid);
}

function readLocalNotesDataRaw() {
  const sets = mergeSetsWithShellJournal(
    firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>('malacadhati_quiz_sets') ?? []).map((set) => ({
      ...set,
      items: set.items ?? [],
    })),
  );
  return {
    notes: firebaseToArray<Note>(readLocalJson<Note[]>('malacadhati') ?? []),
    drafts: firebaseToArray<Draft>(readLocalJson<Draft[]>('malacadhati_drafts') ?? []),
    quizzes: firebaseToArray<QuizItem>(readLocalJson<QuizItem[]>('malacadhati_quiz') ?? []),
    chats: firebaseToArray<ChatConversation>(readLocalJson<ChatConversation[]>('malacadhati_chats') ?? []).map((c) => ({
      ...c,
      messages: c.messages ?? [],
    })),
    folders: firebaseToArray<QuizFolder>(readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? []),
    sets,
  };
}

/** Sync read used by recovery helpers; journal is applied separately on boot. */
function readLocalNotesData() {
  return applyRecentEditsToData(readLocalNotesDataRaw());
}

/** Sync boot notes for first React paint — sidebar counts + list must not wait on useEffect/IDB. */
function readBootNotesForPaint(): Note[] {
  const emptiedAt = readTrashEmptiedAt();
  const tombstones = readPermDeleted();
  const fromLs = stripPermDeletedNotes(readLocalNotesDataRaw().notes, tombstones);
  const fromListCache = stripPermDeletedNotes(readNotesListCache(), tombstones);
  const fromMemory = stripPermDeletedNotes(readNotesBootCache(), tombstones);
  const fromIdb = stripPermDeletedNotes(peekPrefetchedNotes(), tombstones);
  const fromCatalog = stripPermDeletedNotes(peekServerNotesCatalog(), tombstones);
  // Prefer richer bodies (IDB/memory) over compact list-cache shells when timestamps tie.
  const merged = applyTrashTombstones(
    adoptCloudNoteBodies(
      mergeNotesPreferRicher(fromLs, fromListCache, fromMemory, fromIdb, fromCatalog),
      fromCatalog,
      true,
    ),
    readTrashTombstones(NOTE_TRASH_TOMBSTONE_KEY),
  ).filter((note) => (
    !(note.trashed && emptiedAt && entitySyncTime(note) <= emptiedAt)
  ));
  const sorted = sortNotesByCreatedDesc(merged);
  if (sorted.length) rememberNotesBootCache(sorted);
  return sorted;
}

function computeSidebarCounts(
  notes: Note[],
  quizzes: QuizItem[],
  sets: QuizSet[],
  folders: QuizFolder[],
  tombstones: PermanentlyDeletedIds = readPermDeleted(),
): SidebarCounts {
  const deadNotes = new Set(tombstones.notes.map(Number).filter(Number.isFinite));
  const deadQuizzes = new Set(tombstones.quizzes.map(Number).filter(Number.isFinite));
  const liveNotes = notes.filter((n) => !deadNotes.has(Number(n.id)));
  return {
    home: liveNotes.filter((n) => !n.archived && !n.trashed).length,
    unread: liveNotes.filter((n) => !n.read && !n.archived && !n.trashed).length,
    read: liveNotes.filter((n) => n.read && !n.archived && !n.trashed).length,
    fav: liveNotes.filter((n) => n.fav && !n.trashed).length,
    archive: liveNotes.filter((n) => n.archived && !n.trashed).length,
    trashNotes: liveNotes.filter((n) => n.trashed).length,
    trashQuizzes: quizzes.filter((q) => !!q.trashed && !deadQuizzes.has(Number(q.id))).length,
    trashSets: sets.filter((s) => s.trashed).length,
    trashFolders: folders.filter((f) => f.trashed).length,
  };
}

function readDeletedDraftIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_DRAFT_IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function writeDeletedDraftIds(ids: Set<string>) {
  safeSetItem(DELETED_DRAFT_IDS_KEY, JSON.stringify([...ids]));
}

/**
 * Prefer cloud when it has data. If cloud field is missing or empty while localStorage
 * still has items (likely wiped by an earlier sync bug), restore from local and repair cloud.
 */
function mergeCloudFieldOrLocal<T>(cloud: Record<string, unknown> | null, field: string, local: T[]): { value: T[]; repair: boolean } {
  const cloudHasField = !!cloud && field in cloud;
  const cloudValue = cloudHasField ? firebaseToArray<T>(cloud![field] as T[] | Record<string, T>) : [];
  if (local.length > 0 && (!cloudHasField || cloudValue.length === 0)) {
    return { value: local, repair: true };
  }
  if (cloudHasField) return { value: cloudValue, repair: false };
  return { value: local, repair: false };
}

function recoveryLog(message: string, detail?: Record<string, unknown>) {
  if (detail) console.info('[malacadhati-recovery]', message, detail);
  else console.info('[malacadhati-recovery]', message);
}

function isEmptyUserPayload(
  nextNotes: Note[],
  qList: QuizItem[],
  chatList: ChatConversation[],
  qsList: QuizSet[],
  qfList: QuizFolder[],
  dList: Draft[] = [],
) {
  return nextNotes.length === 0
    && qList.length === 0
    && chatList.length === 0
    && !hasAnyUserQuizSetRows(qsList)
    && !hasAnyUserQuizFolderRows(qfList)
    && !hasDraftContent(dList);
}

function hasDraftContent(drafts: Draft[]) {
  return drafts.some((d) => d.title.trim().length > 0 || hasRichContent(d.html));
}

function maxDraftCounter(drafts: Draft[]) {
  return drafts.reduce((max, d) => {
    const n = Number.parseInt(d.id.replace(/^d/, ''), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
}

function maxDeletedDraftCounter(deleted: Set<string>) {
  return [...deleted].reduce((max, id) => {
    const n = Number.parseInt(String(id).replace(/^d/, ''), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
}

function syncDraftCounter(counter: number, drafts: Draft[], deleted: Set<string>) {
  return Math.max(counter, maxDraftCounter(drafts), maxDeletedDraftCounter(deleted));
}

function allocateDraftId(counter: { current: number }, drafts: Draft[], deleted: Set<string>) {
  let n = syncDraftCounter(counter.current, drafts, deleted);
  let id: string;
  do {
    id = 'd' + (++n);
  } while (deleted.has(id));
  counter.current = n;
  return id;
}

function shouldKeepDraft(d: Draft, deleted: Set<string>, pendingLocal: Set<string>) {
  if (pendingLocal.has(d.id)) return true;
  return !deleted.has(d.id);
}

function filterVisibleDrafts(drafts: Draft[], deleted: Set<string>, pendingLocal: Set<string>) {
  return drafts.filter((d) => shouldKeepDraft(d, deleted, pendingLocal));
}

function parseCloudDrafts(cloud: Record<string, unknown> | null): Draft[] {
  const dc = (cloud?.draftContents as Record<string, { title?: string; html?: string; updatedAt?: number }> | undefined) || {};
  const cloudDraftIds = firebaseToArray<string>(
    cloud?.drafts as string[] | Record<string, string> | null | undefined,
  ).map(String).filter(Boolean);
  const hasDraftsList = !!cloud && 'drafts' in cloud;
  let draftIds = cloudDraftIds;
  // Only fall back to draftContents keys when cloud never stored a drafts list.
  if (!draftIds.length && !hasDraftsList && dc && typeof dc === 'object') {
    draftIds = Object.keys(dc).filter((k) => k && k !== 'null');
  }
  if (!draftIds.length) return [];
  return draftIds.map((id) => ({
    id: String(id),
    title: dc[String(id)]?.title || '',
    html: dc[String(id)]?.html || '',
    updatedAt: typeof dc[String(id)]?.updatedAt === 'number' ? dc[String(id)]!.updatedAt : undefined,
  }));
}

function resolveDraftsFromSources(
  cloud: Record<string, unknown> | null,
  localDrafts: Draft[],
  deletedDraftIds: Set<string> = new Set(),
): { drafts: Draft[]; counter: number } {
  const remoteDrafts = parseCloudDrafts(cloud).filter((draft) => !deletedDraftIds.has(draft.id));
  const merged = mergeDraftsForPull(localDrafts, remoteDrafts, cloud, deletedDraftIds);
  const counter = (cloud?.draftId as number | undefined) || maxDraftCounter(merged) || merged.length || 1;
  if (merged.length) return { drafts: merged, counter };
  if (localDrafts.length) {
    return { drafts: localDrafts.filter((d) => !deletedDraftIds.has(d.id)), counter: maxDraftCounter(localDrafts) || localDrafts.length };
  }
  return { drafts: [{ id: 'd1', title: '', html: '' }], counter: 1 };
}

/**
 * The only fields any merge path reads out of the user node.
 *
 * Reading `/users/{uid}` wholesale also downloaded `dataHistory` (up to 48 full
 * snapshots of notes + quizzes + sets), `quizFoldersHistory` (40 more), every
 * ById mirror and `files` with inline base64 dataUrls. That node is easily tens
 * of megabytes, and it was re-fetched on boot, on every visibilitychange, on
 * every window focus, every 60s, and on every cloudSyncAt bump from the other
 * device. On mobile the parse alone froze the main thread long enough to look
 * like the page had reloaded itself.
 */
const CLOUD_SYNC_FIELDS = [
  'notes',
  'quizzes',
  'chats',
  'quizSets',
  'quizFolders',
  'drafts',
  'draftContents',
  'draftId',
  'deletedDraftIds',
  'permanentlyDeletedIds',
  'trashEmptiedAt',
  'cloudSyncAt',
  'tokenUsage',
] as const;

/**
 * Field-scoped replacement for a whole-node read. Fields whose value is null are
 * left out of the result so `'quizSets' in cloud` membership checks keep the
 * exact meaning they had before (RTDB omits empty children from a node read too,
 * and a GET on a path that does not exist answers 200 + null rather than 404).
 *
 * All-or-nothing on purpose: a half-read bundle would look like "the cloud has
 * no notes" to the merge paths and trigger a bogus repair push. One failed field
 * therefore fails the whole read, exactly like the single node fetch it replaces,
 * so callers fall back to local data instead of acting on a partial picture.
 */
async function fetchCloudSyncBundle(uid: string): Promise<Record<string, unknown> | null> {
  const results = await Promise.all(CLOUD_SYNC_FIELDS.map(async (field) => {
    try {
      const res = await rtdbFetch(`/users/${uid}/${field}`);
      if (!res.ok) return [field, undefined] as const;
      return [field, (await res.json()) as unknown] as const;
    } catch {
      return [field, undefined] as const;
    }
  }));
  const bundle: Record<string, unknown> = {};
  for (const [field, value] of results) {
    if (value === undefined) return null;
    if (value === null) continue;
    bundle[field] = value;
  }
  return bundle;
}

async function fetchCloudDraftBundle(uid: string, _getToken: () => Promise<string | null>) {
  const get = async (field: string) => {
    const r = await rtdbFetch(`/users/${uid}/${field}`);
    if (!r.ok) return null;
    return r.json();
  };
  const [drafts, draftContents, draftId, deletedDraftIds, cloudSyncAt] = await Promise.all([
    get('drafts'),
    get('draftContents'),
    get('draftId'),
    get('deletedDraftIds'),
    get('cloudSyncAt'),
  ]);
  return { drafts, draftContents, draftId, deletedDraftIds, cloudSyncAt } as Record<string, unknown>;
}

function countUserQuizFolders(folders: QuizFolder[]) {
  return folders.filter((folder) => !folder.system && !folder.trashed).length;
}

function countUserQuizSets(sets: QuizSet[]) {
  return sets.filter((set) => !set.system && !set.trashed).length;
}

/**
 * True only when there is truly nothing user-owned left to persist. Unlike
 * countUserQuizSets/Folders(...) === 0, this counts trashed rows as real data
 * — a set/folder that is soft-deleted still needs to be written to cloud so
 * the delete survives a refresh; treating "all trashed" the same as "empty"
 * is what let the wipe guard below skip that write entirely.
 */
function hasAnyUserQuizSetRows(sets: QuizSet[]) {
  return sets.some((set) => !set.system);
}

function hasAnyUserQuizFolderRows(folders: QuizFolder[]) {
  return folders.some((folder) => !folder.system);
}

async function fetchLatestFolderHistory(uid: string): Promise<QuizFolder[] | null> {
  try {
    const res = await rtdbFetch(`/users/${uid}/quizFoldersHistory?shallow=true`);
    if (!res.ok) return null;
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    if (!keys.length) return null;
    const snap = await rtdbFetch(`/users/${uid}/quizFoldersHistory/${keys[0]}`);
    const folders = firebaseToArray<QuizFolder>(await snap.json());
    if (!folders.some((folder) => !folder.system)) return null;
    return folders;
  } catch {
    return null;
  }
}

const AUTO_QUIZ_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#f97316'];
const RESTORED_FOLDER_ID = 'system-restored-sets';
const RESTORED_QUESTIONS_SET_ID = 'system-restored-questions';
export const FAVORITES_FOLDER_ID = 'system-favorites';
export const FAVORITES_SET_ID = 'system-favorites-set';
const MAX_FOLDER_HISTORY = 40;
const MAX_DATA_HISTORY = 48;
const DATA_HISTORY_MIN_INTERVAL_MS = 60_000;

function lastDataHistoryKey(uid: string) {
  return `malacadhati_last_data_history_${uid}`;
}

function getLastDataHistoryAt(uid: string) {
  const mem = lastDataHistoryAtByUid.get(uid) ?? 0;
  try {
    const stored = Number(localStorage.getItem(lastDataHistoryKey(uid))) || 0;
    return Math.max(mem, stored);
  } catch {
    return mem;
  }
}

function setLastDataHistoryAt(uid: string, ts: number) {
  lastDataHistoryAtByUid.set(uid, ts);
  try {
    safeSetItem(lastDataHistoryKey(uid), String(ts));
  } catch { /* ignore */ }
}

interface DataHistorySnapshot {
  notes: Note[];
  quizzes: QuizItem[];
  chats: ChatConversation[];
  quizSets: QuizSet[];
  quizFolders: QuizFolder[];
  savedAt?: string;
}

const lastDataHistoryAtByUid = new Map<string, number>();

function recoverNotesFromDraftContents(dc: Record<string, { title?: string; html?: string }>): Note[] {
  const entries = Object.entries(dc).filter(([, value]) => {
    const text = (value.html || '').replace(/<[^>]*>/g, '').trim();
    return text.length > 0 || (value.title || '').trim().length > 0;
  });
  if (!entries.length) return [];
  const baseId = Date.now();
  return entries.map(([, value], index) => {
    const html = value.html || '';
    const text = html.replace(/<[^>]*>/g, '').trim();
    return {
      id: baseId + index,
      title: (value.title || '').trim(),
      html,
      text,
      fav: false,
      read: false,
      archived: false,
      date: new Date().toLocaleString(),
    };
  });
}

async function trimHistoryKeys(uid: string, path: string, max: number) {
  try {
    const res = await rtdbFetch(`/users/${uid}/${path}?shallow=true`);
    const keys = Object.keys((await res.json()) || {}).sort();
    const overflow = keys.length - max;
    for (let i = 0; i < overflow; i += 1) {
      await rtdbFetch(`/users/${uid}/${path}/${keys[i]}`, { method: 'DELETE' });
    }
  } catch { /* ignore */ }
}

async function appendDataHistory(uid: string, snapshot: DataHistorySnapshot) {
  if (isEmptyUserPayload(snapshot.notes, snapshot.quizzes, snapshot.chats, snapshot.quizSets, snapshot.quizFolders)) return;
  const now = Date.now();
  const last = getLastDataHistoryAt(uid);
  if (now - last < DATA_HISTORY_MIN_INTERVAL_MS) return;
  setLastDataHistoryAt(uid, now);
  const key = String(now);
  try {
    await rtdbFetch(`/users/${uid}/dataHistory/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, savedAt: new Date(now).toISOString() }),
      headers: { 'Content-Type': 'application/json' },
    });
    await trimHistoryKeys(uid, 'dataHistory', MAX_DATA_HISTORY);
  } catch { /* ignore */ }
}

async function fetchDataHistorySnapshot(uid: string, key: string): Promise<DataHistorySnapshot | null> {
  try {
    const res = await rtdbFetch(`/users/${uid}/dataHistory/${key}`);
    if (!res.ok) return null;
    const snap = await res.json();
    if (!snap) return null;
    return {
      notes: firebaseToArray<Note>(snap.notes),
      quizzes: firebaseToArray<QuizItem>(snap.quizzes),
      chats: firebaseToArray<ChatConversation>(snap.chats).map((chat) => ({ ...chat, messages: chat.messages ?? [] })),
      quizSets: firebaseToArray<QuizSet>(snap.quizSets).map((set) => ({ ...set, items: set.items ?? [] })),
      quizFolders: firebaseToArray<QuizFolder>(snap.quizFolders),
      savedAt: typeof snap.savedAt === 'string' ? snap.savedAt : undefined,
    };
  } catch {
    return null;
  }
}

function mergeNotesById(...lists: Note[][]): Note[] {
  const map = new Map<number, Note>();
  for (const list of lists) {
    for (const item of list) {
      if (item?.id != null) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function mergeQuizzesById(...lists: QuizItem[][]): QuizItem[] {
  const map = new Map<number, QuizItem>();
  for (const list of lists) {
    for (const item of list) {
      if (item?.id != null) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function dataHistoryScore(snapshot: DataHistorySnapshot) {
  const setItems = snapshot.quizSets.reduce((sum, set) => sum + (set.items?.length ?? 0), 0);
  return snapshot.notes.length * 4
    + snapshot.quizzes.length * 3
    + countUserQuizSets(snapshot.quizSets) * 5
    + setItems * 2
    + countUserQuizFolders(snapshot.quizFolders) * 2
    + snapshot.chats.length;
}

function notesFromChats(chats: ChatConversation[]): Note[] {
  const notes: Note[] = [];
  let id = Date.now();
  for (const chat of chats) {
    for (const message of chat.messages ?? []) {
      if (message.role !== 'user') continue;
      const text = message.text?.trim() ?? '';
      if (text.length < 24) continue;
      notes.push({
        id: id++,
        title: chat.title?.trim() || 'Recovered from chat',
        html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
        text,
        fav: false,
        read: false,
        archived: false,
        date: message.timestamp || chat.createdAt || new Date().toISOString(),
      });
    }
  }
  return notes;
}

function countChatUserMessages(chats: ChatConversation[]) {
  return chats.reduce((sum, chat) => sum + (chat.messages ?? []).filter((m) => m.role === 'user' && (m.text?.trim().length ?? 0) >= 24).length, 0);
}

async function fetchBestDataHistory(uid: string): Promise<{ key: string | null; snapshot: DataHistorySnapshot | null }> {
  try {
    const res = await rtdbFetch(`/users/${uid}/dataHistory?shallow=true`);
    if (!res.ok) return { key: null, snapshot: null };
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    let bestKey: string | null = null;
    let bestSnapshot: DataHistorySnapshot | null = null;
    let bestScore = 0;
    for (const key of keys.slice(0, 48)) {
      const snapshot = await fetchDataHistorySnapshot(uid, key);
      if (!snapshot) continue;
      const score = dataHistoryScore(snapshot);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
        bestSnapshot = snapshot;
      }
    }
    return { key: bestKey, snapshot: bestSnapshot };
  } catch {
    return { key: null, snapshot: null };
  }
}

async function fetchLatestDataHistory(uid: string): Promise<DataHistorySnapshot | null> {
  const { snapshot } = await fetchBestDataHistory(uid);
  return snapshot;
}

/** Single latest dataHistory entry — used on normal load when notes are empty. */
async function fetchLatestDataHistorySnapshot(uid: string): Promise<DataHistorySnapshot | null> {
  try {
    const res = await rtdbFetch(`/users/${uid}/dataHistory?shallow=true`);
    if (!res.ok) return null;
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    if (!keys.length) return null;
    return fetchDataHistorySnapshot(uid, keys[0]);
  } catch {
    return null;
  }
}

async function fetchAllFolderHistory(uid: string): Promise<QuizFolder[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/quizFoldersHistory?shallow=true`);
    if (!res.ok) return [];
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    const lists = await Promise.all(keys.map(async (key) => {
      const r = await rtdbFetch(`/users/${uid}/quizFoldersHistory/${key}`);
      return firebaseToArray<QuizFolder>(await r.json());
    }));
    return mergeById(...lists);
  } catch {
    return [];
  }
}

async function readDedicatedQuizData(uid: string) {
  let folders: QuizFolder[] = [];
  let sets: QuizSet[] = [];
  try {
    const r = await rtdbFetch(`/users/${uid}/quizFolders`);
    folders = firebaseToArray<QuizFolder>(await r.json());
  } catch { /* ignore */ }
  try {
    const r = await rtdbFetch(`/users/${uid}/quizSets`);
    sets = firebaseToArray<QuizSet>(await r.json()).map((set) => ({ ...set, items: set.items ?? [] }));
  } catch { /* ignore */ }
  return { folders, sets };
}

async function fetchAllDataHistorySnapshots(uid: string): Promise<DataHistorySnapshot[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/dataHistory?shallow=true`);
    if (!res.ok) return [];
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    const snapshots = await Promise.all(keys.slice(0, 48).map((key) => fetchDataHistorySnapshot(uid, key)));
    return snapshots.filter((snap): snap is DataHistorySnapshot => !!snap);
  } catch {
    return [];
  }
}

function deepScanOrphanedContent(value: unknown): { notes: Note[]; quizzes: QuizItem[]; sets: QuizSet[] } {
  const found = { notes: [] as Note[], quizzes: [] as QuizItem[], sets: [] as QuizSet[] };
  const noteIds = new Set<number>();
  const quizIds = new Set<number>();
  const setIds = new Set<string>();
  const seen = new WeakSet<object>();

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node as object)) return;
    seen.add(node as object);

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    const obj = node as Record<string, unknown>;

    if (
      typeof obj.title === 'string'
      && typeof obj.html === 'string'
      && (typeof obj.id === 'number' || typeof obj.id === 'string')
      && !obj.question
    ) {
      const id = Number(obj.id);
      const text = String(obj.text ?? obj.html.replace(/<[^>]*>/g, '')).trim();
      if (Number.isFinite(id) && text.length > 8 && !noteIds.has(id)) {
        noteIds.add(id);
        found.notes.push({
          id,
          title: obj.title,
          html: obj.html,
          text,
          fav: obj.fav === true,
          read: obj.read === true,
          archived: obj.archived === true,
          trashed: obj.trashed === true,
          deletedAt: typeof obj.deletedAt === 'string' ? obj.deletedAt : undefined,
          date: typeof obj.date === 'string' ? obj.date : new Date().toISOString(),
          lastEdited: typeof obj.lastEdited === 'string' ? obj.lastEdited : undefined,
        });
      }
    }

    if (
      typeof obj.question === 'string'
      && typeof obj.answer === 'string'
      && (typeof obj.id === 'number' || typeof obj.id === 'string')
    ) {
      const id = Number(obj.id);
      const question = obj.question.trim();
      const answer = obj.answer.trim();
      if (Number.isFinite(id) && question.length > 2 && answer.length > 0 && !quizIds.has(id)) {
        quizIds.add(id);
        found.quizzes.push({
          id,
          noteId: Number(obj.noteId ?? 0),
          noteTitle: String(obj.noteTitle ?? ''),
          question,
          answer,
          date: String(obj.date ?? new Date().toISOString()),
          options: Array.isArray(obj.options) ? obj.options.map(String) : undefined,
          correctIndex: typeof obj.correctIndex === 'number' ? obj.correctIndex : undefined,
          correctIndexes: Array.isArray(obj.correctIndexes) ? obj.correctIndexes.map(Number) : undefined,
          explanation: typeof obj.explanation === 'string' ? obj.explanation : undefined,
          createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : undefined,
          updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
          trashed: obj.trashed === true,
          deletedAt: typeof obj.deletedAt === 'string' ? obj.deletedAt : undefined,
        });
      }
    }

    if (typeof obj.name === 'string' && typeof obj.id === 'string' && Array.isArray(obj.items)) {
      const setId = obj.id;
      if (!setIds.has(setId)) {
        setIds.add(setId);
        const items = firebaseToArray<QuizItem>(obj.items as QuizItem[] | Record<string, QuizItem>);
        found.sets.push({
          id: setId,
          name: obj.name,
          items,
          createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
          color: typeof obj.color === 'string' ? obj.color : undefined,
          colorInitialized: obj.colorInitialized === true,
          trashed: obj.trashed === true,
          deletedAt: typeof obj.deletedAt === 'string' ? obj.deletedAt : undefined,
          folderId: typeof obj.folderId === 'string' ? obj.folderId : undefined,
          system: obj.system === 'favorites' ? 'favorites' as const : undefined,
        });
      }
    }

    for (const child of Object.values(obj)) walk(child);
  };

  walk(value);
  return found;
}

async function buildRecoverySnapshot(uid: string, cloud: Record<string, unknown> | null): Promise<DataHistorySnapshot> {
  const [historySnapshots, dedicated, folderHistory, fullUserTree] = await Promise.all([
    fetchAllDataHistorySnapshots(uid),
    readDedicatedQuizData(uid),
    fetchAllFolderHistory(uid),
    cloud
      ? Promise.resolve(cloud)
      : fetch(`${FB_DB_URL}/users/${uid}.json`).then((r) => r.json()).catch(() => null),
  ]);

  const historySnapshot = historySnapshots.reduce<DataHistorySnapshot | null>((best, snap) => {
    if (!best || dataHistoryScore(snap) > dataHistoryScore(best)) return snap;
    return best;
  }, null);

  const allHistoryNotes = historySnapshots.flatMap((snap) => snap.notes);
  const allHistoryQuizzes = historySnapshots.flatMap((snap) => snap.quizzes);
  const allHistorySets = historySnapshots.flatMap((snap) => snap.quizSets);
  const allHistoryFolders = historySnapshots.flatMap((snap) => snap.quizFolders);
  const allHistoryChats = historySnapshots.flatMap((snap) => snap.chats);
  const orphaned = deepScanOrphanedContent(fullUserTree);

  const cloudNotes = cloud ? firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>) : [];
  const cloudQuizzes = cloud ? firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>) : [];
  const cloudChats = cloud
    ? firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>).map((chat) => ({ ...chat, messages: chat.messages ?? [] }))
    : [];
  const cloudSets = cloud
    ? firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] }))
    : [];
  const cloudFolders = cloud ? firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>) : [];
  const draftNotes = cloud?.draftContents && typeof cloud.draftContents === 'object'
    ? recoverNotesFromDraftContents(cloud.draftContents as Record<string, { title?: string; html?: string }>)
    : [];
  const chatNotes = notesFromChats(cloudChats);

  const history = historySnapshot ?? {
    notes: [],
    quizzes: [],
    chats: [],
    quizSets: [],
    quizFolders: [],
  };

  return {
    notes: mergeNotesById(history.notes, cloudNotes, draftNotes, chatNotes, allHistoryNotes, orphaned.notes),
    quizzes: mergeQuizzesById(
      history.quizzes,
      cloudQuizzes,
      allHistoryQuizzes,
      orphaned.quizzes,
      [history.quizSets, cloudSets, dedicated.sets, allHistorySets, orphaned.sets].flatMap((sets) => sets.flatMap((set) => set.items ?? [])),
    ),
    chats: (() => {
      const merged = new Map<string, ChatConversation>();
      for (const chat of [...history.chats, ...allHistoryChats, ...cloudChats]) {
        merged.set(chat.id, { ...chat, messages: chat.messages ?? [] });
      }
      return [...merged.values()];
    })(),
    quizSets: mergeById(history.quizSets, cloudSets, dedicated.sets, allHistorySets, orphaned.sets),
    quizFolders: mergeById(history.quizFolders, cloudFolders, dedicated.folders, folderHistory, allHistoryFolders),
  };
}

function ensureRestoredFolder(folders: QuizFolder[]) {
  const restored = folders.find((folder) => folder.id === RESTORED_FOLDER_ID || folder.system === 'restored');
  if (restored) {
    return folders.map((folder) => folder.id === restored.id
      ? { ...folder, id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, trashed: false, deletedAt: undefined, color: folder.color || '#6c63ff', colorInitialized: true }
      : folder);
  }
  return [{ id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, createdAt: new Date().toISOString(), color: '#6c63ff', colorInitialized: true }, ...folders];
}

function ensureFavoritesFolder(folders: QuizFolder[]) {
  const fav = folders.find((folder) => folder.id === FAVORITES_FOLDER_ID || folder.system === 'favorites');
  if (fav) {
    return folders.map((folder) => folder.id === fav.id
      ? { ...folder, id: FAVORITES_FOLDER_ID, name: 'Favoriter', system: 'favorites' as const, trashed: false, deletedAt: undefined, color: folder.color || '#f59e0b', colorInitialized: true }
      : folder);
  }
  const favFolder: QuizFolder = { id: FAVORITES_FOLDER_ID, name: 'Favoriter', system: 'favorites', createdAt: new Date().toISOString(), color: '#f59e0b', colorInitialized: true };
  // Place right after the restored folder (which sits first).
  const idx = folders.findIndex((f) => f.id === RESTORED_FOLDER_ID || f.system === 'restored');
  if (idx >= 0) {
    const copy = [...folders];
    copy.splice(idx + 1, 0, favFolder);
    return copy;
  }
  return [favFolder, ...folders];
}

function ensureRestoredQuestionsSet(sets: QuizSet[]): QuizSet[] {
  const existing = sets.find((s) => s.id === RESTORED_QUESTIONS_SET_ID);
  if (existing) {
    return sets.map((s) => (
      s.id === RESTORED_QUESTIONS_SET_ID
        ? {
            ...s,
            folderId: RESTORED_FOLDER_ID,
            trashed: false,
            deletedAt: undefined,
            name: s.name?.trim() ? s.name : 'Restored questions',
            color: s.color || '#6c63ff',
            colorInitialized: true,
          }
        : s
    ));
  }
  return [
    ...sets,
    {
      id: RESTORED_QUESTIONS_SET_ID,
      name: 'Restored questions',
      folderId: RESTORED_FOLDER_ID,
      items: [],
      createdAt: new Date().toISOString(),
      color: '#6c63ff',
      colorInitialized: true,
    },
  ];
}

function ensureFavoritesSet(sets: QuizSet[]) {
  const fav = sets.find((s) => s.id === FAVORITES_SET_ID || s.system === 'favorites');
  if (fav) {
    return sets.map((s) => s.id === fav.id
      ? { ...s, id: FAVORITES_SET_ID, name: 'Favorit frågor', system: 'favorites' as const, folderId: FAVORITES_FOLDER_ID, trashed: false, deletedAt: undefined, color: s.color || '#f59e0b', colorInitialized: true }
      : s);
  }
  return [...sets, { id: FAVORITES_SET_ID, name: 'Favorit frågor', system: 'favorites' as const, folderId: FAVORITES_FOLDER_ID, items: [], createdAt: new Date().toISOString(), color: '#f59e0b', colorInitialized: true }];
}

function colorDistance(a: string, b: string) {
  const channels = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

function hashSeed(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

/**
 * Colour assignment must be a pure function of the row id.
 *
 * These pickers run inside every merge pass (boot, each realtime tick, each
 * pull). With `Math.random()` tie-breaks the same colourless row got a
 * different colour on every pass, so the merged array never compared equal to
 * the previous one: the UI re-rendered the whole quiz tree, the reconcile push
 * shipped the new colour to the cloud, that bumped cloudSyncAt, the other
 * device pulled, re-rolled its own colour and pushed back — an endless
 * cross-device write loop that looked like constant flicker/self-refresh.
 */
function pickSpacedColor(usedColors: string[], seed = '') {
  const used = usedColors.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  const counts = new Map(AUTO_QUIZ_COLORS.map((color) => [color, used.filter((usedColor) => usedColor.toLowerCase() === color).length]));
  const lowestUse = Math.min(...counts.values());
  const leastUsed = AUTO_QUIZ_COLORS.filter((color) => counts.get(color) === lowestUse);
  const pick = (candidates: string[]) => candidates[hashSeed(seed) % candidates.length];
  if (used.length === 0) return pick(leastUsed);
  const scored = leastUsed.map((color) => ({ color, score: Math.min(...used.map((usedColor) => colorDistance(color, usedColor))) }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore).map(({ color }) => color);
  return pick(best);
}

function initializeQuizColors<T extends { id: string; color?: string; colorInitialized?: boolean }>(items: T[], initialColors: string[] = []) {
  const used = [...initialColors, ...items.map((item) => item.color).filter((color): color is string => !!color)];
  return items.map((item) => {
    if (item.colorInitialized || item.color) return item;
    const color = pickSpacedColor(used, item.id);
    used.push(color);
    return { ...item, color, colorInitialized: true };
  });
}

function inferRecoveredFolderName(sets: QuizSet[]): string {
  const blob = sets
    .flatMap((set) => [set.name, ...(set.items ?? []).map((item) => `${item.question} ${item.answer}`)])
    .join(' ')
    .toLowerCase();
  if (blob.includes('sepsis')) return 'sepsis';
  const setNames = [...new Set(sets.map((set) => set.name.trim()).filter(Boolean))];
  if (setNames.length === 1) return setNames[0];
  if (setNames.length > 1) return setNames[0];
  return 'Återställd mapp';
}

const GENERIC_RECOVERED_FOLDER_NAMES = new Set([
  'återställd mapp',
  'restored folder',
  'restored sets',
]);

function isGenericRecoveredFolderName(name: string) {
  return GENERIC_RECOVERED_FOLDER_NAMES.has(name.trim().toLowerCase());
}

function recoveredFolderNameFromLocal(folderId: string, setsInFolder: QuizSet[]): string {
  const localFolders = readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? [];
  const localFolder = localFolders.find((folder) => folder.id === folderId);
  if (localFolder?.name && !isGenericRecoveredFolderName(localFolder.name)) {
    return localFolder.name;
  }
  return inferRecoveredFolderName(setsInFolder);
}

function recoverMissingFoldersFromSets(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const known = new Map(folders.map((folder) => [folder.id, folder]));
  const dead = new Set(readPermDeleted().quizFolders.map(String));
  const softTombs = readTrashTombstones(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY);
  const emptiedAt = readTrashEmptiedAt();
  const referenced = new Set<string>();
  for (const set of sets) {
    if (!set.folderId || set.trashed) continue;
    if (set.folderId === FAVORITES_FOLDER_ID || set.folderId === RESTORED_FOLDER_ID) continue;
    referenced.add(set.folderId);
  }

  const recovered = [...folders];
  for (const folderId of referenced) {
    if (known.has(folderId)) continue;
    // Never invent a live folder for a permanently deleted / emptied / soft-trashed id.
    if (dead.has(folderId)) continue;
    const softAt = softTombs[folderId];
    if (softAt !== undefined) {
      if (emptiedAt && softAt <= emptiedAt) continue;
      continue;
    }
    const setsInFolder = sets.filter((set) => set.folderId === folderId && !set.trashed);
    const usedColors = [...folders, ...sets].map((item) => item.color).filter((color): color is string => !!color);
    // Derive createdAt from the sets that reference the folder instead of
    // Date.now(): this runs on every merge pass, and a fresh timestamp made the
    // rebuilt folder differ from the previous pass forever (see pickSpacedColor).
    const createdAt = setsInFolder
      .map((set) => set.createdAt)
      .filter(Boolean)
      .sort()[0] ?? new Date(0).toISOString();
    recovered.push({
      id: folderId,
      name: recoveredFolderNameFromLocal(folderId, setsInFolder),
      createdAt,
      color: pickSpacedColor(usedColors, folderId),
      colorInitialized: true,
    });
    known.set(folderId, recovered[recovered.length - 1]);
  }
  return recovered;
}

function autoRestoreReferencedTrashedFolders(folders: QuizFolder[], _sets: QuizSet[]): QuizFolder[] {
  return folders;
}

function finalizeQuizFolders(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const merged = recoverMissingFoldersFromSets(folders, sets);
  const restored = autoRestoreReferencedTrashedFolders(merged, sets);
  return ensureRestoredFolder(initializeQuizColors(restored));
}

function nextId() {
  return Date.now();
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [notes, setNotes] = useState<Note[]>(() => readBootNotesForPaint());
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [quizSets, setQuizSetsState] = useState<QuizSet[]>([]);
  const [quizFolders, setQuizFolders] = useState<QuizFolder[]>(() => {
    try {
      const raw = readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? [];
      return ensureRestoredFolder(firebaseToArray<QuizFolder>(raw));
    } catch {
      return ensureRestoredFolder([]);
    }
  });
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(() => {
    const bootNotes = readBootNotesForPaint();
    let bootSets: QuizSet[] = [];
    let bootQuizzes: QuizItem[] = [];
    let bootFolders: QuizFolder[] = [];
    try {
      const local = readLocalNotesDataRaw();
      bootSets = local.sets;
      bootQuizzes = local.quizzes;
      bootFolders = local.folders;
    } catch { /* ignore */ }
    const computed = computeSidebarCounts(bootNotes, bootQuizzes, bootSets, bootFolders);
    const cached = readSidebarCounts();
    if (!cached) {
      writeSidebarCounts(computed);
      return computed;
    }
    // First pixel: never under-report study/library vs last session (incomplete LS vs IDB).
    // Trash must follow live lists — a stale "1" here is why the badge stayed red on an empty page.
    const merged: SidebarCounts = {
      home: Math.max(cached.home, computed.home),
      unread: Math.max(cached.unread, computed.unread),
      read: Math.max(cached.read, computed.read),
      fav: Math.max(cached.fav, computed.fav),
      archive: Math.max(cached.archive, computed.archive),
      trashNotes: computed.trashNotes,
      trashQuizzes: computed.trashQuizzes,
      trashSets: computed.trashSets,
      trashFolders: computed.trashFolders,
    };
    writeSidebarCounts(merged);
    return merged;
  });
  const [chats, setChats] = useState<ChatConversation[]>([]);
  const [tokenUsage, setTokenUsage] = useState<number>(0);
  const draftCounter = useRef(0);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');
  const [cloudSyncedAt, setCloudSyncedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [quizLocalReady, setQuizLocalReady] = useState(false);
  const [quizContentReady, setQuizContentReady] = useState(false);
  const [draftsReady, setDraftsReady] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const loadedRef = useRef(false);
  const quizLocalReadyRef = useRef(false);
  const quizContentReadyRef = useRef(false);
  /** Timeout revealed local bodies before ById — first ById may still catch up (9→11). */
  const quizRevealedViaTimeoutRef = useRef(false);
  /** First authoritative quizItemsById (or equivalent) body snapshot was applied. */
  const quizAuthoritativeByIdSeenRef = useRef(false);
  /** Max wait for cloud ById before revealing best-effort local question bodies. */
  const QUIZ_CONTENT_READY_TIMEOUT_MS = 2500;
  /** Last quiz lists actually committed to React — shrink checks use this, not refs alone. */
  const lastPaintedQuizSetsRef = useRef<QuizSet[]>([]);
  const lastPaintedQuizzesRef = useRef<QuizItem[]>([]);
  /** Monotonic max live item count per set id — never paint/write below this. */
  const maxKnownLiveBySetRef = useRef<Map<string, number>>(new Map());
  const cloudLoadSucceededRef = useRef(false);
  const draftsReadyRef = useRef(false);
  const draftPullDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savesInFlight = useRef(0);
  const savingStartedAt = useRef(0);
  const isApplyingRemoteRef = useRef(false);
  const lastLocalSaveAt = useRef(0);
  const lastAppliedRemoteSyncAt = useRef(0);
  const saveFailedRef = useRef(false);
  /** Max time "Saving…" may stay up before we force-clear a hung counter. */
  const STUCK_SAVING_MS = 45_000;
  const pendingDeletedDraftIdsRef = useRef<Set<string>>(readDeletedDraftIds());
  const permDeletedRef = useRef<PermanentlyDeletedIds>(readPermDeleted());
  /** Ids removed this session — a late notesById download must not resurrect them. */
  const rejectedNoteIdsRef = useRef<Map<number, number>>(new Map());
  const localTrashIdsRef = useRef<Set<number>>(new Set());
  const notesCloudGenRef = useRef(0);
  /** Durable soft-delete markers — see applyTrashTombstones for why these exist. */
  const quizSetTombstonesRef = useRef<TrashTombstones>(readTrashTombstones(QUIZ_SET_TRASH_TOMBSTONE_KEY));
  const quizFolderTombstonesRef = useRef<TrashTombstones>(readTrashTombstones(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY));
  const quizItemTombstonesRef = useRef<TrashTombstones>(readTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY));
  const noteTrashTombstonesRef = useRef<TrashTombstones>(readTrashTombstones(NOTE_TRASH_TOMBSTONE_KEY));
  /** Once true, refuse to PATCH/PUT empty arrays over cloud (prevents accidental wipe). */
  const everHadNotesRef = useRef(false);
  const everHadQuizzesRef = useRef(false);
  const everHadSetsRef = useRef(false);
  const markEverHadContent = (n: Note[], q: QuizItem[], sets: QuizSet[]) => {
    if (n.length > 0) everHadNotesRef.current = true;
    if (q.length > 0) everHadQuizzesRef.current = true;
    if (countUserQuizSets(sets) > 0) everHadSetsRef.current = true;
  };
  const lastDraftEditAt = useRef(0);
  const lastCloudDraftIdsRef = useRef<Set<string>>(new Set());
  const pendingDraftCloudSaveRef = useRef(false);
  const draftCloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageBytesHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLocalEditAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftHtmlRef = useRef<Map<string, string>>(new Map());
  const draftSaveInFlightRef = useRef<Set<string>>(new Set());
  const draftSavePendingAgainRef = useRef<Set<string>>(new Set());
  const pendingLocalDraftIdsRef = useRef<Set<string>>(new Set());
  const pullTimer = useRef<number | null>(null);
  const pendingRemotePullRef = useRef(false);
  const lastRemotePullAt = useRef(0);
  const lastPushedDataAtRef = useRef(0);
  const lastPushedPayloadRef = useRef<Partial<Record<'notes' | 'quizzes' | 'quizSets' | 'quizFolders', string>>>({});
  const pendingRemoteTrashPatchesRef = useRef<Array<{
    notes?: unknown;
    quizzes?: unknown;
    quizSets?: unknown;
    quizFolders?: unknown;
  }>>([]);
  /** ById child events while an array merge holds the lock — never drop creates/deletes. */
  const pendingRemoteByIdRef = useRef<Array<{ kind: 'set' | 'folder'; raw: unknown }>>([]);
  const pendingInstantDataSaveRef = useRef<{
    notes?: Note[];
    quizzes?: QuizItem[];
    quizSets?: QuizSet[];
    quizFolders?: QuizFolder[];
  } | null>(null);
  const instantDataSaveQueuedRef = useRef(false);
  const notesRef = useRef(notes);
  const quizzesRef = useRef(quizzes);
  const chatsRef = useRef(chats);
  const quizSetsRef = useRef(quizSets);
  /** Coerce Firebase object-shaped items[] so Favourites/Restored never crash on .map/.filter. */
  const setQuizSets = (
    update: QuizSet[] | ((prev: QuizSet[]) => QuizSet[]),
  ) => {
    if (typeof update === 'function') {
      setQuizSetsState((prev) => {
        const next = normalizeQuizSetsRows(update(prev));
        quizSetsRef.current = next;
        return next;
      });
      return;
    }
    const next = normalizeQuizSetsRows(update);
    quizSetsRef.current = next;
    setQuizSetsState(next);
  };
  const quizFoldersRef = useRef(quizFolders);
  const hydrateQuizSetInFlight = useRef<Set<string>>(new Set());
  /** Durable ById mirrors — union into every array apply so devices never diverge. */
  const quizSetsByIdCacheRef = useRef<QuizSet[]>([]);
  const quizFoldersByIdCacheRef = useRef<QuizFolder[]>([]);
  /** Manual Egen set-list order — lightweight cloud mirror independent of ById scramble. */
  const quizSetsListOrderRef = useRef<QuizSetsListOrder | null>(
    normalizeQuizSetsListOrder(readLocalJson<QuizSetsListOrder>(QUIZ_SETS_LIST_ORDER_KEY)),
  );
  const draftsRef = useRef(drafts);
  const tokenUsageRef = useRef(tokenUsage);
  const MIN_SYNC_VISIBLE_MS = 650;

  const beginTrackedSave = () => {
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
  };

  const endTrackedSave = () => {
    savesInFlight.current = Math.max(0, savesInFlight.current - 1);
    if (savesInFlight.current > 0) return;
    if (saveFailedRef.current) {
      setCloudStatus('error');
      return;
    }
    const elapsed = Date.now() - savingStartedAt.current;
    const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
    const markSaved = () => setCloudStatus('saved');
    if (delay > 0) setTimeout(markSaved, delay);
    else markSaved();
  };

  notesRef.current = notes;
  quizzesRef.current = quizzes;
  chatsRef.current = chats;
  quizSetsRef.current = quizSets;
  quizFoldersRef.current = quizFolders;
  draftsRef.current = drafts;
  tokenUsageRef.current = tokenUsage;

  // Durable sidebar badges + list cache: never wait on cloud.
  // Until `loaded`, never shrink study/library counts just because LS is incomplete.
  // Trash always follows the live lists so an emptied/deleted item cannot leave a ghost badge.
  useEffect(() => {
    if (!user) return;
    if (notes.length) {
      rememberNotesBootCache(notes);
      writeNotesListCache(notes);
    }
    const next = computeSidebarCounts(notes, quizzes, quizSets, quizFolders, permDeletedRef.current);
    setSidebarCounts((prev) => {
      const merged: SidebarCounts = loaded
        ? next
        : {
            home: Math.max(prev.home, next.home),
            unread: Math.max(prev.unread, next.unread),
            read: Math.max(prev.read, next.read),
            fav: Math.max(prev.fav, next.fav),
            archive: Math.max(prev.archive, next.archive),
            trashNotes: next.trashNotes,
            trashQuizzes: next.trashQuizzes,
            trashSets: next.trashSets,
            trashFolders: next.trashFolders,
          };
      if (
        prev.home === merged.home
        && prev.unread === merged.unread
        && prev.read === merged.read
        && prev.fav === merged.fav
        && prev.archive === merged.archive
        && prev.trashNotes === merged.trashNotes
        && prev.trashQuizzes === merged.trashQuizzes
        && prev.trashSets === merged.trashSets
        && prev.trashFolders === merged.trashFolders
      ) {
        return prev;
      }
      writeSidebarCounts(merged);
      return merged;
    });
  }, [notes, quizzes, quizSets, quizFolders, loaded, user]);

  const nowStr = () =>
    new Date().toLocaleString(t.dateLocale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  const rejectNoteIds = (ids: Iterable<number>) => {
    const at = Date.now();
    notesCloudGenRef.current += 1;
    for (const raw of ids) {
      const id = Number(raw);
      if (!Number.isFinite(id)) continue;
      rejectedNoteIdsRef.current.set(id, at);
    }
  };

  const markNotesTrashedLocally = (ids: Iterable<number>) => {
    notesCloudGenRef.current += 1;
    for (const raw of ids) {
      const id = Number(raw);
      if (Number.isFinite(id)) localTrashIdsRef.current.add(id);
    }
  };

  const incomingNotesSafe = (incoming: Note[], allowNewIds = true): Note[] => {
    const blocked = blockedNoteIdSet(permDeletedRef.current, rejectedNoteIdsRef.current);
    let next = incoming.filter((n) => !blocked.has(Number(n.id)));
    if (!allowNewIds) {
      const have = new Set(notesRef.current.map((n) => Number(n.id)));
      next = next.filter((n) => have.has(Number(n.id)));
    }
    const trashTombs = noteTrashTombstonesRef.current;
    if (localTrashIdsRef.current.size || Object.keys(trashTombs).length) {
      next = next.map((n) => {
        const id = Number(n.id);
        const tombAt = trashTombs[String(id)];
        if (n.trashed) return n;
        if (!localTrashIdsRef.current.has(id) && tombAt == null) return n;
        const cur = notesRef.current.find((c) => Number(c.id) === id);
        return cur?.trashed ? cur : { ...n, trashed: true, deletedAt: n.deletedAt || nowStr() };
      });
    }
    return next;
  };

  const adoptNotesSafe = (current: Note[], incoming: Note[], applyFlags = true, allowNewIds = true) => {
    const safe = incomingNotesSafe(incoming, allowNewIds);
    return applyTrashTombstones(
      adoptCloudNoteBodies(
        current,
        safe,
        applyFlags,
        blockedNoteIdSet(permDeletedRef.current, rejectedNoteIdsRef.current),
      ),
      noteTrashTombstonesRef.current,
      nowStr(),
    );
  };

  // Load from cloud when user changes
  useEffect(() => {
    let cancelled = false;
    let quizContentReadyTimer: ReturnType<typeof setTimeout> | null = null;
    loadedRef.current = false;
    quizLocalReadyRef.current = false;
    quizContentReadyRef.current = false;
    quizRevealedViaTimeoutRef.current = false;
    quizAuthoritativeByIdSeenRef.current = false;
    lastPaintedQuizSetsRef.current = [];
    lastPaintedQuizzesRef.current = [];
    maxKnownLiveBySetRef.current = new Map();
    cloudLoadSucceededRef.current = false;
    draftsReadyRef.current = false;
    setDraftsReady(false);
    setDraftsLoading(false);
    setLoaded(false);
    setQuizLocalReady(false);
    setQuizContentReady(false);
    if (!user) {
      setNotes([]);
      setDrafts([]);
      setCloudSyncedAt(null);
      loadedRef.current = true;
      quizLocalReadyRef.current = true;
      quizContentReadyRef.current = true;
      quizAuthoritativeByIdSeenRef.current = true;
      setLoaded(true);
      setQuizLocalReady(true);
      setQuizContentReady(true);
      return;
    }
    syncAccountLocalStorage(user.uid);
    // Account switch may have replaced LS; re-read tombstones after the swap.
    quizSetTombstonesRef.current = readTrashTombstones(QUIZ_SET_TRASH_TOMBSTONE_KEY);
    quizFolderTombstonesRef.current = readTrashTombstones(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY);
    quizItemTombstonesRef.current = readTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY);
    noteTrashTombstonesRef.current = readTrashTombstones(NOTE_TRASH_TOMBSTONE_KEY);
    // IndexedDB journal is the durable write-ahead log for image notes (localStorage
    // quota can't hold them). Load it in parallel with the first paint from the
    // raw localStorage snapshot, then fold journal entries in before cloud merge.
    let local = readLocalNotesDataRaw();
    // LAST-GOOD COMPLETE CACHE (sync): paint the correct full snapshot immediately.
    // Never first-paint incomplete LS shells (classic 9) over last-good 11.
    const lastGoodSync = readQuizCompleteCache();
    const bootPick = pickBootQuizLists({
      localQuizzes: local.quizzes,
      localSets: local.sets,
      lastGood: lastGoodSync,
      memory: quizListsBootCache,
    });
    // Honor soft-delete tombstones on boot so deletes stick in the first pixel.
    const bootSets = applyTrashTombstones(
      honorQuizItemTrashTombstones(bootPick.sets, quizItemTombstonesRef.current),
      quizSetTombstonesRef.current,
    );
    const bootQuizzes = honorQuizItemTrashTombstonesOnItems(
      bootPick.quizzes,
      quizItemTombstonesRef.current,
    );
    const prunedBoot = pruneQuizListsAgainstTrashState(bootQuizzes, bootSets);
    const emptiedAtBootLocal = readTrashEmptiedAt();
    const bootListOrder = ensureQuizSetsListOrderFromShells() ?? readQuizSetsListOrderLocal();
    quizSetsListOrderRef.current = bootListOrder;
    local = {
      ...local,
      quizzes: prunedBoot.quizzes,
      // Egen order must win over last-good / LS scramble on the first pixel.
      sets: applyLocalQuizSetsListOrder(prunedBoot.sets, bootListOrder),
      notes: stripPermDeletedNotes(local.notes, permDeletedRef.current).filter((note) => (
        !(note.trashed && emptiedAtBootLocal && entitySyncTime(note) <= emptiedAtBootLocal)
      )),
      folders: local.folders.filter((folder) => {
        if (permDeletedRef.current.quizFolders.includes(folder.id)) return false;
        if (folder.trashed && emptiedAtBootLocal && entitySyncTime(folder) <= emptiedAtBootLocal) return false;
        return true;
      }),
    };
    // Paint the richest local snapshot immediately — never wait on cloud.
    const bootMergedNotes = sortNotesByCreatedDesc(mergeNotesPreferRicher(
      local.notes,
      readNotesListCache(),
      readNotesBootCache(),
      peekPrefetchedNotes(),
      notesRef.current,
    ));
    local = { ...local, notes: bootMergedNotes };
    notesRef.current = bootMergedNotes;
    // First paint already happened from useState(readBootNotesForPaint) after IDB
    // prefetch — do not setNotes again here (that was the old→new drip).
    if (bootMergedNotes.length) {
      rememberNotesBootCache(bootMergedNotes);
      writeNotesListCache(bootMergedNotes);
    }
    {
      const computed = computeSidebarCounts(
        bootMergedNotes,
        local.quizzes,
        local.sets,
        local.folders,
        permDeletedRef.current,
      );
      const cached = readSidebarCounts();
      const merged: SidebarCounts = cached
        ? {
            home: Math.max(cached.home, computed.home),
            unread: Math.max(cached.unread, computed.unread),
            read: Math.max(cached.read, computed.read),
            fav: Math.max(cached.fav, computed.fav),
            archive: Math.max(cached.archive, computed.archive),
            trashNotes: computed.trashNotes,
            trashQuizzes: computed.trashQuizzes,
            trashSets: computed.trashSets,
            trashFolders: computed.trashFolders,
          }
        : computed;
      writeSidebarCounts(merged);
      setSidebarCounts(merged);
    }
    quizzesRef.current = local.quizzes;
    quizSetsRef.current = local.sets;

    const commitNotes = (snapshot: Note[], opts?: { paint?: boolean }) => {
      if (cancelled) return;
      const blocked = blockedNoteIdSet(permDeletedRef.current, rejectedNoteIdsRef.current);
      let mergedNotes = sortNotesByCreatedDesc(
        applyTrashTombstones(
          snapshot.filter((note) => (
            !blocked.has(Number(note.id))
            && !(note.trashed && emptiedAtBootLocal && entitySyncTime(note) <= emptiedAtBootLocal)
          )),
          noteTrashTombstonesRef.current,
        ),
      );
      const prev = notesRef.current;
      notesRef.current = mergedNotes;
      local = { ...local, notes: mergedNotes };
      rememberNotesBootCache(mergedNotes, true);
      writeNotesListCache(mergedNotes);
      if (opts?.paint === false) return;
      // Same membership: keep the first complete paint. Extra setNotes is the drip.
      // Still paint when a new device got empty shells first and notesById then
      // brought the real image HTML — skipping that is why hospital PCs lost photos.
      if (
        notesIdSetEqual(mergedNotes, prev)
        && prev.length > 0
        && notesFlagsEqual(mergedNotes, prev)
        && !notesBodiesRicher(mergedNotes, prev)
      ) return;
      if (notesMetaEqual(mergedNotes, prev)) return;
      setNotes(mergedNotes);
    };

    // IndexedDB already awaited in BootLoader — fold in without a second paint when ids match.
    const notesIdbReady = (async () => {
      const idbNotes = await prefetchAllNotesLocal();
      if (cancelled || !idbNotes.length) return;
      commitNotes(mergeNotesPreferRicher(notesRef.current, idbNotes));
    })();
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, local.sets);
    if (bootPick.fromLastGood && local.sets.length > 0) {
      setQuizzes(local.quizzes);
      setQuizSets(local.sets);
      lastPaintedQuizzesRef.current = local.quizzes;
      lastPaintedQuizSetsRef.current = local.sets;
      rememberQuizListsBootCache(local.quizzes, local.sets);
      quizLocalReadyRef.current = true;
      // Last-good IS the correct last session state — cards ready with zero wait.
      quizContentReadyRef.current = true;
      quizAuthoritativeByIdSeenRef.current = true;
      setQuizLocalReady(true);
      setQuizContentReady(true);
    } else if (local.sets.length > 0) {
      // Structure-first: sidebar shells only. Question cards wait for last-good
      // IDB hydrate or first ById merge — never timeout-reveal incomplete LS-9.
      setQuizSets(local.sets);
      lastPaintedQuizSetsRef.current = local.sets;
      if (local.quizzes.length) {
        setQuizzes(local.quizzes);
        lastPaintedQuizzesRef.current = local.quizzes;
      }
      quizLocalReadyRef.current = true;
      setQuizLocalReady(true);
    }
    // Prefetched tiny quizCatalog (BootLoader) — same folder/set count on every device
    // before the multi-MB quizSetsById tree lands.
    {
      const cat = peekQuizCatalog();
      if (cat.folders.length || cat.sets.length) {
        if (cat.folders.length) {
          const mergedFolders = applyTrashTombstones(
            mergeFoldersForSync(local.folders, cat.folders, permDeletedRef.current, {
              remoteIsAuthority: true,
            }),
            quizFolderTombstonesRef.current,
          );
          local = { ...local, folders: mergedFolders };
          quizFoldersRef.current = mergedFolders;
          setQuizFolders(finalizeQuizFolders(mergedFolders, local.sets));
        }
        if (cat.sets.length) {
          const mergedSets = preferRicherQuizSetsMembership(
            honorQuizItemTrashTombstones(local.sets, quizItemTombstonesRef.current),
            cat.sets,
          );
          local = { ...local, sets: mergedSets };
          quizSetsRef.current = mergedSets;
          setQuizSets(mergedSets);
          lastPaintedQuizSetsRef.current = mergedSets;
          quizLocalReadyRef.current = true;
          setQuizLocalReady(true);
        }
      }
    }
    const journalReady = loadRecentEdits().then((edits) => {
      if (cancelled || edits.length === 0) return edits;
      local = applyRecentEditsToData(local, edits);
      local = {
        ...local,
        notes: stripPermDeletedNotes(
          mergeNotesPreferRicher(local.notes, notesRef.current),
          permDeletedRef.current,
        ),
      };
      notesRef.current = local.notes;
      quizzesRef.current = local.quizzes;
      quizSetsRef.current = local.sets;
      commitNotes(local.notes);
      return edits;
    });

    // Radical durability: IndexedDB + notesById / quizSetsById are the source of
    // truth for recently-saved items. Fold set shells in for first paint ASAP;
    // heavy quiz-item bodies enrich in the background so folders never sit on "0 set".
    const markQuizLocalReady = () => {
      if (cancelled || quizLocalReadyRef.current) return;
      quizLocalReadyRef.current = true;
      setQuizLocalReady(true);
    };
    const markQuizContentReady = (via: 'byid' | 'timeout' | 'fallback' | 'cache' = 'fallback') => {
      if (cancelled) return;
      if (via === 'timeout' && !quizContentReadyRef.current) {
        quizRevealedViaTimeoutRef.current = true;
      }
      if (via === 'byid' || via === 'cache') {
        quizAuthoritativeByIdSeenRef.current = true;
        quizRevealedViaTimeoutRef.current = false;
      }
      if (quizContentReadyRef.current) return;
      if (quizContentReadyTimer) {
        clearTimeout(quizContentReadyTimer);
        quizContentReadyTimer = null;
      }
      quizContentReadyRef.current = true;
      setQuizContentReady(true);
    };
    const armQuizContentReadyTimeout = () => {
      if (cancelled || quizContentReadyRef.current || quizContentReadyTimer) return;
      // Online: short grace so shells/last-good paint while quizItemsById finishes.
      // Offline: same path. Never hang the Quiz spinner on a slow hospital download.
      const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
      quizContentReadyTimer = setTimeout(() => {
        quizContentReadyTimer = null;
        markQuizContentReady('timeout');
      }, online ? 6_000 : QUIZ_CONTENT_READY_TIMEOUT_MS);
    };
    // Only arm offline grace — last-good already set contentReady above when present.
    if (quizLocalReadyRef.current && !quizContentReadyRef.current) armQuizContentReadyTimeout();
    /** Persist last-good complete snapshot after a successful full merge. */
    const persistLastGoodIfComplete = (quizzes: QuizItem[], sets: QuizSet[]) => {
      const honored = honorQuizListsWithTrashTombstones(quizzes, sets, {
        items: quizItemTombstonesRef.current,
        sets: quizSetTombstonesRef.current,
        folders: quizFolderTombstonesRef.current,
        notes: noteTrashTombstonesRef.current,
      });
      const pruned = pruneQuizListsAgainstTrashState(honored.quizzes, honored.sets);
      if (!quizSetsHaveCompleteBodies(pruned.sets)) return;
      if (!isQuizSetsLocalWriteSafe(pruned.sets, maxKnownLiveBySetRef.current, lastPaintedQuizSetsRef.current)) {
        return;
      }
      persistQuizCompleteCache(pruned.quizzes, pruned.sets);
    };
    /** Single commit path: union into refs, setState, safe LS — never shrink below max-known. */
    const commitQuizListsLocal = (
      nextQuizzes: QuizItem[],
      nextSets: QuizSet[],
      opts?: { persistLocal?: boolean; forcePaint?: boolean; isAuthoritativeByIdMerge?: boolean },
    ) => {
      if (cancelled) return;
      // UI baseline = last painted React lists only. Refs are often pre-updated
      // before this commit; using them as baseline skipped setQuizSets and left [].
      const painted = lastPaintedQuizSetsRef.current;
      const paintedQuizzes = lastPaintedQuizzesRef.current;
      const itemTrash = quizItemTombstonesRef.current;
      const byIdHonored = honorQuizItemTrashTombstones(quizSetsByIdCacheRef.current, itemTrash);
      const paintedHonored = honorQuizItemTrashTombstones(painted, itemTrash);
      let sets = unionQuizSetsForCommit(
        honorQuizItemTrashTombstones(nextSets, itemTrash),
        paintedHonored,
        honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
        byIdHonored,
      );
      // Soft-deleted questions must stay trashed after union-keep from richer shells.
      sets = honorQuizItemTrashTombstones(sets, itemTrash);
      sets = applySetTrashTombstones(sets, quizSetTombstonesRef.current, {
        emptiedAt: readTrashEmptiedAt(),
      });
      bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, sets);
      bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, byIdHonored);
      bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, paintedHonored);
      sets = honorQuizItemTrashTombstones(
        enforceMaxKnownLiveMembership(
          sets,
          maxKnownLiveBySetRef.current,
          paintedHonored,
          byIdHonored,
          honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
        ),
        itemTrash,
      );
      sets = applySetTrashTombstones(sets, quizSetTombstonesRef.current, {
        emptiedAt: readTrashEmptiedAt(),
      });
      const prunedLists = pruneQuizListsAgainstTrashState(
        honorQuizItemTrashTombstonesOnItems(nextQuizzes, itemTrash),
        sets,
      );
      sets = applyLocalQuizSetsListOrder(
        prunedLists.sets,
        quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal(),
      );
      quizSetsByIdCacheRef.current = pruneQuizListsAgainstTrashState(
        [],
        applySetTrashTombstones(
          honorQuizItemTrashTombstones(
            preferRicherQuizSetsMembership(byIdHonored, sets),
            itemTrash,
          ),
          quizSetTombstonesRef.current,
          { emptiedAt: readTrashEmptiedAt() },
        ),
      ).sets;
      const prevQ = quizzesRef.current;
      const quizzesHonored = prunedLists.quizzes;
      quizzesRef.current = quizzesHonored;
      quizSetsRef.current = sets;
      // Structure-first / empty UI: always hydrate shells before content-ready.
      // After cards are visible, block same-id HTML flips unless ById catch-up,
      // membership growth, newer bodies/order, or structural order/trash changes.
      let hydrateUi = opts?.forcePaint || shouldHydrateQuizSetsUi(paintedHonored, sets);
      if (hydrateUi && quizContentReadyRef.current && !opts?.forcePaint) {
        // Hard block: never paint shorter incomplete over last-good / painted.
        if (
          countLiveQuizItems(sets) < countLiveQuizItems(paintedHonored)
          && !shouldApplyBackgroundQuizUpdate(paintedHonored, sets)
        ) {
          hydrateUi = false;
        } else {
          const decision = decideQuizListsUiPaint({
            contentReady: quizContentReadyRef.current,
            revealedViaTimeout: quizRevealedViaTimeoutRef.current,
            seenAuthoritativeById: quizAuthoritativeByIdSeenRef.current,
            isAuthoritativeByIdMerge: !!opts?.isAuthoritativeByIdMerge,
            paintedSets: paintedHonored,
            nextSets: sets,
            paintedQuizzes,
            nextQuizzes: quizzesHonored,
            setsEqualForUI: quizSetsEqualForUI,
            quizzesEqualForUI,
          });
          if (!decision.paint) hydrateUi = false;
        }
      }
      if (hydrateUi) {
        if (!quizzesEqualForUI(quizzesHonored, prevQ) || !quizzesEqualForUI(quizzesHonored, paintedQuizzes)) {
          setQuizzes(quizzesHonored);
        }
        // Always setQuizSets on hydrate — equal-to-refs must not block empty UI.
        if (!quizSetsEqualForUI(sets, paintedHonored) || paintedHonored.length === 0) {
          setQuizSets(sets);
        }
        lastPaintedQuizzesRef.current = quizzesHonored;
        lastPaintedQuizSetsRef.current = sets;
        rememberQuizListsBootCache(quizzesHonored, sets);
        // Rewrite last-good whenever UI holds a complete authoritative snapshot.
        if (
          opts?.isAuthoritativeByIdMerge
          || quizAuthoritativeByIdSeenRef.current
          || quizContentReadyRef.current
        ) {
          persistLastGoodIfComplete(quizzesHonored, sets);
        }
      }
      if (
        opts?.persistLocal !== false
        && isQuizSetsLocalWriteSafe(sets, maxKnownLiveBySetRef.current, paintedHonored)
        // Never poison LS with an empty shell when we have ever had / know sets.
        && (countUserQuizSets(sets) > 0 || !everHadSetsRef.current)
      ) {
        safeSetItem('malacadhati_quiz_sets', JSON.stringify(sets));
        writeQuizSetsShellJournal(sets);
        safeSetItem('malacadhati_quiz', JSON.stringify(quizzesHonored));
      }
    };
    // Phase 0: IDB last-good complete cache (async, but local — beats network).
    // If sync LS last-good was missing (quota), this still paints correct 11 before ById.
    const idbLastGoodReady = (async () => {
      const idbTombs = await readQuizTrashTombstonesIdb();
      if (!cancelled && idbTombs) {
        quizItemTombstonesRef.current = mergeTombstoneMaps(quizItemTombstonesRef.current, idbTombs.items);
        quizSetTombstonesRef.current = mergeTombstoneMaps(quizSetTombstonesRef.current, idbTombs.sets);
        quizFolderTombstonesRef.current = mergeTombstoneMaps(quizFolderTombstonesRef.current, idbTombs.folders);
        noteTrashTombstonesRef.current = mergeTombstoneMaps(noteTrashTombstonesRef.current, idbTombs.notes ?? {});
        if (idbTombs.emptiedAt) writeTrashEmptiedAt(idbTombs.emptiedAt);
        if (idbTombs.permDeletedQuizzes?.length || idbTombs.permDeletedSets?.length || idbTombs.permDeletedFolders?.length) {
          permDeletedRef.current = addPermDeleted(permDeletedRef.current, {
            quizzes: idbTombs.permDeletedQuizzes,
            quizSets: idbTombs.permDeletedSets,
            quizFolders: idbTombs.permDeletedFolders,
          });
          writePermDeleted(permDeletedRef.current);
        }
        writeTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY, quizItemTombstonesRef.current);
        writeTrashTombstones(QUIZ_SET_TRASH_TOMBSTONE_KEY, quizSetTombstonesRef.current);
        writeTrashTombstones(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY, quizFolderTombstonesRef.current);
        writeTrashTombstones(NOTE_TRASH_TOMBSTONE_KEY, noteTrashTombstonesRef.current);
      }
      const idbLastGood = await readQuizCompleteCacheIdb();
      if (cancelled || !idbLastGood || !quizSetsHaveCompleteBodies(idbLastGood.sets)) return;
      const painted = lastPaintedQuizSetsRef.current;
      const paintedLive = countLiveQuizItems(painted);
      const cacheSets = overlayQuizTrashFlags(
        honorQuizItemTrashTombstones(
          applySetTrashTombstones(idbLastGood.sets, quizSetTombstonesRef.current, {
            emptiedAt: readTrashEmptiedAt(),
          }),
          quizItemTombstonesRef.current,
        ),
        painted,
        quizSetsRef.current,
      );
      const cacheLive = countLiveQuizItems(cacheSets);
      // A live last-good paint must still accept IDB when the drop is soft-trash.
      if (
        paintedLive > cacheLive
        && !quizSetsSoftTrashExplainsShrink(painted, cacheSets)
      ) {
        return;
      }
      const mergedSets = unionQuizSetsForCommit(cacheSets, quizSetsRef.current, local.sets);
      const mergedQuizzes = honorQuizItemTrashTombstonesOnItems(
        idbLastGood.quizzes.length ? idbLastGood.quizzes : local.quizzes,
        quizItemTombstonesRef.current,
      );
      local = { ...local, quizzes: mergedQuizzes, sets: mergedSets };
      quizzesRef.current = mergedQuizzes;
      quizSetsRef.current = mergedSets;
      bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, mergedSets);
      commitQuizListsLocal(mergedQuizzes, mergedSets, {
        persistLocal: false,
        forcePaint: !quizContentReadyRef.current || quizSetsSoftTrashExplainsShrink(painted, mergedSets),
      });
      markQuizLocalReady();
      markQuizContentReady('cache');
      persistLastGoodIfComplete(mergedQuizzes, mergedSets);
    })();
    // Phase 1 (fast): set shells only — tiny IDB store; unblocks "0 set" immediately.
    const durableSetsReady = (async () => {
      await idbLastGoodReady;
      const idbSets = await getAllQuizSetsLocal();
      if (cancelled) return;
      if (idbSets.length) {
        local = {
          ...local,
          sets: unionQuizSetsFromById(local.sets, idbSets, permDeletedRef.current),
        };
        quizSetsRef.current = local.sets;
        // Never force-paint incomplete IDB shells over last-good complete cache.
        commitQuizListsLocal(local.quizzes, local.sets, {
          persistLocal: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
          forcePaint: !quizContentReadyRef.current,
        });
      }
      if (local.sets.length > 0) markQuizLocalReady();
    })();
    // Phase 2: quiz item bodies + notes catch-up. Notes IDB already started above —
    // await it in parallel with set shells so Studerade never waits on quiz hydrate.
    const durableReady = (async () => {
      const [, idbQuizzes] = await Promise.all([
        Promise.all([durableSetsReady, notesIdbReady]),
        getAllQuizItemsLocal(),
      ]);
      if (cancelled) return;
      // notesIdbReady already painted; keep local.notes aligned with refs.
      local = { ...local, notes: notesRef.current };
      rememberNotesBootCache(notesRef.current, true);
      writeNotesListCache(notesRef.current);
      if (idbQuizzes.length) {
        const applied = applyDurableQuizItems(
          local.quizzes,
          local.sets,
          idbQuizzes.filter((row) => {
            const id = Number(row?.id);
            return Number.isFinite(id) && !permDeletedRef.current.quizzes.some((d) => Number(d) === id);
          }),
        );
        local = {
          ...local,
          quizzes: stripPermDeletedQuizzes(applied.quizzes, permDeletedRef.current),
          sets: stripPermDeletedQuizSets(applied.sets, permDeletedRef.current),
        };
        quizzesRef.current = local.quizzes;
        quizSetsRef.current = local.sets;
      }
      // Re-paint from IDB-enriched local (may grow item bodies / set shells).
      // If last-good already painted, do not force incomplete IDB over it.
      if (local.quizzes.length || local.sets.length) {
        commitQuizListsLocal(local.quizzes, local.sets, {
          // Online: paint IDB union but don't poison LS until ById catch-up.
          persistLocal: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
          forcePaint: !quizContentReadyRef.current,
        });
      }
      markQuizLocalReady();
      armQuizContentReadyTimeout();
    })();
    const storedCloudSyncAt = Number(localStorage.getItem(CLOUD_SYNCED_AT_KEY));
    if (storedCloudSyncAt > 0) setCloudSyncedAt(storedCloudSyncAt);

    const applyLocalCache = (opts?: { includeQuiz?: boolean }) => {
      const includeQuiz = opts?.includeQuiz !== false;
      if (local.notes.length) commitNotes(local.notes);
      if (local.chats.length) setChats(local.chats);
      if (local.folders.length) {
        setQuizFolders(ensureRestoredFolder(initializeQuizColors(local.folders)));
      }
      if (includeQuiz) {
        if (local.quizzes.length || local.sets.length) {
          commitQuizListsLocal(local.quizzes, local.sets);
        }
      }
      if (local.drafts.length) {
        const stamped = stampDrafts(local.drafts).filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id));
        setDrafts(stamped);
        draftsRef.current = stamped;
        draftCounter.current = maxDraftCounter(stamped) || stamped.length;
      }
    };

    const applyLocalFallback = () => {
      applyLocalCache({ includeQuiz: true });
      markQuizLocalReady();
      markQuizContentReady('fallback');
      const { drafts, counter } = resolveDraftsFromSources(null, local.drafts, pendingDeletedDraftIdsRef.current);
      draftCounter.current = counter;
      setDrafts(drafts);
    };

    // Notes/folders/drafts from LS; quiz already painted above (local-first).
    applyLocalCache({ includeQuiz: false });

    const ensureSeedDraft = () => {
      if (draftsRef.current.length) return;
      const id = allocateDraftId(draftCounter, [], pendingDeletedDraftIdsRef.current);
      pendingDeletedDraftIdsRef.current.delete(id);
      const seed = [{ id, title: '', html: '', updatedAt: Date.now() }];
      pendingLocalDraftIdsRef.current.add(id);
      setDrafts(seed);
      draftsRef.current = seed;
      draftCounter.current = 1;
      safeSetItem('malacadhati_drafts', JSON.stringify(seed));
    };
    ensureSeedDraft();
    draftsReadyRef.current = true;
    setDraftsReady(true);

    const bootstrapDraftsFromCloud = async () => {
      setDraftsLoading(true);
      try {
        const bundle = await fetchCloudDraftBundle(user.uid, () => user.getIdToken());
        if (cancelled) return;
        pendingDeletedDraftIdsRef.current = mergeDeletedDraftIds(pendingDeletedDraftIdsRef.current, bundle);
        if (typeof bundle.cloudSyncAt === 'number' && bundle.cloudSyncAt > 0) {
          setCloudSyncedAt(bundle.cloudSyncAt);
          safeSetItem(CLOUD_SYNCED_AT_KEY, String(bundle.cloudSyncAt));
          lastAppliedRemoteSyncAt.current = bundle.cloudSyncAt;
        }
        const cloudDrafts = parseCloudDrafts(bundle);
        lastCloudDraftIdsRef.current = new Set(cloudDrafts.map((d) => d.id));
        const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
        const merged = recentDraftEdit
          ? filterVisibleDrafts(draftsRef.current, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current)
          : mergeDraftsForPull(
            draftsRef.current,
            cloudDrafts.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id)),
            bundle,
            pendingDeletedDraftIdsRef.current,
            pendingLocalDraftIdsRef.current,
          );
        if (JSON.stringify(merged) !== JSON.stringify(draftsRef.current)) {
          setDrafts(merged);
          draftsRef.current = merged;
          draftCounter.current = syncDraftCounter(
            (bundle.draftId as number | undefined) || 0,
            merged,
            pendingDeletedDraftIdsRef.current,
          );
          safeSetItem('malacadhati_drafts', JSON.stringify(merged));
        }
      } catch {
        /* fast draft bootstrap is best-effort */
      } finally {
        if (!cancelled) setDraftsLoading(false);
      }
    };
    void bootstrapDraftsFromCloud();

    // Start structure ById immediately (parallel with IDB item bodies) so empty LS
    // still hydrates set shells without waiting on giant quizItemsById.
    const foldersCloudPromise = fetchQuizFoldersByIdCloud(user.uid);
    const setsCloudPromise = fetchQuizSetsByIdCloud(user.uid);
    const cloudStructurePromise = Promise.all([setsCloudPromise, foldersCloudPromise]);
    // Tiny catalog (folders + set shells) — paint sidebar before heavy ById finishes.
    const quizCatalogPromise = prefetchQuizCatalog(user.uid);
    // Notes cloud fetch is independent of quiz — apply as soon as IDB+cloud are ready
    // (morning-fast path). Do NOT wait for durableSetsReady / last-good quiz.
    const notesCloudGenAtStart = notesCloudGenRef.current;
    const notesCloudPromise = fetchNotesByIdCloud(user.uid);
    const quizItemsCloudPromise = fetchQuizItemsByIdCloud(user.uid);
    const cloudBodiesPromise = Promise.all([notesCloudPromise, quizItemsCloudPromise]);

    const applyNotesSnapshot = (incoming: Note[], allowNewIds = true) => {
      if (cancelled || !incoming.length) return;
      const safe = incomingNotesSafe(incoming, allowNewIds);
      if (!safe.length) return;
      rememberServerNotesCatalog(safe);
      commitNotes(adoptNotesSafe(notesRef.current, safe, true, allowNewIds));
    };

    const hydrateMissingNoteBodies = async () => {
      const missing = notesRef.current.filter((n) => !noteHasDisplayableImage(n.html));
      if (!missing.length) return;
      let cursor = 0;
      const worker = async () => {
        while (cursor < missing.length && !cancelled) {
          const note = missing[cursor++];
          const one = await fetchNoteByIdCloud(user.uid, Number(note.id));
          if (one) applyNotesSnapshot([one]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, missing.length) }, () => worker()));
    };

    // Pull photo bodies immediately. Do NOT wait on the giant notesById tree —
    // that download times out on hospital Wi-Fi while a third PC on normal
    // internet succeeds, which is why only one machine was missing images.
    void hydrateMissingNoteBodies();

    // Cloud notes enrich in the background — never block first paint on the network.
    const notesCloudReady = (async () => {
      await notesIdbReady;
      if (cancelled) return;
      try {
        const cloudNotes = await notesCloudPromise;
        if (!cancelled && cloudNotes.length) {
          applyNotesSnapshot(cloudNotes, notesCloudGenAtStart === notesCloudGenRef.current);
        }
      } catch { /* ignore */ }
      if (cancelled) return;
      try {
        const keys = await fetchNotesByIdKeysCloud(user.uid);
        const have = new Set(notesRef.current.map((n) => Number(n.id)));
        const missingIds = keys.filter((id) => !have.has(id));
        if (missingIds.length) {
          const incoming: Note[] = [];
          let cursor = 0;
          const worker = async () => {
            while (cursor < missingIds.length && !cancelled) {
              const one = await fetchNoteByIdCloud(user.uid, missingIds[cursor++]);
              if (one) incoming.push(one);
            }
          };
          await Promise.all(Array.from({ length: Math.min(6, missingIds.length) }, () => worker()));
          if (incoming.length) applyNotesSnapshot(incoming);
        }
      } catch { /* ignore */ }
      if (!cancelled) await hydrateMissingNoteBodies();
    })();

    (async () => {
      try {
        // Tiny catalog first — sidebar folders/sets before multi-MB ById.
        try {
          const catalog = await quizCatalogPromise;
          if (!cancelled && (catalog.folders.length || catalog.sets.length)) {
            if (catalog.folders.length) {
              const mergedFolders = applyTrashTombstones(
                mergeFoldersForSync(quizFoldersRef.current, catalog.folders, permDeletedRef.current, {
                  remoteIsAuthority: true,
                }),
                quizFolderTombstonesRef.current,
              );
              quizFoldersRef.current = mergedFolders;
              setQuizFolders(finalizeQuizFolders(mergedFolders, quizSetsRef.current));
              safeSetItem('malacadhati_quiz_folders', JSON.stringify(mergedFolders));
            }
            if (catalog.sets.length) {
              const mergedSets = preferRicherQuizSetsMembership(
                honorQuizItemTrashTombstones(quizSetsRef.current, quizItemTombstonesRef.current),
                catalog.sets,
              );
              quizSetsRef.current = mergedSets;
              setQuizSets(mergedSets);
              lastPaintedQuizSetsRef.current = mergedSets;
              writeQuizSetsShellJournal(mergedSets);
              markQuizLocalReady();
            }
          }
        } catch { /* ignore */ }

        // Folders ById is tiny — paint as soon as it lands (do not wait on sets ById).
        void foldersCloudPromise.then((cloudFoldersById) => {
          if (cancelled || !cloudFoldersById.length) return;
          quizFoldersByIdCacheRef.current = cloudFoldersById;
          const mergedFolders = applyTrashTombstones(
            mergeFoldersForSync(quizFoldersRef.current, cloudFoldersById, permDeletedRef.current, {
              remoteIsAuthority: true,
            }),
            quizFolderTombstonesRef.current,
          );
          quizFoldersRef.current = mergedFolders;
          setQuizFolders(finalizeQuizFolders(mergedFolders, quizSetsRef.current));
          safeSetItem('malacadhati_quiz_folders', JSON.stringify(mergedFolders));
          markQuizLocalReady();
        });

        // Structure path: journal + IDB set shells only — not heavy item bodies.
        await Promise.all([journalReady, durableSetsReady]);
        if (cancelled) return;

        const [cloudSetsById, cloudFoldersById] = await cloudStructurePromise;
        if (cancelled) return;
        // Kick off in parallel with everything below — awaited right before the
        // final boot merge so the network round trip never adds to boot latency.
        const trashTombstonesPromise = fetchCloudTrashTombstones(user.uid);
        if (cloudSetsById.length) {
          // Union into cache — never replace wholesale with a shorter ById shell.
          quizSetsByIdCacheRef.current = preferRicherQuizSetsMembership(
            quizSetsByIdCacheRef.current,
            cloudSetsById,
            quizSetsRef.current,
          );
          bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, quizSetsByIdCacheRef.current);
          const mergedSets = honorQuizItemTrashTombstones(
            applyTrashTombstones(
              preferRicherQuizSetsMembership(
                quizSetsRef.current,
                cloudSetsById,
                quizSetsByIdCacheRef.current,
              ),
              quizSetTombstonesRef.current,
            ),
            quizItemTombstonesRef.current,
          );
          quizSetsRef.current = mergedSets;
          quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
            quizSetsByIdCacheRef.current,
            quizItemTombstonesRef.current,
          );
          local = { ...local, sets: mergedSets };
        }
        if (cloudFoldersById.length) {
          quizFoldersByIdCacheRef.current = cloudFoldersById;
          const mergedFolders = applyTrashTombstones(
            mergeFoldersForSync(quizFoldersRef.current, cloudFoldersById, permDeletedRef.current, {
              remoteIsAuthority: true,
            }),
            quizFolderTombstonesRef.current,
          );
          quizFoldersRef.current = mergedFolders;
          setQuizFolders(mergedFolders);
          local = { ...local, folders: mergedFolders };
        }
        // Paint set/folder shells now — empty UI must accept non-empty ById (emergency).
        commitQuizListsLocal(quizzesRef.current, quizSetsRef.current, {
          forcePaint: lastPaintedQuizSetsRef.current.length === 0 && quizSetsRef.current.length > 0,
        });
        if (quizSetsRef.current.length > 0) markQuizLocalReady();

        // Item/note bodies: local IDB + cloud ById in parallel — enrich without clearing shells.
        const [, [cloudNotesById, cloudQuizItemsById]] = await Promise.all([
          Promise.all([durableReady, notesCloudReady]),
          cloudBodiesPromise,
        ]);
        if (cancelled) return;
        // Notes usually already painted via notesCloudReady; re-apply only if richer.
        applyNotesSnapshot(cloudNotesById, notesCloudGenAtStart === notesCloudGenRef.current);
        // Fold cloud ById items into refs, then commit once. First visible card
        // bodies should be this merge (not stale IDB alone) — no old→new FOUC.
        if (cloudQuizItemsById.length) {
          const earlyDead = new Set(permDeletedRef.current.quizzes);
          const applied = applyDurableQuizItems(
            quizzesRef.current,
            quizSetsRef.current,
            cloudQuizItemsById.filter((row) => {
              const id = Number(row?.id);
              return Number.isFinite(id) && !earlyDead.has(id);
            }),
          );
          quizzesRef.current = applied.quizzes.filter((q) => !earlyDead.has(q.id));
          quizSetsRef.current = stripPermDeletedQuizSets(applied.sets, permDeletedRef.current);
          local = { ...local, quizzes: quizzesRef.current, sets: quizSetsRef.current };
        }
        commitQuizListsLocal(quizzesRef.current, quizSetsRef.current, {
          isAuthoritativeByIdMerge: true,
          // Ensure the authoritative snapshot reaches React even if equal-count
          // local shells already painted for the sidebar.
          forcePaint: !quizContentReadyRef.current || quizRevealedViaTimeoutRef.current,
        });
        if (cloudQuizItemsById.length || cloudSetsById.length) {
          markQuizContentReady('byid');
        } else if (!quizContentReadyRef.current) {
          markQuizContentReady('fallback');
        }
        // Always rewrite last-good after a successful ById merge (self-heal 9→11).
        persistLastGoodIfComplete(quizzesRef.current, quizSetsRef.current);

        const cloud = await fetchCloudSyncBundle(user.uid);
        if (!cloud) throw new Error('cloud-fetch-failed');
        cloudLoadSucceededRef.current = true;
        if (cancelled) return;

        if (cloud?.tokenUsage) {
          setTokenUsage(cloud.tokenUsage as number);
        }

        if (typeof cloud?.cloudSyncAt === 'number' && cloud.cloudSyncAt > 0) {
          setCloudSyncedAt(cloud.cloudSyncAt);
          safeSetItem(CLOUD_SYNCED_AT_KEY, String(cloud.cloudSyncAt));
          lastAppliedRemoteSyncAt.current = cloud.cloudSyncAt;
        }

        pendingDeletedDraftIdsRef.current = mergeDeletedDraftIds(pendingDeletedDraftIdsRef.current, cloud);
        permDeletedRef.current = mergePermDeleted(permDeletedRef.current, cloud);
        const emptiedAtBoot = mergeTrashEmptiedAt(cloud);
        quizSetTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
          quizSetTombstonesRef.current,
          QUIZ_SET_TRASH_TOMBSTONE_KEY,
          emptiedAtBoot,
        );
        quizFolderTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
          quizFolderTombstonesRef.current,
          QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
          emptiedAtBoot,
        );
        quizItemTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
          quizItemTombstonesRef.current,
          QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
          emptiedAtBoot,
        );
        noteTrashTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
          noteTrashTombstonesRef.current,
          NOTE_TRASH_TOMBSTONE_KEY,
          emptiedAtBoot,
        );
        const tombstones = {
          ...permDeletedRef.current,
          notes: [...new Set([
            ...permDeletedRef.current.notes,
            ...pruneRejectedNoteIds(rejectedNoteIdsRef.current),
          ])],
        };

        // Heal orphaned ById rows left by older Empty Trash (merge-only maps never)
        // deleted keys). Destroy them so they cannot re-enter Trash on this boot.
        const deadSetIds = new Set(tombstones.quizSets);
        const deadFolderIds = new Set(tombstones.quizFolders);
        const deadQuizIds = new Set(tombstones.quizzes);
        for (const row of cloudSetsById) {
          if (!row?.id) continue;
          if (deadSetIds.has(row.id) || (row.trashed && emptiedAtBoot && entitySyncTime(row) <= emptiedAtBoot)) {
            void remove(dbRef(database, `users/${user.uid}/quizSetsById/${row.id}`)).catch(() => {});
          }
        }
        for (const row of cloudFoldersById) {
          if (!row?.id) continue;
          if (deadFolderIds.has(row.id) || (row.trashed && emptiedAtBoot && entitySyncTime(row) <= emptiedAtBoot)) {
            void remove(dbRef(database, `users/${user.uid}/quizFoldersById/${row.id}`)).catch(() => {});
          }
        }
        // Do NOT mass-delete quizItemsById here — that saturated the socket for
        // ~30s after Trash X (every boot re-DELETEd every tombstoned id). Dead
        // rows are ignored by merge/UI filters; permDelete/emptyTrash scrub one id.
        quizSetsByIdCacheRef.current = preferRicherQuizSetsMembership(
          quizSetsByIdCacheRef.current,
          cloudSetsById.filter((row) => (
            row?.id
            && !deadSetIds.has(row.id)
            && !(row.trashed && emptiedAtBoot && entitySyncTime(row) <= emptiedAtBoot)
          )),
          quizSetsRef.current,
        );
        quizFoldersByIdCacheRef.current = cloudFoldersById.filter((row) => (
          row?.id
          && !deadFolderIds.has(row.id)
          && !(row.trashed && emptiedAtBoot && entitySyncTime(row) <= emptiedAtBoot)
        ));

        // This whole initial-load chain makes several sequential network round
        // trips (main fetch, folders, sets, history snapshots) and can take many
        // seconds on a slow connection. `local` was captured once at effect start;
        // if the user adds/edits a note or quiz question while this chain is still
        // in flight, merging against that stale snapshot here would silently wipe
        // the fresh edit the moment this chain finally resolves and calls setState.
        // Re-read the live refs right before each merge so any concurrent edit is
        // folded in instead of overwritten.
        const liveNotes = notesRef.current;
        const liveQuizzes = quizzesRef.current;
        const liveChats = chatsRef.current;

        const cloudNotes = cloud ? firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>) : [];
        let notes = filterResurrectedTrash(mergeNotesForSync(liveNotes, cloudNotes, tombstones), liveNotes);
        let notesRepair = notes.length > cloudNotes.length
          || (liveNotes.length > 0 && cloudNotes.length === 0)
          || (liveNotes.length > 0 && notes.length > cloudNotes.length);

        const cloudQuizzes = cloud ? firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>) : [];
        let quizzes = filterResurrectedTrash(mergeQuizzesForSync(liveQuizzes, cloudQuizzes, tombstones), liveQuizzes);
        let quizzesRepair = quizzes.length > cloudQuizzes.length
          || (liveQuizzes.length > 0 && cloudQuizzes.length === 0);

        const cloudChatsRaw = cloud ? firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>) : [];
        let chats = mergeChatsForSync(liveChats, cloudChatsRaw).map((c) => ({
          ...c,
          messages: c.messages ?? [],
        }));
        let chatsRepair = chats.length > cloudChatsRaw.length
          || (liveChats.length > 0 && cloudChatsRaw.length === 0);

        let historyRepair = false;

        if (notes.length === 0 && cloud?.draftContents && typeof cloud.draftContents === 'object') {
          const fromDrafts = recoverNotesFromDraftContents(cloud.draftContents as Record<string, { title?: string; html?: string }>);
          if (fromDrafts.length > 0) {
            notes = fromDrafts;
            notesRepair = true;
            historyRepair = true;
            recoveryLog('recovered notes from draftContents', { count: fromDrafts.length });
          }
        }

        if (notes.length === 0) {
          const historySnapshot = await fetchLatestDataHistorySnapshot(user.uid);
          if (historySnapshot?.notes.length) {
            notes = mergeNotesForSync(notes, historySnapshot.notes.filter((n) => !n.trashed), tombstones);
            notesRepair = true;
            historyRepair = true;
            recoveryLog('recovered notes from latest dataHistory', { count: notes.length });
          }
        }

        const historySnapshots = await fetchAllDataHistorySnapshots(user.uid);
        for (const snapshot of historySnapshots) {
          const liveTombs = {
            ...permDeletedRef.current,
            notes: [...new Set([
              ...permDeletedRef.current.notes,
              ...pruneRejectedNoteIds(rejectedNoteIdsRef.current),
            ])],
          };
          const trashedIds = new Set(
            notes.filter((n) => n.trashed).map((n) => Number(n.id)),
          );
          for (const id of localTrashIdsRef.current) trashedIds.add(id);
          const before = notes.length;
          notes = mergeNotesForSync(
            notes,
            snapshot.notes.filter((n) => !n.trashed && !trashedIds.has(Number(n.id))),
            liveTombs,
          );
          if (notes.length > before) {
            notesRepair = true;
            historyRepair = true;
            recoveryLog('restored notes from dataHistory snapshot', { before, after: notes.length, savedAt: snapshot.savedAt });
          }
          const quizzesBefore = quizzes.length;
          quizzes = mergeQuizzesForSync(quizzes, snapshot.quizzes.filter((q) => !q.trashed), tombstones);
          if (quizzes.length > quizzesBefore) quizzesRepair = true;
        }

        // Re-apply durable single-item mirrors AFTER the giant-array merge so a
        // stale/incomplete notes[] can never wipe a note that notesById / IndexedDB
        // already holds (the exact failure mode for image notes on refresh).
        const idbNotesAgain = await getAllNotesLocal();
        const liveTombs = {
          ...permDeletedRef.current,
          notes: [...new Set([
            ...permDeletedRef.current.notes,
            ...pruneRejectedNoteIds(rejectedNoteIdsRef.current),
          ])],
        };
        const durableNotes = filterBlockedNotes(
          mergeNotesPreferRicher(cloudNotesById, idbNotesAgain),
          liveTombs,
          rejectedNoteIdsRef.current,
        );
        if (durableNotes.length) {
          const before = notes.length;
          notes = filterBlockedNotes(
            mergeNotesPreferRicher(notes, durableNotes),
            liveTombs,
            rejectedNoteIdsRef.current,
          );
          if (notes.length > before) notesRepair = true;
        }
        {
          const idbQuizzesAgain = await getAllQuizItemsLocal();
          const appliedQ = applyDurableQuizItems(quizzes, [], [...cloudQuizItemsById, ...idbQuizzesAgain]);
          quizzes = appliedQ.quizzes;
        }

        commitNotes(mergeNotesPreferRicher(notesRef.current, notes));
        safeSetItem('malacadhati', JSON.stringify(notesRef.current));

        setQuizzes(quizzes);
        quizzesRef.current = quizzes;
        safeSetItem('malacadhati_quiz', JSON.stringify(quizzes));

        setChats(chats);
        safeSetItem('malacadhati_chats', JSON.stringify(chats));

        const cloudFolders = cloud ? firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>) : [];
        const cloudSets = cloud
          ? firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] }))
          : [];
        // These used to be two extra reads of /quizFolders and /quizSets — the
        // very nodes the bundle above already fetched. quizSets carries every
        // question and inline image, so re-downloading it doubled boot traffic.
        const dedicatedFolders = cloudFolders;
        const dedicatedSets = cloudSets;
        const cloudFoldersEmpty = cloud && 'quizFolders' in cloud && cloudFolders.length === 0;
        const cloudSetsEmpty = cloud && 'quizSets' in cloud && cloudSets.length === 0;
        const dedicatedFoldersEmpty = dedicatedFolders.length === 0;
        const dedicatedSetsEmpty = dedicatedSets.length === 0;

        // Re-read live refs again here (not the stale `local` from effect start —
        // see comment above): two more awaited network calls (folders + sets)
        // happened since the last snapshot, widening the window for a concurrent
        // quiz save to have landed. Merging against a live ref instead of the
        // original snapshot is what stops a just-saved question from being wiped
        // out when this load finally resolves and calls setQuizSets/setQuizFolders.
        const liveFolders = quizFoldersRef.current;
        const liveSets = quizSetsRef.current;

        let rawFolders = filterResurrectedTrash(
          mergeFoldersForSync(
            liveFolders,
            mergeById(cloudFolders, dedicatedFolders, cloudFoldersById),
            tombstones,
            { remoteIsAuthority: cloudFoldersById.length > 0 || !!(cloud && 'quizFolders' in cloud) },
          ),
          liveFolders,
          quizFolderTombstonesRef.current,
        );
        let rawSets: QuizSet[] = filterResurrectedTrash(
          mergeQuizSetsForSync(
            liveSets,
            // Prefer ById membership when giant array is a stale shorter shell.
            adoptByIdMembershipWhenRicher(
              mergeQuizSetsForSync(cloudSets, dedicatedSets, tombstones),
              cloudSetsById,
            ),
            tombstones,
          ),
          liveSets,
          quizSetTombstonesRef.current,
        );
        // Re-apply ById + local durable shells after array merge so a stale
        // quizSets[] cannot drop a set that already landed in quizSetsById /
        // IndexedDB (create-then-refresh). Membership-only — never Manual order.
        if (cloudSetsById.length) {
          rawSets = preferRicherQuizSetsMembership(rawSets, cloudSetsById, quizSetsByIdCacheRef.current);
        }
        {
          const idbSetsFinal = await getAllQuizSetsLocal();
          if (idbSetsFinal.length) {
            rawSets = unionQuizSetsFromById(rawSets, idbSetsFinal, tombstones);
          }
          rawSets = mergeSetsWithShellJournal(rawSets);
        }
        if (cloudFoldersById.length) {
          rawFolders = mergeFoldersForSync(rawFolders, cloudFoldersById, tombstones, {
            remoteIsAuthority: true,
          });
        }
        let repairQuizStructure = false;
        // Do NOT re-inject liveFolders when cloud folders are empty — that is how
        // a long-deleted "mapp" on a work PC got written back to the cloud.
        if (countUserQuizSets(rawSets) === 0 && liveSets.some((set) => !set.system)) {
          rawSets = mergeById(rawSets, liveSets);
          repairQuizStructure = true;
        }
        // Fuller merged membership must heal incomplete cloud quizSets[] (classic 10→3).
        if (countLiveQuizItems(rawSets) > countLiveQuizItems(cloudSets)) {
          repairQuizStructure = true;
        }
        if (quizzes.length === 0) {
          const fromSets = rawSets.flatMap((set) => set.items ?? []).filter((item) => item && !item.trashed);
          if (fromSets.length > 0) {
            quizzes = fromSets;
            quizzesRepair = true;
            historyRepair = true;
            recoveryLog('recovered quizzes from quiz set items', { count: fromSets.length });
            setQuizzes(quizzes);
            safeSetItem('malacadhati_quiz', JSON.stringify(quizzes));
          }
        }

        if (
          countUserQuizFolders(rawFolders) === 0
          && (cloudFoldersEmpty || dedicatedFoldersEmpty)
        ) {
          // Do NOT auto-merge quizFoldersHistory — that resurrected long-deleted
          // folders (e.g. "mapp") on work PCs. Explicit recover UI still can.
        }

        // Union local tombstones with cloud's (multi-device deletes) right before
        // the final heal pass, then force `trashed` back onto any row a stale/
        // incomplete cloud array or the repair steps above tried to resurrect.
        const cloudTrashTombstones = await trashTombstonesPromise;
        quizSetTombstonesRef.current = mergeTrashTombstones(
          QUIZ_SET_TRASH_TOMBSTONE_KEY,
          quizSetTombstonesRef.current,
          cloudTrashTombstones.sets,
        );
        quizFolderTombstonesRef.current = mergeTrashTombstones(
          QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
          quizFolderTombstonesRef.current,
          cloudTrashTombstones.folders,
        );
        quizItemTombstonesRef.current = mergeTrashTombstones(
          QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
          quizItemTombstonesRef.current,
          cloudTrashTombstones.items,
        );
        noteTrashTombstonesRef.current = mergeTrashTombstones(
          NOTE_TRASH_TOMBSTONE_KEY,
          noteTrashTombstonesRef.current,
          cloudTrashTombstones.notes,
        );
        rawSets = honorQuizItemTrashTombstones(
          applyTrashTombstones(rawSets, quizSetTombstonesRef.current),
          quizItemTombstonesRef.current,
        );
        rawFolders = applyTrashTombstones(rawFolders, quizFolderTombstonesRef.current);
        quizzes = honorQuizItemTrashTombstonesOnItems(quizzes, quizItemTombstonesRef.current);

        const normalizedFolders = finalizeQuizFolders(rawFolders, rawSets);
        let normalizedSets = initializeQuizColors(
          rawSets,
          normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
        );
        {
          // Tiny Manual-order mirror — restores Egen order when ById scramble wins.
          try {
            const orderRes = await rtdbFetch(`/users/${user.uid}/quizSetsListOrder`);
            if (orderRes.ok) {
              ingestQuizSetsListOrder(await orderRes.json());
            }
          } catch { /* ignore */ }
          // Never invent order from a possibly scrambled ById union — only apply
          // a durable list (local or cloud). Seeding here used to lock bad order in.
          normalizedSets = applyStoredQuizSetsListOrder(normalizedSets);
        }
        {
          const idbQuizzesFinal = await getAllQuizItemsLocal();
          const durableBody = [...cloudQuizItemsById, ...idbQuizzesFinal].filter((row) => {
            const id = Number(row?.id);
            if (!Number.isFinite(id)) return false;
            if (deadQuizIds.has(id)) return false;
            if (row.trashed && emptiedAtBoot && entitySyncTime(row) <= emptiedAtBoot) return false;
            return true;
          });
          const applied = applyDurableQuizItems(quizzes, normalizedSets, durableBody);
          quizzes = honorQuizItemTrashTombstonesOnItems(applied.quizzes, quizItemTombstonesRef.current)
            .filter((q) => !deadQuizIds.has(Number(q.id)));
          normalizedSets = applyStoredQuizSetsListOrder(
            stripPermDeletedQuizSets(
              honorQuizItemTrashTombstones(applied.sets, quizItemTombstonesRef.current),
              tombstones,
            ),
          );
          // Membership vs last *painted* UI: timeout may have shown local-9 while
          // refs already absorbed a richer merge — always surface 9→11 here.
          // After authoritative ById, same-id HTML echoes are skipped by decide.
          const needsByIdCatchup = quizRevealedViaTimeoutRef.current && !quizAuthoritativeByIdSeenRef.current;
          commitQuizListsLocal(quizzes, normalizedSets, {
            isAuthoritativeByIdMerge: needsByIdCatchup,
            forcePaint: lastPaintedQuizSetsRef.current.length === 0 && normalizedSets.length > 0,
          });
          if (needsByIdCatchup) {
            quizAuthoritativeByIdSeenRef.current = true;
            quizRevealedViaTimeoutRef.current = false;
          }
        }
        persistLastGoodIfComplete(quizzesRef.current, quizSetsRef.current);
        setQuizFolders(normalizedFolders);
        safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
        markQuizContentReady(quizAuthoritativeByIdSeenRef.current ? 'byid' : 'fallback');

        const liveNormalized = countLiveQuizItems(quizSetsRef.current);
        const liveCloud = countLiveQuizItems(cloudSets);
        const maxKnownLive = [...maxKnownLiveBySetRef.current.values()].reduce((a, b) => a + b, 0);
        // Never heal-push a shorter items[] snapshot over richer cloud/local/known.
        const safeToPushQuizSets = liveNormalized >= liveCloud
          && liveNormalized >= maxKnownLive;
        const needsMembershipHeal = quizSetsRemoteMembershipIncomplete(quizSetsRef.current, cloudSets)
          || quizSetsMissingFromRemote(quizSetsRef.current, cloudSets);
        // Never treat local-only folders as repair authority — that re-uploaded
        // deleted folders from a stale work-PC cache.
        const needsRepair = notesRepair || quizzesRepair || chatsRepair || repairQuizStructure || historyRepair
          || needsMembershipHeal
          || (cloudSetsEmpty && dedicatedSetsEmpty && liveSets.length > 0);
        recoveryLog('load complete', {
          notes: notes.length,
          quizzes: quizzes.length,
          chats: chats.length,
          userFolders: countUserQuizFolders(normalizedFolders),
          userSets: countUserQuizSets(normalizedSets),
          needsRepair,
          notesFromLocal: notesRepair && !historyRepair,
          quizzesFromLocal: quizzesRepair && !historyRepair,
          chatsFromLocal: chatsRepair && !historyRepair,
          quizStructureFromLocal: repairQuizStructure,
          fromCloudHistory: historyRepair,
        });
        markEverHadContent(notes, quizzes, quizSetsRef.current);
        // Keep the tiny sidebar catalog fresh so the next device paints folders/sets instantly.
        void writeQuizCatalogCloud(user.uid, quizFoldersRef.current, quizSetsRef.current);
        if (needsRepair) {
          recoveryLog('repairing cloud from local/history');
          const repairBody: Record<string, unknown> = { chats };
          // Folders: quizFoldersById is the source — never PATCH/PUT the array from
          // a local ghost list (that resurrected deleted folders like "mapp").
          if (notesRef.current.length > 0) repairBody.notes = notesRef.current;
          if (quizzes.length > 0) repairBody.quizzes = quizzes;
          if (safeToPushQuizSets && countUserQuizSets(quizSetsRef.current) > 0) {
            repairBody.quizSets = quizSetsRef.current;
          }
          void rtdbFetch(`/users/${user.uid}`, {
            method: 'PATCH',
            body: JSON.stringify(repairBody),
            headers: { 'Content-Type': 'application/json' },
          });
          if (
            safeToPushQuizSets
            && (repairQuizStructure || (cloudSetsEmpty && dedicatedSetsEmpty && liveSets.length > 0))
          ) {
            void rtdbFetch(`/users/${user.uid}/quizSets`, {
              method: 'PUT',
              body: JSON.stringify(quizSetsRef.current),
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }

        const cloudDrafts = parseCloudDrafts(cloud);
        lastCloudDraftIdsRef.current = new Set(cloudDrafts.map((d) => d.id));
        const bestLocalDrafts = mergeDraftsForSync(stampDrafts(local.drafts), draftsRef.current)
          .filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id));
        const { drafts: resolvedDrafts, counter: resolvedCounter } = resolveDraftsFromSources(cloud, bestLocalDrafts, pendingDeletedDraftIdsRef.current);
        const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
        let finalDrafts = recentDraftEdit
          ? filterVisibleDrafts(draftsRef.current, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current)
          : mergeDraftsForPull(
            draftsRef.current,
            resolvedDrafts,
            cloud,
            pendingDeletedDraftIdsRef.current,
            pendingLocalDraftIdsRef.current,
          );
        for (const d of draftsRef.current) {
          if (pendingLocalDraftIdsRef.current.has(d.id) && !finalDrafts.some((item) => item.id === d.id)) {
            finalDrafts = [...finalDrafts, d];
          }
        }
        finalDrafts = filterVisibleDrafts(finalDrafts, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current);
        const cloudDraftContentLen = cloudDrafts.reduce((sum, d) => sum + draftContentLength(d), 0);
        const resolvedDraftContentLen = finalDrafts.reduce((sum, d) => sum + draftContentLength(d), 0);
        const draftsRepair = resolvedDraftContentLen > cloudDraftContentLen
          || finalDrafts.length > cloudDrafts.length
          || (bestLocalDrafts.length > 0 && hasDraftContent(finalDrafts) && !hasDraftContent(cloudDrafts));
        setDrafts(finalDrafts);
        draftsRef.current = finalDrafts;
        draftCounter.current = syncDraftCounter(
          resolvedCounter,
          finalDrafts,
          pendingDeletedDraftIdsRef.current,
        );
        safeSetItem('malacadhati_drafts', JSON.stringify(finalDrafts));
        if (draftsRepair) {
          recoveryLog('repairing cloud drafts from local');
          const draftContents: Record<string, { title: string; html: string; updatedAt?: number }> = {};
          finalDrafts.forEach((d) => {
            draftContents[d.id] = { title: d.title, html: d.html, updatedAt: d.updatedAt ?? Date.now() };
          });
          for (const id of pendingDeletedDraftIdsRef.current) {
            draftContents[id] = null as unknown as { title: string; html: string; updatedAt?: number };
          }
          void rtdbFetch(`/users/${user.uid}`, {
            method: 'PATCH',
            body: JSON.stringify({
              drafts: finalDrafts.map((d) => d.id),
              draftId: resolvedCounter,
              draftContents,
            }),
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {
        if (cancelled) return;
        recoveryLog('cloud fetch failed, applying local fallback', {
          notes: local.notes.length,
          quizzes: local.quizzes.length,
          folders: local.folders.length,
          sets: local.sets.length,
        });
        applyLocalFallback();
      } finally {
        if (!cancelled) {
          loadedRef.current = true;
          setLoaded(true);
          quizLocalReadyRef.current = true;
          setQuizLocalReady(true);
          markQuizContentReady(quizAuthoritativeByIdSeenRef.current ? 'byid' : 'fallback');
          if (user) {
            if (cloudLoadSucceededRef.current) {
              setCloudStatus('saved');
            } else if (
              isEmptyUserPayload(
                notesRef.current,
                quizzesRef.current,
                chatsRef.current,
                quizSetsRef.current,
                quizFoldersRef.current,
                draftsRef.current,
              )
            ) {
              setCloudStatus('error');
            } else {
              setCloudStatus('idle');
            }
          }
          if (hasDraftContent(draftsRef.current)) {
            pendingDraftCloudSaveRef.current = true;
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      if (quizContentReadyTimer) clearTimeout(quizContentReadyTimer);
    };
  }, [user]);

  /**
   * Single remote commit path for quiz sets (notes-like).
   * Union with refs + ById + last painted + max-known floor — never paint/write a shrink.
   * Empty local/painted never blocks a non-empty cloud/ById hydrate into React.
   */
  const commitQuizSetsFromRemote = (incoming: QuizSet[]) => {
    const painted = lastPaintedQuizSetsRef.current;
    const itemTrash = quizItemTombstonesRef.current;
    const byIdHonored = honorQuizItemTrashTombstones(quizSetsByIdCacheRef.current, itemTrash);
    const paintedHonored = honorQuizItemTrashTombstones(painted, itemTrash);
    let next = unionQuizSetsForCommit(
      honorQuizItemTrashTombstones(incoming, itemTrash),
      paintedHonored,
      honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
      byIdHonored,
    );
    next = honorQuizItemTrashTombstones(
      adoptByIdMembershipWhenRicher(next, byIdHonored),
      itemTrash,
    );
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, next);
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, byIdHonored);
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, paintedHonored);
    next = honorQuizItemTrashTombstones(
      enforceMaxKnownLiveMembership(
        next,
        maxKnownLiveBySetRef.current,
        paintedHonored,
        byIdHonored,
        honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
      ),
      itemTrash,
    );
    next = stripPermDeletedQuizSets(next, permDeletedRef.current);
    quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
      preferRicherQuizSetsMembership(byIdHonored, next),
      itemTrash,
    );
    quizSetsByIdCacheRef.current = stripPermDeletedQuizSets(
      quizSetsByIdCacheRef.current,
      permDeletedRef.current,
    );
    quizSetsRef.current = next;
    // Hydrate UI from last *painted* baseline — not refs (often already equal).
    if (shouldHydrateQuizSetsUi(paintedHonored, next) || (paintedHonored.length === 0 && next.length > 0)) {
      if (!quizSetsEqualForUI(next, paintedHonored) || paintedHonored.length === 0) {
        setQuizSets(next);
      }
      lastPaintedQuizSetsRef.current = next;
      rememberQuizListsBootCache(quizzesRef.current, next);
    }
    if (
      isQuizSetsLocalWriteSafe(next, maxKnownLiveBySetRef.current, paintedHonored)
      && (countUserQuizSets(next) > 0 || !everHadSetsRef.current)
    ) {
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
      writeQuizSetsShellJournal(next);
    }
    return next;
  };

  // `skipDirectPut` avoids double-writing /quizSets: most forceCloud callers
  // also call scheduleInstantDataCloudSave right after with this same snapshot.
  // Firing both a raw REST PUT here AND the SDK update() there is a duplicate,
  // unordered write to the same path — two independent in-flight writes computed
  // from a moving quizSetsRef can land out of order and silently overwrite each
  // other (whichever request reaches Firebase last wins), and our own realtime
  // listener then echoes that stale result back into the UI — a just-saved
  // question can vanish again with no refresh involved. Only a few one-off
  // recovery/backup paths rely on this PUT as their sole delivery mechanism, so
  // they keep skipDirectPut=false.
  const scheduleQuizCatalogWrite = () => {
    const uid = userRef.current?.uid;
    if (!uid || !loadedRef.current) return;
    void writeQuizCatalogCloud(uid, quizFoldersRef.current, quizSetsRef.current);
  };

  const persistSets = (nextSets: QuizSet[], forceCloud = false, skipDirectPut = false) => {
    const painted = lastPaintedQuizSetsRef.current;
    const itemTrash = quizItemTombstonesRef.current;
    const byIdHonored = honorQuizItemTrashTombstones(quizSetsByIdCacheRef.current, itemTrash);
    const paintedHonored = honorQuizItemTrashTombstones(painted, itemTrash);
    let safeSets = honorQuizItemTrashTombstones(
      unionQuizSetsForCommit(
        honorQuizItemTrashTombstones(nextSets, itemTrash),
        paintedHonored,
        honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
        byIdHonored,
      ),
      itemTrash,
    );
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, safeSets);
    safeSets = honorQuizItemTrashTombstones(
      enforceMaxKnownLiveMembership(
        safeSets,
        maxKnownLiveBySetRef.current,
        paintedHonored,
        byIdHonored,
        honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
      ),
      itemTrash,
    );
    safeSets = stripPermDeletedQuizSets(safeSets, permDeletedRef.current);
    if (isQuizSetsLocalWriteSafe(safeSets, maxKnownLiveBySetRef.current, paintedHonored)) {
      safeSets = applyLocalQuizSetsListOrder(
        safeSets,
        quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal(),
      );
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(safeSets));
      writeQuizSetsShellJournal(safeSets);
      rememberLastGoodComplete(quizzesRef.current, safeSets);
    }
    quizSetsRef.current = applyLocalQuizSetsListOrder(
      safeSets,
      quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal(),
    );
    safeSets = quizSetsRef.current;
    scheduleQuizCatalogWrite();
    quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
      preferRicherQuizSetsMembership(byIdHonored, safeSets),
      itemTrash,
    );
    // Never force a full-user PATCH here — that raced with empty notes and wiped the cloud.
    persist({ quizSets: safeSets }, false);
    if (user && loadedRef.current && forceCloud) {
      // Only skip when the array is truly empty — a soft-deleted row is real
      // data that must still reach cloud, or the delete resurrects on refresh.
      if (!hasAnyUserQuizSetRows(safeSets) && everHadSetsRef.current) {
        recoveryLog('skipped quizSets PUT wipe');
        return;
      }
      const maxKnownLive = [...maxKnownLiveBySetRef.current.values()].reduce((a, b) => a + b, 0);
      const liveSafe = countLiveQuizItems(safeSets);
      // Soft-delete may sit below a stale max-known until floors are reconciled;
      // still push when lost live ids are present as trashed tombstones.
      const softTrashOk = isQuizSetsLocalWriteSafe(
        safeSets,
        maxKnownLiveBySetRef.current,
        paintedHonored,
      );
      if ((liveSafe < maxKnownLive && !softTrashOk) || !softTrashOk) {
        recoveryLog('skipped quizSets cloud write below max-known membership', {
          live: liveSafe,
          maxKnownLive,
        });
        return;
      }
      if (countUserQuizSets(safeSets) > 0) everHadSetsRef.current = true;
      // skipDirectPut callers already pushQuizSetById for the changed row — avoid a
      // multi-MB quizSetsById map rewrite that delayed live create/delete on mobile.
      if (skipDirectPut) return;
      void update(dbRef(database, `users/${user.uid}/quizSetsById`), setsToFirebaseMap(safeSets)).catch(() => {});
      markPushedData({ quizSets: safeSets });
      beginTrackedSave();
      void set(dbRef(database, `users/${user.uid}/quizSets`), safeSets)
        .catch((err) => {
          console.error('[cloud-save] quizSets set failed', err);
          return rtdbFetch(`/users/${user.uid}/quizSets`, {
            method: 'PUT',
            body: JSON.stringify(safeSets),
            headers: { 'Content-Type': 'application/json' },
          });
        })
        .finally(() => {
          endTrackedSave();
        });
    }
  };

  /** Structure-only cloud bump — never nest giant quizSets/quizFolders in parent update(). */
  const bumpCloudSyncAt = () => {
    const u = userRef.current;
    if (!u) return;
    const syncedAt = Date.now();
    void update(dbRef(database, `users/${u.uid}`), { cloudSyncAt: syncedAt }).then(() => {
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      saveFailedRef.current = false;
    }).catch(() => {});
  };

  /**
   * Instant create/delete/rename for sets: await ById (+ IndexedDB) first, then
   * fire-and-forget the giant quizSets[] array. Create durability must not wait
   * on the multi-MB array write (that is what caused ~2 min post-refresh delays).
   */
  const rememberQuizSetsListOrder = (order: QuizSetsListOrder | null) => {
    quizSetsListOrderRef.current = order;
    writeQuizSetsListOrderLocal(order);
  };

  const applyStoredQuizSetsListOrder = (sets: QuizSet[], order = quizSetsListOrderRef.current): QuizSet[] => (
    applyLocalQuizSetsListOrder(sets, order ?? readQuizSetsListOrderLocal())
  );

  /** Lightweight Manual-order mirror — never rewrites question bodies. */
  const persistQuizSetsListOrder = (sets: QuizSet[], stamp?: string) => {
    const ids = quizSetsListOrderIds(sets);
    if (!ids.length) {
      rememberQuizSetsListOrder(null);
      return;
    }
    const prev = quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal();
    const sameIds = !!prev
      && prev.ids.length === ids.length
      && prev.ids.every((id, i) => id === ids[i]);
    const updatedAt = stamp
      || (!sameIds ? nowStr() : (prev?.updatedAt || nowStr()));
    if (sameIds && prev?.updatedAt === updatedAt) {
      // Still refresh the ref from disk so boot/commit always see the durable list.
      rememberQuizSetsListOrder(prev);
      return;
    }
    const next = buildQuizSetsListOrder(sets, updatedAt);
    if (!next) return;
    rememberQuizSetsListOrder(next);
    const uid = userRef.current?.uid;
    if (!uid) return;
    // Do not wait for loadedRef — order must reach cloud as soon as the user reorders.
    void set(dbRef(database, `users/${uid}/quizSetsListOrder`), next).catch((err) => {
      console.error('[cloud-save] quizSetsListOrder set failed', err);
      return rtdbFetch(`/users/${uid}/quizSetsListOrder`, {
        method: 'PUT',
        body: JSON.stringify(next),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    });
  };

  const ingestQuizSetsListOrder = (raw: unknown): boolean => {
    const remote = normalizeQuizSetsListOrder(raw);
    const next = pickBetterQuizSetsListOrder(
      quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal(),
      remote,
    );
    if (!next) return false;
    const prev = quizSetsListOrderRef.current ?? readQuizSetsListOrderLocal();
    const unchanged = !!prev
      && prev.updatedAt === next.updatedAt
      && prev.ids.length === next.ids.length
      && prev.ids.every((id, i) => id === next.ids[i]);
    if (unchanged) {
      rememberQuizSetsListOrder(prev);
      return false;
    }
    rememberQuizSetsListOrder(next);
    return true;
  };

  const pushQuizSetStructure = async (
    nextSets: QuizSet[],
    changed?: QuizSet | QuizSet[],
  ): Promise<void> => {
    quizSetsRef.current = nextSets;
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    writeQuizSetsShellJournal(nextSets);
    rememberLastGoodComplete(quizzesRef.current, nextSets);
    persistQuizSetsListOrder(nextSets);
    const changedList = changed ? (Array.isArray(changed) ? changed : [changed]) : [];
    // Critical path: membership mirror lands before the caller can refresh away.
    for (const row of changedList) {
      await pushQuizSetById(row);
    }
    // Only skip when the array is truly empty — a soft-deleted row is real
    // data that must still reach cloud, or the delete resurrects on refresh.
    if (!hasAnyUserQuizSetRows(nextSets) && everHadSetsRef.current) {
      recoveryLog('skipped quizSets structure PUT wipe');
      bumpCloudSyncAt();
      return;
    }
    if (countUserQuizSets(nextSets) > 0) everHadSetsRef.current = true;
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    markPushedData({ quizSets: nextSets });
    beginTrackedSave();
    void set(dbRef(database, `users/${u.uid}/quizSets`), nextSets)
      .catch((err) => {
        console.error('[cloud-save] quizSets structure set failed', err);
        return rtdbFetch(`/users/${u.uid}/quizSets`, {
          method: 'PUT',
          body: JSON.stringify(nextSets),
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .finally(() => endTrackedSave());
    bumpCloudSyncAt();
  };

  /** Instant create/delete/rename for folders: ById + dedicated quizFolders set. */
  const pushQuizFolderStructure = (nextFolders: QuizFolder[], changed?: QuizFolder | QuizFolder[]) => {
    quizFoldersRef.current = nextFolders;
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    const changedList = changed ? (Array.isArray(changed) ? changed : [changed]) : [];
    for (const row of changedList) pushQuizFolderById(row);
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    markPushedData({ quizFolders: nextFolders });
    beginTrackedSave();
    void set(dbRef(database, `users/${u.uid}/quizFolders`), nextFolders)
      .catch((err) => {
        console.error('[cloud-save] quizFolders structure set failed', err);
        return rtdbFetch(`/users/${u.uid}/quizFolders`, {
          method: 'PUT',
          body: JSON.stringify(nextFolders),
          headers: { 'Content-Type': 'application/json' },
        });
      })
      .finally(() => endTrackedSave());
    bumpCloudSyncAt();
  };

  const persistFolders = (nextFolders: QuizFolder[], forceCloud = false) => {
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    quizFoldersRef.current = nextFolders;
    scheduleQuizCatalogWrite();
    persist({ quizFolders: nextFolders }, false);
    if (user && loadedRef.current && forceCloud) {
      markPushedData({ quizFolders: nextFolders });
      // SDK set on the dedicated node — more reliable for realtime listeners than
      // only nesting quizFolders inside a parent update() (which mobile sometimes missed).
      void set(dbRef(database, `users/${user.uid}/quizFolders`), nextFolders).catch((err) => {
        console.error('[cloud-save] quizFolders set failed', err);
        void rtdbFetch(`/users/${user.uid}/quizFolders`, {
          method: 'PUT',
          body: JSON.stringify(nextFolders),
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      });
      // Per-id mirror — same pattern as quizItemsById; survives array LWW races.
      void update(dbRef(database, `users/${user.uid}/quizFoldersById`), foldersToFirebaseMap(nextFolders)).catch(() => {});
      void appendFolderHistory(user.uid, nextFolders);
    }
  };

  /**
   * Hard-delete must destroy the per-id mirrors. `update(quizSetsById, map)` only
   * merges keys — orphans stay forever — and emptyTrash used to clear quizTrash
   * while leaving ById `trashed` rows, which other devices re-imported and
   * re-stamped as soft-delete tombstones (Trash resurrection loop).
   */
  const purgeQuizSetByIdCloud = (id: string) => {
    quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => s.id !== id);
    void removeQuizSetDurable(userRef.current?.uid, id);
  };

  const purgeQuizFolderByIdCloud = (id: string) => {
    quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => f.id !== id);
    const uid = userRef.current?.uid;
    if (!uid) return;
    void remove(dbRef(database, `users/${uid}/quizFoldersById/${id}`)).catch(() => (
      rtdbFetch(`/users/${uid}/quizFoldersById/${id}`, { method: 'DELETE' }).catch(() => {})
    ));
  };

  const pushQuizFolderById = (folder: QuizFolder) => {
    const uid = userRef.current?.uid;
    if (!uid || !loadedRef.current) return;
    if (permDeletedRef.current.quizFolders.includes(folder.id)) {
      purgeQuizFolderByIdCloud(folder.id);
      return;
    }
    const emptiedAt = readTrashEmptiedAt();
    if (folder.trashed && emptiedAt && entitySyncTime(folder) <= emptiedAt) {
      purgeQuizFolderByIdCloud(folder.id);
      return;
    }
    quizFoldersByIdCacheRef.current = mergeById(
      quizFoldersByIdCacheRef.current.filter((f) => f.id !== folder.id),
      [folder],
    );
    const payload = JSON.parse(JSON.stringify(folder));
    // This per-id mirror is often the ONLY reliable carrier of a trash flag
    // when the giant dedicated array write is skipped/fails (see wipe guard
    // above) — a bare SDK failure here with no fallback used to leave a
    // soft-deleted folder durably un-trashed in the cloud.
    void set(dbRef(database, `users/${uid}/quizFoldersById/${folder.id}`), payload).catch((err) => {
      console.error('[cloud-save] quizFoldersById write failed', err);
      return rtdbFetch(`/users/${uid}/quizFoldersById/${folder.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {});
    });
  };

  /** Awaitable ById + IndexedDB write — create durability must not depend on giant quizSets[]. */
  const pushQuizSetById = async (quizSet: QuizSet): Promise<boolean> => {
    const uid = userRef.current?.uid;
    if (permDeletedRef.current.quizSets.includes(quizSet.id)) {
      purgeQuizSetByIdCloud(quizSet.id);
      return true;
    }
    const emptiedAt = readTrashEmptiedAt();
    if (quizSet.trashed && emptiedAt && entitySyncTime(quizSet) <= emptiedAt) {
      purgeQuizSetByIdCloud(quizSet.id);
      return true;
    }
    quizSetsByIdCacheRef.current = (() => {
      const row = { ...quizSet, items: quizSet.items ?? [] };
      const idx = quizSetsByIdCacheRef.current.findIndex((s) => s.id === quizSet.id);
      if (idx >= 0) {
        const next = quizSetsByIdCacheRef.current.slice();
        // Never let an outgoing partial row blank richer cache membership.
        next[idx] = pickBetterQuizSet(quizSetsByIdCacheRef.current[idx], row, permDeletedRef.current);
        return next;
      }
      return [...quizSetsByIdCacheRef.current, row];
    })();
    // IndexedDB always; ById cloud even before loadedRef so create-then-refresh survives.
    let cached = quizSetsByIdCacheRef.current.find((s) => s.id === quizSet.id) ?? quizSet;
    bumpMaxKnownLiveBySet(maxKnownLiveBySetRef.current, [cached]);
    cached = enforceMaxKnownLiveMembership(
      [cached],
      maxKnownLiveBySetRef.current,
      quizSetsByIdCacheRef.current,
      quizSetsRef.current,
      lastPaintedQuizSetsRef.current,
    )[0] ?? cached;
    // Never overwrite cloud/IDB ById with a membership below the session high-water mark.
    if (countLiveItemsInSet(cached) < (maxKnownLiveBySetRef.current.get(cached.id) ?? 0)) {
      recoveryLog('skipped quizSetsById push below max-known', {
        id: cached.id,
        live: countLiveItemsInSet(cached),
        maxKnown: maxKnownLiveBySetRef.current.get(cached.id),
      });
      return false;
    }
    return persistQuizSetDurable(uid, cached);
  };

  const rememberRemoteFolderInCache = (folder: QuizFolder) => {
    if (!folder.id) return;
    if (permDeletedRef.current.quizFolders.includes(folder.id)) {
      quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => f.id !== folder.id);
      return;
    }
    const emptiedAt = readTrashEmptiedAt();
    if (folder.trashed && emptiedAt && entitySyncTime(folder) <= emptiedAt) {
      quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => f.id !== folder.id);
      return;
    }
    if (folder.trashed && !String(folder.name || '').trim()) {
      quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => f.id !== folder.id);
      return;
    }
    quizFoldersByIdCacheRef.current = mergeById(
      quizFoldersByIdCacheRef.current.filter((f) => f.id !== folder.id),
      [folder],
    );
  };

  const rememberRemoteSetInCache = (setVal: QuizSet) => {
    if (!setVal.id) return;
    if (permDeletedRef.current.quizSets.includes(setVal.id)) {
      quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => s.id !== setVal.id);
      return;
    }
    const emptiedAt = readTrashEmptiedAt();
    if (setVal.trashed && emptiedAt && entitySyncTime(setVal) <= emptiedAt) {
      quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => s.id !== setVal.id);
      return;
    }
    if (setVal.trashed && !String(setVal.name || '').trim()) {
      quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => s.id !== setVal.id);
      return;
    }
    quizSetsByIdCacheRef.current = (() => {
      const row = { ...setVal, items: setVal.items ?? [] };
      const idx = quizSetsByIdCacheRef.current.findIndex((s) => s.id === setVal.id);
      if (idx >= 0) {
        const next = quizSetsByIdCacheRef.current.slice();
        // Union-merge into cache — a partial/newer ById echo must not blank items.
        next[idx] = pickBetterQuizSet(quizSetsByIdCacheRef.current[idx], row, permDeletedRef.current);
        return next;
      }
      return [...quizSetsByIdCacheRef.current, row];
    })();
  };

  /**
   * Keep the durable soft-delete marker in step with a row that just arrived
   * from cloud: a trashed row records one. Live rows must not clear it —
   * last-good/ById echoes with a newer updatedAt used to look like restores
   * and resurrect deleted sets/folders after refresh.
   */
  const syncTrashTombstoneFromRemote = (
    kind: 'sets' | 'folders',
    row: { id: string; trashed?: boolean; updatedAt?: string; createdAt?: string },
  ) => {
    const isSet = kind === 'sets';
    if (isSet ? permDeletedRef.current.quizSets.includes(row.id) : permDeletedRef.current.quizFolders.includes(row.id)) {
      return;
    }
    const at = entitySyncTime(row);
    const emptiedAt = readTrashEmptiedAt();
    // Do not re-stamp soft-delete markers for rows Empty Trash already finalized.
    if (row.trashed && emptiedAt && at <= emptiedAt) return;
    const key = isSet ? QUIZ_SET_TRASH_TOMBSTONE_KEY : QUIZ_FOLDER_TRASH_TOMBSTONE_KEY;
    const current = isSet ? quizSetTombstonesRef.current : quizFolderTombstonesRef.current;
    const known = current[row.id];
    let next: TrashTombstones;
    if (row.trashed) {
      if (known !== undefined && known >= at) return;
      next = markTrashTombstone(key, current, row.id, at || Date.now());
    } else {
      // A live ById/last-good echo is NOT a restore. Restores clear
      // quizTrash/{path}/{id} and arrive via onChildRemoved.
      return;
    }
    if (isSet) quizSetTombstonesRef.current = next;
    else quizFolderTombstonesRef.current = next;
  };

  /** Push every known soft-delete marker onto live state/caches right now. */
  const applyTrashTombstonesToState = () => {
    if (!loadedRef.current) return;
    const stamp = nowStr();
    const setTombstones = quizSetTombstonesRef.current;
    const folderTombstones = quizFolderTombstonesRef.current;
    const itemTombstones = quizItemTombstonesRef.current;
    quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
      filterResurrectedTrash(
        applyTrashTombstones(quizSetsByIdCacheRef.current, setTombstones, stamp),
        quizSetsByIdCacheRef.current,
        setTombstones,
      ),
      itemTombstones,
      stamp,
    );
    quizFoldersByIdCacheRef.current = filterResurrectedTrash(
      applyTrashTombstones(quizFoldersByIdCacheRef.current, folderTombstones, stamp),
      quizFoldersByIdCacheRef.current,
      folderTombstones,
    );
    let nextSets = honorQuizItemTrashTombstones(
      filterResurrectedTrash(
        applyTrashTombstones(quizSetsRef.current, setTombstones, stamp),
        quizSetsRef.current,
        setTombstones,
      ),
      itemTombstones,
      stamp,
    );
    nextSets = stripPermDeletedQuizSets(nextSets, permDeletedRef.current);
    let nextFolders = filterResurrectedTrash(
      applyTrashTombstones(quizFoldersRef.current, folderTombstones, stamp),
      quizFoldersRef.current,
      folderTombstones,
    );
    nextFolders = nextFolders.filter((f) => !permDeletedRef.current.quizFolders.includes(f.id));
    const nextQuizzes = stripPermDeletedQuizzes(
      honorQuizItemTrashTombstonesOnItems(
        quizzesRef.current,
        itemTombstones,
        stamp,
      ),
      permDeletedRef.current,
    );
    if (JSON.stringify(nextQuizzes) !== JSON.stringify(quizzesRef.current)) {
      const prevQ = quizzesRef.current;
      quizzesRef.current = nextQuizzes;
      safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
      if (!quizzesEqualForUI(nextQuizzes, prevQ)) setQuizzes(nextQuizzes);
    }
    if (JSON.stringify(nextSets) !== JSON.stringify(quizSetsRef.current)) {
      const prevSets = quizSetsRef.current;
      quizSetsRef.current = nextSets;
      lastPaintedQuizSetsRef.current = nextSets;
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
      if (!quizSetsEqualForUI(nextSets, prevSets)) setQuizSets(nextSets);
    }
    if (JSON.stringify(nextFolders) !== JSON.stringify(quizFoldersRef.current)) {
      quizFoldersRef.current = nextFolders;
      safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
      setQuizFolders(nextFolders);
    }
    const nextNotes = applyTrashTombstones(notesRef.current, noteTrashTombstonesRef.current, stamp);
    if (JSON.stringify(nextNotes) !== JSON.stringify(notesRef.current)) {
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      writeNotesListCache(nextNotes);
      rememberNotesBootCache(nextNotes, true);
      safeSetItem('malacadhati', JSON.stringify(nextNotes));
    }
  };

  const applyRemoteFolderById = (raw: unknown) => {
    if (!loadedRef.current || !raw || typeof raw !== 'object') return;
    const folder = raw as QuizFolder;
    if (!folder.id) return;
    rememberRemoteFolderInCache(folder);
    // Queue UI apply while array merges hold the lock so creates/deletes are not overwritten.
    if (isApplyingRemoteRef.current) {
      pendingRemoteByIdRef.current.push({ kind: 'folder', raw });
      return;
    }
    if (permDeletedRef.current.quizFolders.includes(folder.id)) {
      // Orphan still on cloud from a pre-fix emptyTrash — destroy it so it
      // cannot keep re-entering trash via soft-delete tombstone re-stamp.
      purgeQuizFolderByIdCloud(folder.id);
      const filtered = quizFoldersRef.current.filter((f) => f.id !== folder.id);
      if (filtered.length === quizFoldersRef.current.length) return;
      const next = finalizeQuizFolders(filtered, quizSetsRef.current);
      quizFoldersRef.current = next;
      setQuizFolders(next);
      safeSetItem('malacadhati_quiz_folders', JSON.stringify(next));
      return;
    }
    const emptiedAtFolder = readTrashEmptiedAt();
    if (folder.trashed && emptiedAtFolder && entitySyncTime(folder) <= emptiedAtFolder) {
      purgeQuizFolderByIdCloud(folder.id);
      return;
    }
    if (folder.trashed && !String(folder.name || '').trim()) return;
    // Only real named rows may move the marker — a nameless trash stub must
    // never tombstone a live folder (see pickBetterQuizFolder).
    syncTrashTombstoneFromRemote('folders', folder);
    const prev = quizFoldersRef.current;
    const existing = prev.find((f) => f.id === folder.id);
    const picked = existing ? pickBetterQuizFolder(existing, folder) : folder;
    // A durable tombstone (local delete, or one that arrived via quizTrash from
    // another device) always beats a stale live copy of the same id.
    const merged = applyTrashTombstones([picked], quizFolderTombstonesRef.current, nowStr())[0];
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) return;
    const nextList = existing
      ? prev.map((f) => (f.id === folder.id ? merged : f))
      : [...prev, merged];
    const next = finalizeQuizFolders(nextList, quizSetsRef.current);
    quizFoldersRef.current = next;
    setQuizFolders(next);
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(next));
  };

  const applyRemoteSetById = (raw: unknown) => {
    if (!loadedRef.current || !raw || typeof raw !== 'object') return;
    const incoming = raw as QuizSet;
    if (!incoming.id) return;
    const setVal: QuizSet = { ...incoming, items: incoming.items ?? [] };
    rememberRemoteSetInCache(setVal);
    if (isApplyingRemoteRef.current) {
      pendingRemoteByIdRef.current.push({ kind: 'set', raw });
      return;
    }
    if (permDeletedRef.current.quizSets.includes(setVal.id)) {
      purgeQuizSetByIdCloud(setVal.id);
      const filtered = quizSetsRef.current.filter((s) => s.id !== setVal.id);
      if (filtered.length === quizSetsRef.current.length) return;
      quizSetsRef.current = filtered;
      setQuizSets(filtered);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(filtered));
      return;
    }
    const emptiedAt = readTrashEmptiedAt();
    if (setVal.trashed && emptiedAt && entitySyncTime(setVal) <= emptiedAt) {
      purgeQuizSetByIdCloud(setVal.id);
      return;
    }
    if (setVal.trashed && !String(setVal.name || '').trim()) return;
    // Only real named rows may move the marker — a nameless trash stub must
    // never tombstone a live set (see pickBetterQuizSet).
    syncTrashTombstoneFromRemote('sets', setVal);
    const prev = quizSetsRef.current;
    const existing = prev.find((s) => s.id === setVal.id);
    const picked = existing
      ? pickBetterQuizSet(existing, setVal, permDeletedRef.current)
      : setVal;
    // Same tombstone guard as applyRemoteFolderById — a stale live copy can
    // never undo a soft-delete that already has a durable marker.
    const merged = applyTrashTombstones([picked], quizSetTombstonesRef.current, nowStr())[0];
    if (existing && JSON.stringify(existing) === JSON.stringify(merged)) return;
    const nextList = existing
      ? prev.map((s) => (s.id === setVal.id ? merged : s))
      : [...prev, merged];
    const colors = quizFoldersRef.current.map((f) => f.color).filter((c): c is string => !!c);
    const next = initializeQuizColors(ensureFavoritesSet(nextList), colors);
    commitQuizSetsFromRemote(next);
  };

  const flushPendingRemoteById = () => {
    if (isApplyingRemoteRef.current || !pendingRemoteByIdRef.current.length) return;
    const queued = pendingRemoteByIdRef.current;
    pendingRemoteByIdRef.current = [];
    for (const item of queued) {
      if (item.kind === 'set') applyRemoteSetById(item.raw);
      else applyRemoteFolderById(item.raw);
    }
  };

  const appendFolderHistory = async (uid: string, folders: QuizFolder[]) => {
    const key = String(Date.now());
    await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory/${key}.json`, {
      method: 'PUT',
      body: JSON.stringify(folders),
      headers: { 'Content-Type': 'application/json' },
    });
    await trimHistoryKeys(uid, 'quizFoldersHistory', MAX_FOLDER_HISTORY);
  };

  useEffect(() => {
    if (!loaded || !user) return;
    setQuizFolders((prev) => {
      const next = ensureFavoritesFolder(ensureRestoredFolder(prev));
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        safeSetItem('malacadhati_quiz_folders', JSON.stringify(next));
      }
      return next;
    });
    setQuizSets((prev) => {
      const next = ensureFavoritesSet(prev);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
      }
      return next;
    });
    // Run once after each account finishes loading — local only, never cloud-sync empty state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, user?.uid]);

  const saveChats = (nextChats: ChatConversation[]) => {
    setChats(nextChats);
    safeSetItem('malacadhati_chats', JSON.stringify(nextChats));
    persist({ chats: nextChats });
  };

  const userRef = useRef(user);
  userRef.current = user;

  const addTokens = useRef((n: number) => {
    setTokenUsage((prev) => {
      const next = prev + n;
      const u = userRef.current;
      if (u) {
        void rtdbFetch(`/users/${u.uid}/tokenUsage`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        }).catch(() => {});
      }
      return next;
    });
  }).current;

  useEffect(() => {
    setTokenSink(addTokens);
    return () => setTokenSink(() => {});
  }, [addTokens]);

  useEffect(() => {
    if (!user || !loaded) return;
    const run = () => {
      if (!shouldRunHourlyFolderBackup()) return;
      void writeBackupToFolder(buildFullBackupPayload({
        notes: notesRef.current,
        quizzes: quizzesRef.current,
        quizSets: quizSetsRef.current,
        quizFolders: quizFoldersRef.current,
        chats: chatsRef.current,
      }));
    };
    run();
    const id = window.setInterval(run, 60_000);
    return () => window.clearInterval(id);
  }, [user, loaded]);

  const writeLocalCache = () => {
    // Never JSON.stringify full note HTML into localStorage. Image notes blow
    // the quota on locked-down hospital PCs; the throw used to abort applying
    // the cloud copy that still has the photos.
    writeNotesListCache(notesRef.current);
    rememberNotesBootCache(notesRef.current);
    safeSetItem('malacadhati_quiz', JSON.stringify(quizzesRef.current));
    safeSetItem('malacadhati_drafts', JSON.stringify(draftsRef.current));
  };

  const buildDraftCloudPayload = (dList: Draft[]) => {
    const draftContents: Record<string, { title: string; html: string; updatedAt?: number } | null> = {};
    dList.forEach((d) => {
      draftContents[d.id] = { title: d.title, html: d.html, updatedAt: d.updatedAt ?? Date.now() };
    });
    for (const id of pendingDeletedDraftIdsRef.current) {
      draftContents[id] = null;
    }
    lastCloudDraftIdsRef.current = new Set(dList.map((d) => d.id));
    return {
      drafts: dList.map((d) => d.id),
      draftId: draftCounter.current,
      draftContents,
      deletedDraftIds: [...pendingDeletedDraftIdsRef.current],
    };
  };

  const applyCloudDraftBundle = (bundle: Record<string, unknown>) => {
    pendingDeletedDraftIdsRef.current = mergeDeletedDraftIds(pendingDeletedDraftIdsRef.current, bundle);
    if (typeof bundle.cloudSyncAt === 'number' && bundle.cloudSyncAt > 0) {
      lastAppliedRemoteSyncAt.current = bundle.cloudSyncAt;
      setCloudSyncedAt(bundle.cloudSyncAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(bundle.cloudSyncAt));
    }
    const cloudDrafts = parseCloudDrafts(bundle);
    lastCloudDraftIdsRef.current = new Set(cloudDrafts.map((d) => d.id));
    const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
    const merged = recentDraftEdit
      ? filterVisibleDrafts(draftsRef.current, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current)
      : mergeDraftsForPull(
        draftsRef.current,
        cloudDrafts.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id)),
        bundle,
        pendingDeletedDraftIdsRef.current,
        pendingLocalDraftIdsRef.current,
      );
    if (JSON.stringify(merged) !== JSON.stringify(draftsRef.current)) {
      setDrafts(merged);
      draftsRef.current = merged;
      draftCounter.current = syncDraftCounter(
        (bundle.draftId as number | undefined) || 0,
        merged,
        pendingDeletedDraftIdsRef.current,
      );
      safeSetItem('malacadhati_drafts', JSON.stringify(merged));
    }
  };

  const applySingleRemoteDraft = (id: string, remote: { title?: string; html?: string; updatedAt?: number } | null) => {
    if (!id) return;
    if (remote === null) {
      if (pendingLocalDraftIdsRef.current.has(id)) return;
      pendingDeletedDraftIdsRef.current.add(id);
      writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
      const next = draftsRef.current.filter((d) => d.id !== id);
      if (next.length === draftsRef.current.length) return;
      draftsRef.current = next;
      setDrafts(next);
      safeSetItem('malacadhati_drafts', JSON.stringify(next));
      return;
    }
    if (pendingDeletedDraftIdsRef.current.has(id)) return;
    const remoteAt = typeof remote.updatedAt === 'number' ? remote.updatedAt : 0;
    const lastPushed = lastPushedDraftUpdatedAtRef.current.get(id) ?? 0;
    const lastPushedHtml = lastPushedDraftHtmlRef.current.get(id);
    if (remoteAt > 0 && remoteAt <= lastPushed && remote.html === lastPushedHtml) return;
    const localEditAt = draftLocalEditAtRef.current.get(id) ?? 0;
    const local = draftsRef.current.find((d) => d.id === id);
    const localAt = local?.updatedAt ?? 0;
    const recentlyEdited = local && Date.now() - localEditAt < 12_000;
    if (recentlyEdited && remoteAt <= localAt) return;
    if (recentlyEdited && local) {
      const remoteLen = draftContentLength({ id, title: remote.title ?? '', html: remote.html ?? '' });
      const localLen = draftContentLength(local);
      if (remoteLen < localLen) return;
    }

    const remoteDraft: Draft = {
      id,
      title: remote.title ?? '',
      html: remote.html ?? '',
      updatedAt: remoteAt || undefined,
    };
    let next: Draft[];
    if (local) {
      const picked = pickBetterDraft(local, remoteDraft);
      if (JSON.stringify(picked) === JSON.stringify(local)) return;
      next = draftsRef.current.map((d) => (d.id === id ? picked : d));
    } else {
      next = [...draftsRef.current, remoteDraft];
    }
    draftsRef.current = next;
    setDrafts(next);
    safeSetItem('malacadhati_drafts', JSON.stringify(next));
  };

  const runSingleDraftCloudSave = async (draftId: string) => {
    const u = userRef.current;
    if (!u || !draftsReadyRef.current || isApplyingRemoteRef.current) return;
    if (draftSaveInFlightRef.current.has(draftId)) {
      draftSavePendingAgainRef.current.add(draftId);
      return;
    }
    const draft = draftsRef.current.find((d) => d.id === draftId);
    if (!draft) return;

    const updatedAt = draft.updatedAt ?? Date.now();
    lastPushedDraftUpdatedAtRef.current.set(draftId, updatedAt);
    lastPushedDraftHtmlRef.current.set(draftId, draft.html);
    draftSaveInFlightRef.current.add(draftId);
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
    const syncedAt = Date.now();

    try {
      // No manual token fetch here: the SDK's update() authenticates over its
      // own realtime connection, and the REST fallback below fetches its own
      // token. getIdToken can hang up to 8s on Chrome (stuck IndexedDB auth),
      // which stalled every save long enough for a refresh to cancel it.
      try {
        await update(dbRef(database, `users/${u.uid}`), {
          [`draftContents/${draftId}`]: { title: draft.title, html: draft.html, updatedAt },
          drafts: draftsRef.current.map((d) => d.id),
          draftId: draftCounter.current,
          deletedDraftIds: [...pendingDeletedDraftIdsRef.current],
          cloudSyncAt: syncedAt,
        });
      } catch {
        const res = await rtdbFetch(`/users/${u.uid}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            [`draftContents/${draftId}`]: { title: draft.title, html: draft.html, updatedAt },
            drafts: draftsRef.current.map((d) => d.id),
            draftId: draftCounter.current,
            deletedDraftIds: [...pendingDeletedDraftIdsRef.current],
            cloudSyncAt: syncedAt,
          }),
        });
        if (!res.ok) throw new Error('cloud-draft-save-failed');
      }
      saveFailedRef.current = false;
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
    } catch {
      saveFailedRef.current = true;
      setCloudStatus('error');
    } finally {
      draftSaveInFlightRef.current.delete(draftId);
      savesInFlight.current = Math.max(0, savesInFlight.current - 1);
      if (draftSavePendingAgainRef.current.has(draftId)) {
        draftSavePendingAgainRef.current.delete(draftId);
        void runSingleDraftCloudSave(draftId);
      } else if (savesInFlight.current === 0) {
        if (saveFailedRef.current) {
          setCloudStatus('error');
        } else {
          const elapsed = Date.now() - savingStartedAt.current;
          const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
          const markSaved = () => setCloudStatus('saved');
          if (delay > 0) setTimeout(markSaved, delay);
          else markSaved();
        }
      }
    }
  };

  const scheduleSingleDraftCloudSave = (draftId: string) => {
    if (!userRef.current || !draftsReadyRef.current || isApplyingRemoteRef.current) return;
    queueMicrotask(() => {
      void runSingleDraftCloudSave(draftId);
    });
  };

  const recordPermDeleted = (patch: Partial<PermanentlyDeletedIds>) => {
    permDeletedRef.current = addPermDeleted(permDeletedRef.current, patch);
    writePermDeleted(permDeletedRef.current);
  };

  const applyPermDeletedLocally = (): boolean => {
    const tombstones = permDeletedRef.current;
    const deadNotes = new Set(tombstones.notes.map(Number).filter(Number.isFinite));
    const deadQuizzes = new Set(tombstones.quizzes);
    const deadSets = new Set(tombstones.quizSets);
    const deadFolders = new Set(tombstones.quizFolders);

    // Drop orphaned ById cache rows; cloud remove happens in purge* on the
    // delete path and opportunistically when a dead ById child event arrives.
    if (deadSets.size) {
      quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => !deadSets.has(s.id));
    }
    if (deadFolders.size) {
      quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => !deadFolders.has(f.id));
    }
    quizSetsByIdCacheRef.current = filterResurrectedTrash(
      quizSetsByIdCacheRef.current,
      quizSetsByIdCacheRef.current,
      quizSetTombstonesRef.current,
    );
    quizFoldersByIdCacheRef.current = filterResurrectedTrash(
      quizFoldersByIdCacheRef.current,
      quizFoldersByIdCacheRef.current,
      quizFolderTombstonesRef.current,
    );

    const nextNotes = filterResurrectedTrash(
      notesRef.current.filter((n) => !deadNotes.has(Number(n.id))),
      notesRef.current,
    );
    const nextQuizzes = filterResurrectedTrash(
      quizzesRef.current.filter((q) => !deadQuizzes.has(q.id)),
      quizzesRef.current,
    );
    const nextSets = stripPermDeletedQuizSets(
      filterResurrectedTrash(
        quizSetsRef.current.filter((s) => !deadSets.has(s.id)),
        quizSetsRef.current,
        quizSetTombstonesRef.current,
      ),
      tombstones,
    );
    const nextFolders = filterResurrectedTrash(
      quizFoldersRef.current.filter((f) => !deadFolders.has(f.id)),
      quizFoldersRef.current,
      quizFolderTombstonesRef.current,
    );
    const normalizedFolders = finalizeQuizFolders(nextFolders, nextSets);
    const normalizedSets = initializeQuizColors(
      nextSets,
      normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    );

    let changed = false;
    if (JSON.stringify(nextNotes) !== JSON.stringify(notesRef.current)) {
      notesRef.current = nextNotes;
      setNotes(nextNotes);
      safeSetItem('malacadhati', JSON.stringify(nextNotes));
      changed = true;
    }
    if (JSON.stringify(nextQuizzes) !== JSON.stringify(quizzesRef.current)) {
      quizzesRef.current = nextQuizzes;
      setQuizzes(nextQuizzes);
      safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
      changed = true;
    }
    if (JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)) {
      quizSetsRef.current = normalizedSets;
      setQuizSets(normalizedSets);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
      changed = true;
    }
    if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
      quizFoldersRef.current = normalizedFolders;
      setQuizFolders(normalizedFolders);
      safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
      changed = true;
    }
    return changed;
  };

  const markPushedData = (patch: {
    notes?: Note[];
    quizzes?: QuizItem[];
    quizSets?: QuizSet[];
    quizFolders?: QuizFolder[];
  }, at = Date.now()) => {
    lastPushedDataAtRef.current = at;
    if (patch.notes) lastPushedPayloadRef.current.notes = JSON.stringify(patch.notes);
    if (patch.quizzes) lastPushedPayloadRef.current.quizzes = JSON.stringify(patch.quizzes);
    if (patch.quizSets) lastPushedPayloadRef.current.quizSets = JSON.stringify(patch.quizSets);
    if (patch.quizFolders) lastPushedPayloadRef.current.quizFolders = JSON.stringify(patch.quizFolders);
  };

  const shouldSkipRemoteEcho = (key: 'notes' | 'quizzes' | 'quizSets' | 'quizFolders', json: string) =>
    Date.now() - lastPushedDataAtRef.current < 450 && lastPushedPayloadRef.current[key] === json;

  const flushPendingRemoteTrashPatches = () => {
    if (isApplyingRemoteRef.current || !pendingRemoteTrashPatchesRef.current.length) return;
    const queued = pendingRemoteTrashPatchesRef.current;
    pendingRemoteTrashPatchesRef.current = [];
    const merged: {
      notes?: unknown;
      quizzes?: unknown;
      quizSets?: unknown;
      quizFolders?: unknown;
    } = {};
    for (const patch of queued) {
      if (patch.notes !== undefined) merged.notes = patch.notes;
      if (patch.quizzes !== undefined) merged.quizzes = patch.quizzes;
      if (patch.quizSets !== undefined) merged.quizSets = patch.quizSets;
      if (patch.quizFolders !== undefined) merged.quizFolders = patch.quizFolders;
    }
    queueMicrotask(() => applyRemoteTrashData(merged));
  };

  const applyRemoteTrashData = (patch: {
    notes?: unknown;
    quizzes?: unknown;
    quizSets?: unknown;
    quizFolders?: unknown;
  }) => {
    if (!loadedRef.current) return;
    // Never drop folder/set creates — quizItemsById merges used to hold this lock
    // and silently discard the quizFolders realtime event.
    if (isApplyingRemoteRef.current) {
      pendingRemoteTrashPatchesRef.current.push(patch);
      return;
    }
    const tombstones = permDeletedRef.current;
    let nextNotes = notesRef.current;
    let nextQuizzes = quizzesRef.current;
    let nextSets = quizSetsRef.current;
    let nextFolders = quizFoldersRef.current;
    let changed = false;

    if (patch.notes !== undefined) {
      const remoteNotes = incomingNotesSafe(
        firebaseToArray<Note>(patch.notes as Note[] | Record<string, Note>),
      );
      const merged = filterResurrectedTrash(
        stripPermDeletedNotes(
          adoptNotesSafe(
            mergeNotesForSync(notesRef.current, remoteNotes, tombstones),
            remoteNotes,
            true,
          ),
          permDeletedRef.current,
        ),
        notesRef.current,
      );
      const json = JSON.stringify(merged);
      if (!shouldSkipRemoteEcho('notes', json) && json !== JSON.stringify(notesRef.current)) {
        nextNotes = merged;
        changed = true;
      }
    }
    if (patch.quizzes !== undefined) {
      const remoteQuizzes = firebaseToArray<QuizItem>(patch.quizzes as QuizItem[] | Record<string, QuizItem>);
      const merged = stripPermDeletedQuizzes(
        filterResurrectedTrash(
          mergeQuizzesForSync(quizzesRef.current, remoteQuizzes, tombstones),
          quizzesRef.current,
        ),
        tombstones,
      );
      const json = JSON.stringify(merged);
      if (!shouldSkipRemoteEcho('quizzes', json) && json !== JSON.stringify(quizzesRef.current)) {
        nextQuizzes = merged;
        changed = true;
      }
    }
    if (patch.quizSets !== undefined) {
      const remoteSets = firebaseToArray<QuizSet>(patch.quizSets as QuizSet[] | Record<string, QuizSet>)
        .map((set) => ({ ...set, items: set.items ?? [] }));
      let merged = filterResurrectedTrash(
        mergeQuizSetsForSync(quizSetsRef.current, remoteSets, tombstones),
        quizSetsRef.current,
        quizSetTombstonesRef.current,
      );
      // Always re-union ById cache — array LWW must never hide a live set / richer items.
      if (quizSetsByIdCacheRef.current.length) {
        merged = preferRicherQuizSetsMembership(
          adoptByIdMembershipWhenRicher(merged, quizSetsByIdCacheRef.current),
          quizSetsByIdCacheRef.current,
        );
      }
      merged = applyStoredQuizSetsListOrder(
        applyTrashTombstones(merged, quizSetTombstonesRef.current, nowStr()),
      );
      const json = JSON.stringify(merged);
      const needsCloudHeal = quizSetsMissingFromRemote(merged, remoteSets)
        || quizSetsRemoteMembershipIncomplete(merged, remoteSets);
      if ((!shouldSkipRemoteEcho('quizSets', json) && json !== JSON.stringify(quizSetsRef.current)) || needsCloudHeal) {
        nextSets = merged;
        changed = true;
      }
    }
    if (patch.quizFolders !== undefined) {
      const remoteFolders = firebaseToArray<QuizFolder>(patch.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
      let merged = filterResurrectedTrash(
        mergeFoldersForSync(quizFoldersRef.current, remoteFolders, tombstones),
        quizFoldersRef.current,
        quizFolderTombstonesRef.current,
      );
      if (quizFoldersByIdCacheRef.current.length) {
        merged = mergeFoldersForSync(merged, quizFoldersByIdCacheRef.current, tombstones);
      }
      merged = applyTrashTombstones(merged, quizFolderTombstonesRef.current, nowStr());
      const json = JSON.stringify(merged);
      const remoteLive = new Set(remoteFolders.filter((f) => !f.trashed && !f.system).map((f) => f.id));
      const needsCloudHeal = merged.some((f) => !f.trashed && !f.system && !remoteLive.has(f.id));
      if ((!shouldSkipRemoteEcho('quizFolders', json) && json !== JSON.stringify(quizFoldersRef.current)) || needsCloudHeal) {
        nextFolders = merged;
        changed = true;
      }
    }
    if (!changed) {
      flushPendingRemoteById();
      flushPendingRemoteTrashPatches();
      return;
    }

    // Re-union ById cache at commit time — child events may have updated the cache
    // while this array merge was computing (creates/soft-deletes must not be overwritten).
    const tombstonesAtCommit = permDeletedRef.current;
    const trashStamp = nowStr();
    nextSets = applyStoredQuizSetsListOrder(
      applyTrashTombstones(
        unionQuizSetsFromById(nextSets, quizSetsByIdCacheRef.current, tombstonesAtCommit),
        quizSetTombstonesRef.current,
        trashStamp,
      ),
    );
    nextFolders = applyTrashTombstones(
      mergeFoldersForSync(nextFolders, quizFoldersByIdCacheRef.current, tombstonesAtCommit),
      quizFolderTombstonesRef.current,
      trashStamp,
    );

    const normalizedFolders = finalizeQuizFolders(nextFolders, nextSets);
    const normalizedSets = initializeQuizColors(
      nextSets,
      normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    );

    // Keep ById cache aligned with the committed union (including soft-deletes).
    // Prefer normalizedSets as the order authority — ById never dictates Manual order.
    quizSetsByIdCacheRef.current = preferRicherQuizSetsMembership(
      normalizedSets,
      quizSetsByIdCacheRef.current,
    );
    quizFoldersByIdCacheRef.current = mergeById(quizFoldersByIdCacheRef.current, normalizedFolders);

    const shouldReconcileQuizSets = patch.quizSets !== undefined && (
      JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)
      || quizSetsMissingFromRemote(normalizedSets, firebaseToArray<QuizSet>(patch.quizSets as QuizSet[] | Record<string, QuizSet>))
      || quizSetsRemoteMembershipIncomplete(normalizedSets, firebaseToArray<QuizSet>(patch.quizSets as QuizSet[] | Record<string, QuizSet>))
    );
    const shouldReconcileQuizzes = patch.quizzes !== undefined
      && JSON.stringify(nextQuizzes) !== JSON.stringify(quizzesRef.current);
    const shouldReconcileFolders = patch.quizFolders !== undefined && (
      JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)
      || (() => {
        const remoteFolders = firebaseToArray<QuizFolder>(patch.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
        const remoteLive = new Set(remoteFolders.filter((f) => !f.trashed && !f.system).map((f) => f.id));
        return normalizedFolders.some((f) => !f.trashed && !f.system && !remoteLive.has(f.id));
      })()
    );

    isApplyingRemoteRef.current = true;
    try {
      if (JSON.stringify(nextNotes) !== JSON.stringify(notesRef.current)) {
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        safeSetItem('malacadhati', JSON.stringify(nextNotes));
      }
      if (JSON.stringify(nextQuizzes) !== JSON.stringify(quizzesRef.current)) {
        const prevQuizzes = quizzesRef.current;
        quizzesRef.current = nextQuizzes;
        safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
        if (!quizzesEqualForUI(nextQuizzes, prevQuizzes)) setQuizzes(nextQuizzes);
      }
      if (JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)) {
        commitQuizSetsFromRemote(normalizedSets);
      }
      if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
        quizFoldersRef.current = normalizedFolders;
        setQuizFolders(normalizedFolders);
        safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
      }
    } finally {
      isApplyingRemoteRef.current = false;
      flushPendingRemoteById();
      flushPendingRemoteTrashPatches();
      flushPendingInstantDataSave();
    }

    // Push healed membership/order so the other device's stale "Saved" snapshot
    // cannot remain cloud truth after a merge that dropped resurrected items.
    if (shouldReconcileQuizSets || shouldReconcileQuizzes || shouldReconcileFolders) {
      const reconcile: {
        quizzes?: QuizItem[];
        quizSets?: QuizSet[];
        quizFolders?: QuizFolder[];
      } = {};
      if (shouldReconcileQuizzes) reconcile.quizzes = quizzesRef.current;
      if (shouldReconcileQuizSets) reconcile.quizSets = quizSetsRef.current;
      if (shouldReconcileFolders) reconcile.quizFolders = quizFoldersRef.current;
      queueMicrotask(() => scheduleInstantDataCloudSave(reconcile));
    }
  };

  const runInstantTrashCloudSave = async (
    nextNotes: Note[],
    nextQuizzes: QuizItem[],
    nextSets: QuizSet[],
    nextFolders: QuizFolder[],
  ) => {
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    const syncedAt = Date.now();
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = syncedAt;
    try {
      await update(dbRef(database, `users/${u.uid}`), {
        notes: compactNotesForListCache(nextNotes),
        quizzes: nextQuizzes,
        quizSets: nextSets,
        quizFolders: nextFolders,
        trashEmptiedAt: readTrashEmptiedAt(),
        cloudSyncAt: syncedAt,
      });
      permDeletedRef.current = await appendPermDeletedCloud(u.uid, permDeletedRef.current);
      saveFailedRef.current = false;
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      markPushedData({ notes: nextNotes, quizzes: nextQuizzes, quizSets: nextSets, quizFolders: nextFolders }, syncedAt);
    } catch {
      saveFailedRef.current = true;
      setCloudStatus('error');
    } finally {
      savesInFlight.current = Math.max(0, savesInFlight.current - 1);
      if (savesInFlight.current === 0 && !saveFailedRef.current) {
        const elapsed = Date.now() - savingStartedAt.current;
        const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
        const markSaved = () => setCloudStatus('saved');
        if (delay > 0) setTimeout(markSaved, delay);
        else markSaved();
      }
    }
  };

  const pushPermDeletedCloud = async (payload?: {
    notes?: Note[];
    quizzes?: QuizItem[];
    quizSets?: QuizSet[];
    quizFolders?: QuizFolder[];
  }) => {
    const u = userRef.current;
    if (!u) return;
    const syncedAt = Date.now();
    try {
      permDeletedRef.current = await appendPermDeletedCloud(u.uid, permDeletedRef.current);
      writePermDeleted(permDeletedRef.current);
      if (payload?.notes || payload?.quizzes || payload?.quizSets || payload?.quizFolders) {
        await update(dbRef(database, `users/${u.uid}`), {
          ...(payload?.notes ? { notes: compactNotesForListCache(payload.notes) } : {}),
          ...(payload?.quizzes ? { quizzes: payload.quizzes } : {}),
          ...(payload?.quizSets ? { quizSets: payload.quizSets } : {}),
          ...(payload?.quizFolders ? { quizFolders: payload.quizFolders } : {}),
          cloudSyncAt: syncedAt,
        });
      }
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      markPushedData(payload ?? {}, syncedAt);
    } catch (err) {
      console.error('[cloud-save] perm-delete push failed', err);
      saveFailedRef.current = true;
      setCloudStatus('error');
    }
  };

  const runInstantDataCloudSave = async (
    patch: {
      notes?: Note[];
      quizzes?: QuizItem[];
      quizSets?: QuizSet[];
      quizFolders?: QuizFolder[];
    },
    opts?: { trackInFlight?: boolean },
  ) => {
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    const safe: typeof patch = { ...patch };
    // Always send the latest structure from refs — a queued save captured before
    // create/delete must not overwrite the cloud array with a stale snapshot.
    if (safe.notes !== undefined) {
      safe.notes = compactNotesForListCache(
        stripPermDeletedNotes(notesRef.current, permDeletedRef.current),
      );
    }
    if (safe.quizzes !== undefined) {
      safe.quizzes = stripPermDeletedQuizzes(quizzesRef.current, permDeletedRef.current);
    }
    if (safe.quizSets !== undefined) {
      safe.quizSets = stripPermDeletedQuizSets(quizSetsRef.current, permDeletedRef.current);
    }
    if (safe.quizFolders !== undefined) safe.quizFolders = quizFoldersRef.current;
    if (safe.quizSets) {
      // Never push a shorter items[] heal over max-known / last-painted membership.
      // Soft-deletes (trashed tombstones) are intentional shrinks and must reach cloud.
      const itemTrash = quizItemTombstonesRef.current;
      const pushSets = honorQuizItemTrashTombstones(safe.quizSets, itemTrash);
      safe.quizSets = pushSets;
      const paintedHonored = honorQuizItemTrashTombstones(
        lastPaintedQuizSetsRef.current.length ? lastPaintedQuizSetsRef.current : pushSets,
        itemTrash,
      );
      const livePush = countLiveQuizItems(pushSets);
      const liveRef = countLiveQuizItems(
        honorQuizItemTrashTombstones(quizSetsRef.current, itemTrash),
      );
      const livePainted = countLiveQuizItems(paintedHonored);
      const maxKnown = [...maxKnownLiveBySetRef.current.values()].reduce((a, b) => a + b, 0);
      const softTrashOk = isQuizSetsLocalWriteSafe(
        pushSets,
        maxKnownLiveBySetRef.current,
        paintedHonored,
      );
      if ((livePush < liveRef || livePush < livePainted || livePush < maxKnown) && !softTrashOk) {
        recoveryLog('skipped instant quizSets short membership heal', {
          livePush,
          liveRef,
          livePainted,
          maxKnown,
        });
        delete safe.quizSets;
      }
    }
    if (safe.notes && safe.notes.length === 0 && everHadNotesRef.current) {
      recoveryLog('skipped instant notes wipe');
      delete safe.notes;
    }
    if (safe.quizzes && safe.quizzes.length === 0 && everHadQuizzesRef.current) {
      recoveryLog('skipped instant quizzes wipe');
      delete safe.quizzes;
    }
    if (safe.quizSets && !hasAnyUserQuizSetRows(safe.quizSets) && everHadSetsRef.current) {
      recoveryLog('skipped instant quizSets wipe');
      delete safe.quizSets;
    }
    if (!safe.notes && !safe.quizzes && !safe.quizSets && !safe.quizFolders) return;
    if (safe.notes?.length) everHadNotesRef.current = true;
    if (safe.quizzes?.length) everHadQuizzesRef.current = true;
    if (safe.quizSets && countUserQuizSets(safe.quizSets) > 0) everHadSetsRef.current = true;
    const syncedAt = Date.now();
    // Default: track so a hasty refresh right after Save is caught by beforeunload.
    // Callers that already wrap this in beginTrackedSave/endTrackedSave pass
    // trackInFlight:false so one logical save cannot double-count and leave
    // "Saving…" stuck after both writes finish.
    const track = opts?.trackInFlight !== false;
    if (track) beginTrackedSave();
    try {
      // No manual token fetch: update() authenticates over the SDK's own
      // realtime connection and never uses this REST token. getIdToken can hang
      // for up to 8 seconds on Chrome (stuck IndexedDB auth refresh — see
      // rtdb.ts), which held every instant save hostage on the critical path
      // between the user's click and a potential page refresh.
      await update(dbRef(database, `users/${u.uid}`), {
        ...safe,
        cloudSyncAt: syncedAt,
      });
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      markPushedData(safe, syncedAt);
      saveFailedRef.current = false;
      scheduleStorageBytesHint();
    } catch (err) {
      // This is the hot path for every quiz/note instant save. Swallowing the
      // failure used to leave the UI claiming "saved" while Firebase never got
      // the write (oversized payload, expired auth, offline) — the item then
      // vanished on the next reload with no hint why.
      console.error('[cloud-save] instant data save failed', err);
      saveFailedRef.current = true;
    } finally {
      if (track) endTrackedSave();
    }
  };

  const scheduleStorageBytesHint = () => {
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    if (storageBytesHintTimer.current) clearTimeout(storageBytesHintTimer.current);
    // Debounced — keeps admin panel storage fast without blocking note saves.
    storageBytesHintTimer.current = setTimeout(() => {
      storageBytesHintTimer.current = null;
      try {
        const bytes = new Blob([JSON.stringify({
          notes: notesRef.current,
          quizzes: quizzesRef.current,
          quizSets: quizSetsRef.current,
          quizFolders: quizFoldersRef.current,
          chats: chatsRef.current,
        })]).size;
        void update(dbRef(database, `users/${u.uid}/profile`), { storageBytes: bytes });
      } catch {
        /* ignore */
      }
    }, 2500);
  };

  const scheduleInstantDataCloudSave = (
    patch: {
      notes?: Note[];
      quizzes?: QuizItem[];
      quizSets?: QuizSet[];
      quizFolders?: QuizFolder[];
    },
    opts?: { trackInFlight?: boolean },
  ) => {
    if (!userRef.current || !loadedRef.current) return;
    // Always keep the pending patch even while a remote merge holds the lock —
    // dropping create/rename here made brand-new sets vanish after refresh.
    pendingInstantDataSaveRef.current = { ...pendingInstantDataSaveRef.current, ...patch };
    if (isApplyingRemoteRef.current) return;
    if (instantDataSaveQueuedRef.current) return;
    instantDataSaveQueuedRef.current = true;
    const trackInFlight = opts?.trackInFlight;
    queueMicrotask(() => {
      instantDataSaveQueuedRef.current = false;
      if (isApplyingRemoteRef.current) return;
      const nextPatch = pendingInstantDataSaveRef.current;
      pendingInstantDataSaveRef.current = null;
      if (nextPatch) {
        void runInstantDataCloudSave(
          nextPatch,
          trackInFlight === undefined ? undefined : { trackInFlight },
        );
      }
    });
  };

  const flushPendingInstantDataSave = () => {
    if (!pendingInstantDataSaveRef.current || isApplyingRemoteRef.current) return;
    scheduleInstantDataCloudSave({});
  };

  const runDraftDeleteCloudSave = async (deletedId: string) => {
    const u = userRef.current;
    if (!u || !draftsReadyRef.current) return;
    const syncedAt = Date.now();
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
    try {
      await update(dbRef(database, `users/${u.uid}`), {
        [`draftContents/${deletedId}`]: null,
        drafts: draftsRef.current.map((d) => d.id),
        draftId: draftCounter.current,
        deletedDraftIds: [...pendingDeletedDraftIdsRef.current],
        cloudSyncAt: syncedAt,
      });
      lastCloudDraftIdsRef.current = new Set(draftsRef.current.map((d) => d.id));
      saveFailedRef.current = false;
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
    } catch {
      saveFailedRef.current = true;
      setCloudStatus('error');
    } finally {
      savesInFlight.current = Math.max(0, savesInFlight.current - 1);
      if (savesInFlight.current === 0 && !saveFailedRef.current) {
        const elapsed = Date.now() - savingStartedAt.current;
        const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
        const markSaved = () => setCloudStatus('saved');
        if (delay > 0) setTimeout(markSaved, delay);
        else markSaved();
      }
    }
  };

  const applyDraftListFromCloud = (cloudDraftIds: string[]) => {
    const idSet = new Set(cloudDraftIds);
    lastCloudDraftIdsRef.current = idSet;
    for (const id of idSet) pendingLocalDraftIdsRef.current.delete(id);
    const next = draftsRef.current.filter((d) => {
      if (idSet.has(d.id)) return true;
      if (pendingDeletedDraftIdsRef.current.has(d.id)) return false;
      if (pendingLocalDraftIdsRef.current.has(d.id)) return true;
      if (draftSaveInFlightRef.current.has(d.id)) return true;
      const localEditAt = draftLocalEditAtRef.current.get(d.id) ?? d.updatedAt ?? 0;
      return Date.now() - localEditAt < 12_000;
    });
    if (JSON.stringify(next) === JSON.stringify(draftsRef.current)) return;
    draftsRef.current = next;
    setDrafts(next);
    safeSetItem('malacadhati_drafts', JSON.stringify(next));
  };

  const runDraftCloudSave = (keepalive = false) => {
    const u = userRef.current;
    if (!u || !draftsReadyRef.current || isApplyingRemoteRef.current) return;
    const dList = draftsRef.current;
    if (!hasDraftContent(dList) && pendingDeletedDraftIdsRef.current.size === 0) return;
    const draftPayload = buildDraftCloudPayload(dList);
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
    const syncedAt = Date.now();
    void rtdbFetch(`/users/${u.uid}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...draftPayload,
        cloudSyncAt: syncedAt,
      }),
      headers: { 'Content-Type': 'application/json' },
      keepalive,
    })
      .then((res) => {
        if (!res.ok) throw new Error('cloud-draft-save-failed');
        saveFailedRef.current = false;
        lastLocalSaveAt.current = syncedAt;
        lastAppliedRemoteSyncAt.current = syncedAt;
        setCloudSyncedAt(syncedAt);
        safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      })
      .catch(() => {
        saveFailedRef.current = true;
        setCloudStatus('error');
      })
      .finally(() => {
        savesInFlight.current = Math.max(0, savesInFlight.current - 1);
        if (savesInFlight.current === 0) {
          if (saveFailedRef.current) {
            setCloudStatus('error');
            return;
          }
          const elapsed = Date.now() - savingStartedAt.current;
          const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
          const markSaved = () => setCloudStatus('saved');
          if (delay > 0) setTimeout(markSaved, delay);
          else markSaved();
        }
      });
  };

  const runCloudSave = (forceCloud: boolean, keepalive = false) => {
    const u = userRef.current;
    if (!u || !loadedRef.current || isApplyingRemoteRef.current) return;
    const nextNotes = notesRef.current;
    const dList = draftsRef.current;
    const qList = quizzesRef.current;
    const chatList = chatsRef.current;
    const qsList = quizSetsRef.current;
    const qfList = quizFoldersRef.current;
    if (isEmptyUserPayload(nextNotes, qList, chatList, qsList, qfList, dList)) {
      recoveryLog('skipped cloud sync — empty user payload');
      return;
    }
    markEverHadContent(nextNotes, qList, qsList);
    void appendDataHistory(u.uid, {
      notes: nextNotes,
      quizzes: qList,
      chats: chatList,
      quizSets: qsList,
      quizFolders: qfList,
    });
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
    const draftPayload = buildDraftCloudPayload(dList);
    // Never PATCH empty collections over previously known non-empty cloud data.
    // (A race after a failed/partial load used to wipe notes/quizzes with [].)
    const body: Record<string, unknown> = {
      ...draftPayload,
      tokenUsage: tokenUsageRef.current,
      cloudSyncAt: Date.now(),
    };
    if (nextNotes.length > 0 || !everHadNotesRef.current) {
      body.notes = compactNotesForListCache(nextNotes);
    }
    else recoveryLog('skipped wiping notes with empty local array');
    if (qList.length > 0 || !everHadQuizzesRef.current) body.quizzes = qList;
    else recoveryLog('skipped wiping quizzes with empty local array');
    if (chatList.length > 0) body.chats = chatList;
    if (hasAnyUserQuizSetRows(qsList) || !everHadSetsRef.current) body.quizSets = qsList;
    else recoveryLog('skipped wiping quizSets with empty local array');
    if (qfList.length > 0) body.quizFolders = qfList;
    void rtdbFetch(`/users/${u.uid}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      keepalive,
    })
      .then((res) => {
          if (!res.ok) throw new Error('cloud-save-failed');
          saveFailedRef.current = false;
          const syncedAt = Date.now();
          lastLocalSaveAt.current = syncedAt;
          lastAppliedRemoteSyncAt.current = syncedAt;
          setCloudSyncedAt(syncedAt);
          safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
          scheduleStorageBytesHint();
        })
      .catch(() => {
        saveFailedRef.current = true;
        setCloudStatus('error');
      })
      .finally(() => {
        savesInFlight.current = Math.max(0, savesInFlight.current - 1);
        if (savesInFlight.current === 0) {
          if (saveFailedRef.current) {
            setCloudStatus('error');
            return;
          }
          const elapsed = Date.now() - savingStartedAt.current;
          const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
          const markSaved = () => setCloudStatus('saved');
          if (delay > 0) setTimeout(markSaved, delay);
          else markSaved();
        }
      });
  };

  const scheduleDraftCloudSave = () => {
    if (!userRef.current || !draftsReadyRef.current || isApplyingRemoteRef.current) {
      pendingDraftCloudSaveRef.current = true;
      return;
    }
    if (draftCloudTimer.current) clearTimeout(draftCloudTimer.current);
    draftCloudTimer.current = setTimeout(() => {
      draftCloudTimer.current = null;
      runDraftCloudSave();
    }, 120);
  };

  const flushPersist = () => {
    if (localSaveTimer.current) {
      clearTimeout(localSaveTimer.current);
      localSaveTimer.current = null;
    }
    writeLocalCache();
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (draftCloudTimer.current) {
      clearTimeout(draftCloudTimer.current);
      draftCloudTimer.current = null;
    }
    const nextNotes = notesRef.current;
    const dList = draftsRef.current;
    const qList = quizzesRef.current;
    const chatList = chatsRef.current;
    const qsList = quizSetsRef.current;
    const qfList = quizFoldersRef.current;
    if (
      loadedRef.current
      && !isEmptyUserPayload(nextNotes, qList, chatList, qsList, qfList, dList)
    ) {
      runCloudSave(true, true);
    } else if (draftsReadyRef.current && (hasDraftContent(dList) || pendingDeletedDraftIdsRef.current.size > 0)) {
      runDraftCloudSave(true);
    }
  };

  const persist = (overrides?: PersistSnapshot, forceCloud = false, draftPriority = false) => {
    const snap: Required<PersistSnapshot> = {
      notes: overrides?.notes ?? notesRef.current,
      drafts: overrides?.drafts ?? draftsRef.current,
      quizzes: overrides?.quizzes ?? quizzesRef.current,
      chats: overrides?.chats ?? chatsRef.current,
      quizSets: overrides?.quizSets ?? quizSetsRef.current,
      quizFolders: overrides?.quizFolders ?? quizFoldersRef.current,
    };
    notesRef.current = snap.notes;
    draftsRef.current = snap.drafts;
    quizzesRef.current = snap.quizzes;
    chatsRef.current = snap.chats;
    quizSetsRef.current = snap.quizSets;
    quizFoldersRef.current = snap.quizFolders;
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    localSaveTimer.current = setTimeout(() => {
      localSaveTimer.current = null;
      writeLocalCache();
    }, forceCloud ? 0 : 600);
    if (forceCloud) writeLocalCache();
    if (!user || isApplyingRemoteRef.current) {
      if (overrides?.drafts) pendingDraftCloudSaveRef.current = true;
      return;
    }
    if (overrides?.drafts && draftsReadyRef.current && !loadedRef.current) {
      if (forceCloud) runDraftCloudSave();
      else scheduleDraftCloudSave();
      return;
    }
    if (!loadedRef.current) {
      if (overrides?.drafts) pendingDraftCloudSaveRef.current = true;
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const delay = forceCloud ? 0 : draftPriority ? 200 : 600;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      runCloudSave(forceCloud);
    }, delay);
  };

  const applyRemoteSnapshot = (cloud: Record<string, unknown>) => {
    if (typeof cloud.cloudSyncAt === 'number' && cloud.cloudSyncAt > 0) {
      lastAppliedRemoteSyncAt.current = cloud.cloudSyncAt;
    }
    pendingDeletedDraftIdsRef.current = mergeDeletedDraftIds(pendingDeletedDraftIdsRef.current, cloud);
    permDeletedRef.current = mergePermDeleted(permDeletedRef.current, cloud);
    const emptiedAtPull = mergeTrashEmptiedAt(cloud);
    quizSetTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizSetTombstonesRef.current,
      QUIZ_SET_TRASH_TOMBSTONE_KEY,
      emptiedAtPull,
    );
    quizFolderTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizFolderTombstonesRef.current,
      QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
      emptiedAtPull,
    );
    quizItemTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizItemTombstonesRef.current,
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      emptiedAtPull,
    );
    noteTrashTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      noteTrashTombstonesRef.current,
      NOTE_TRASH_TOMBSTONE_KEY,
      emptiedAtPull,
    );
    const tombstones = permDeletedRef.current;
    const remoteNotes = incomingNotesSafe(
      firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>),
    );
    if (remoteNotes.length) rememberServerNotesCatalog(remoteNotes);
    const remoteQuizzes = firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>);
    const remoteChats = firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>)
      .map((c) => ({ ...c, messages: c.messages ?? [] }));
    const remoteSets = firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>)
      .map((set) => ({ ...set, items: set.items ?? [] }));
    const remoteFolders = firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
    const remoteDrafts = parseCloudDrafts(cloud).filter((draft) => !pendingDeletedDraftIdsRef.current.has(draft.id));
    lastCloudDraftIdsRef.current = new Set(parseCloudDrafts(cloud).map((d) => d.id));

    const mergedNotes = filterResurrectedTrash(
      stripPermDeletedNotes(
        adoptNotesSafe(
          mergeNotesForSync(notesRef.current, remoteNotes, tombstones),
          remoteNotes,
          true,
        ),
        permDeletedRef.current,
      ),
      notesRef.current,
    );
    let mergedQuizzes = stripPermDeletedQuizzes(
      filterResurrectedTrash(mergeQuizzesForSync(quizzesRef.current, remoteQuizzes, tombstones), quizzesRef.current),
      tombstones,
    );
    const mergedChats = mergeChatsForSync(chatsRef.current, remoteChats);
    let mergedSets = filterResurrectedTrash(
      mergeQuizSetsForSync(quizSetsRef.current, remoteSets, tombstones),
      quizSetsRef.current,
      quizSetTombstonesRef.current,
    );
    if (quizSetsByIdCacheRef.current.length) {
      mergedSets = preferRicherQuizSetsMembership(
        adoptByIdMembershipWhenRicher(mergedSets, quizSetsByIdCacheRef.current),
        quizSetsByIdCacheRef.current,
      );
    }
    let mergedFolders = filterResurrectedTrash(
      mergeFoldersForSync(quizFoldersRef.current, remoteFolders, tombstones, {
        remoteIsAuthority: quizFoldersByIdCacheRef.current.length > 0 || 'quizFolders' in cloud,
      }),
      quizFoldersRef.current,
      quizFolderTombstonesRef.current,
    );
    if (quizFoldersByIdCacheRef.current.length) {
      mergedFolders = mergeFoldersForSync(mergedFolders, quizFoldersByIdCacheRef.current, tombstones, {
        remoteIsAuthority: true,
      });
    }
    // Soft-deletes made on another device survive this pull even if the cloud
    // array it just fetched still carries a stale live copy of the row.
    const trashStamp = nowStr();
    mergedSets = honorQuizItemTrashTombstones(
      applyTrashTombstones(mergedSets, quizSetTombstonesRef.current, trashStamp),
      quizItemTombstonesRef.current,
      trashStamp,
    );
    mergedQuizzes = stripPermDeletedQuizzes(
      honorQuizItemTrashTombstonesOnItems(
        mergedQuizzes,
        quizItemTombstonesRef.current,
        trashStamp,
      ),
      tombstones,
    );
    mergedFolders = applyTrashTombstones(mergedFolders, quizFolderTombstonesRef.current, trashStamp);
    const healQuizSets = quizSetsMissingFromRemote(mergedSets, remoteSets)
      || quizSetsRemoteMembershipIncomplete(mergedSets, remoteSets);
    const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
    const mergedDrafts = recentDraftEdit
      ? filterVisibleDrafts(draftsRef.current, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current)
      : mergeDraftsForPull(
        draftsRef.current,
        remoteDrafts,
        cloud,
        pendingDeletedDraftIdsRef.current,
        pendingLocalDraftIdsRef.current,
      );

    const normalizedFolders = finalizeQuizFolders(mergedFolders, mergedSets);
    const normalizedSets = initializeQuizColors(
      mergedSets,
      normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    );

    let changed = false;
    if (
      notesBodiesRicher(mergedNotes, notesRef.current)
      || !notesFlagsEqual(mergedNotes, notesRef.current)
      || !notesMetaEqual(mergedNotes, notesRef.current)
    ) {
      notesRef.current = mergedNotes;
      setNotes(mergedNotes);
      writeNotesListCache(mergedNotes);
      rememberNotesBootCache(mergedNotes, true);
      changed = true;
    }
    const uid = userRef.current?.uid;
    const stillMissing = notesRef.current.filter((n) => !noteHasDisplayableImage(n.html));
    if (uid && stillMissing.length) {
      void Promise.all(stillMissing.map(async (note) => {
        const one = await fetchNoteByIdCloud(uid, Number(note.id));
        if (!one || !noteHasDisplayableImage(one.html)) return;
        const safe = incomingNotesSafe([one]);
        if (!safe.length) return;
        const next = sortNotesByCreatedDesc(mergeNotesPreferRicher(notesRef.current, safe));
        if (!notesBodiesRicher(next, notesRef.current)) return;
        notesRef.current = next;
        setNotes(next);
        writeNotesListCache(next);
        rememberNotesBootCache(next, true);
      }));
    }
    if (JSON.stringify(mergedQuizzes) !== JSON.stringify(quizzesRef.current)) {
      setQuizzes(mergedQuizzes);
      safeSetItem('malacadhati_quiz', JSON.stringify(mergedQuizzes));
      changed = true;
    }
    if (JSON.stringify(mergedChats) !== JSON.stringify(chatsRef.current)) {
      setChats(mergedChats);
      safeSetItem('malacadhati_chats', JSON.stringify(mergedChats));
      changed = true;
    }
    // Always commit when UI is empty/under-hydrated even if refs already match
    // (ById fold may have updated refs without setQuizSets — classic 0-set bug).
    if (
      JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)
      || healQuizSets
      || shouldHydrateQuizSetsUi(lastPaintedQuizSetsRef.current, normalizedSets)
      || (lastPaintedQuizSetsRef.current.length === 0 && normalizedSets.length > 0)
    ) {
      commitQuizSetsFromRemote(normalizedSets);
      changed = true;
    }
    if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
      quizFoldersRef.current = normalizedFolders;
      setQuizFolders(normalizedFolders);
      safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
      changed = true;
    }
    if (JSON.stringify(mergedDrafts) !== JSON.stringify(draftsRef.current)) {
      setDrafts(mergedDrafts);
      draftsRef.current = mergedDrafts;
      safeSetItem('malacadhati_drafts', JSON.stringify(mergedDrafts));
      changed = true;
    }
    if (changed) recoveryLog('applied remote cloud snapshot');
    // Publish union upward when cloud array was missing live sets — never shrink.
    // NEVER heal-push an empty quizSets[] (would wipe cloud). Empty local is not authority.
    // NEVER heal-push quizFolders from local ghosts (resurrects deleted folders).
    if (healQuizSets) {
      if (
        hasAnyUserQuizSetRows(quizSetsRef.current)
        && countUserQuizSets(quizSetsRef.current) > 0
      ) {
        queueMicrotask(() => scheduleInstantDataCloudSave({ quizSets: quizSetsRef.current }));
      } else {
        recoveryLog('skipped empty quizSets heal-push over cloud');
      }
    }
  };

  const pullDraftsFromCloud = async (force = false) => {
    const u = userRef.current;
    if (!u || !draftsReadyRef.current || isApplyingRemoteRef.current) return;
    if (!force && (savesInFlight.current > 0 || draftCloudTimer.current)) return;
    if (!force && Date.now() - lastDraftEditAt.current < 2500) return;
    try {
      const bundle = await fetchCloudDraftBundle(u.uid, () => u.getIdToken());
      const remoteSyncAt = typeof bundle.cloudSyncAt === 'number' ? bundle.cloudSyncAt : 0;
      if (!force && remoteSyncAt > 0 && Math.abs(remoteSyncAt - lastLocalSaveAt.current) < 500) return;
      isApplyingRemoteRef.current = true;
      applyCloudDraftBundle(bundle);
    } catch {
      /* ignore draft pull errors */
    } finally {
      isApplyingRemoteRef.current = false;
    }
  };

  const pullFromCloud = async (force = false) => {
    const u = userRef.current;
    if (!u || isApplyingRemoteRef.current) return;
    if (!loadedRef.current && !force) return;
    if (force) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    } else if (saveTimer.current || savesInFlight.current > 0 || draftCloudTimer.current) {
      return;
    }
    if (!force) {
      const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
      if (recentDraftEdit && hasDraftContent(draftsRef.current)) return;
      const localDraftsEmpty = !hasDraftContent(draftsRef.current);
      if (!localDraftsEmpty && Date.now() - lastLocalSaveAt.current < 800) return;
    }
    try {
      const [cloud, byIdSets, byIdFolders, cloudNoteKeys] = await Promise.all([
        loadedRef.current ? fetchCloudSyncBundle(u.uid) : Promise.resolve(null),
        fetchQuizSetsByIdCloud(u.uid),
        fetchQuizFoldersByIdCloud(u.uid),
        fetchNotesByIdKeysCloud(u.uid),
      ]);
      const have = new Set(notesRef.current.map((n) => Number(n.id)));
      const missingIds = cloudNoteKeys.filter((id) => !have.has(id));
      if (missingIds.length) {
        const incoming: Note[] = [];
        let cursor = 0;
        const worker = async () => {
          while (cursor < missingIds.length) {
            const id = missingIds[cursor++];
            const one = await fetchNoteByIdCloud(u.uid, id);
            if (one) incoming.push(one);
          }
        };
        await Promise.all(Array.from({ length: Math.min(6, missingIds.length) }, () => worker()));
        if (incoming.length) {
          const merged = sortNotesByCreatedDesc(
            stripPermDeletedNotes(adoptNotesSafe(notesRef.current, incoming, true), permDeletedRef.current),
          );
          notesRef.current = merged;
          setNotes(merged);
          writeNotesListCache(merged);
          rememberNotesBootCache(merged, true);
        }
      }
      if (!cloud) return;
      if (byIdSets.length) {
        quizSetsByIdCacheRef.current = unionQuizSetsFromById(
          quizSetsByIdCacheRef.current,
          byIdSets,
          permDeletedRef.current,
        );
      }
      if (byIdFolders.length) {
        quizFoldersByIdCacheRef.current = mergeById(quizFoldersByIdCacheRef.current, byIdFolders);
      }
      isApplyingRemoteRef.current = true;
      applyRemoteSnapshot(cloud);
    } catch {
      /* ignore pull errors */
    } finally {
      isApplyingRemoteRef.current = false;
      flushPendingInstantDataSave();
    }
  };

  /**
   * Every write from the other device bumps cloudSyncAt, so a burst (someone
   * typing a quiz answer) used to fire one full reconcile pull per tick. The
   * realtime listeners already deliver the content itself; this pull only exists
   * to reconcile membership/order, so space bursts out instead of racing them.
   */
  const REMOTE_PULL_MIN_GAP_MS = 1500;
  const scheduleRemotePull = (force = true) => {
    if (pendingRemotePullRef.current) return;
    pendingRemotePullRef.current = true;
    const sinceLast = Date.now() - lastRemotePullAt.current;
    const delay = force ? Math.max(0, REMOTE_PULL_MIN_GAP_MS - sinceLast) : 400;
    window.setTimeout(() => {
      pendingRemotePullRef.current = false;
      lastRemotePullAt.current = Date.now();
      void pullFromCloud(force);
    }, delay);
  };

  /** Same coalescing for the draft bundle — draftContents child listeners are
   *  the live path; this is the catch-up read. */
  const scheduleRemoteDraftPull = () => {
    if (draftPullDebounceRef.current) return;
    draftPullDebounceRef.current = setTimeout(() => {
      draftPullDebounceRef.current = null;
      void pullDraftsFromCloud(true);
    }, 600);
  };

  useEffect(() => {
    if (!user || !draftsReady) return;
    if (!pendingDraftCloudSaveRef.current) return;
    pendingDraftCloudSaveRef.current = false;
    scheduleDraftCloudSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftsReady, user?.uid]);

  useEffect(() => {
    if (!user || !draftsReady) return;
    const uid = user.uid;
    const contentsRef = dbRef(database, `users/${uid}/draftContents`);
    const handleRemote = (snap: { key: string | null; val: () => unknown }) => {
      const id = snap.key;
      if (!id) return;
      isApplyingRemoteRef.current = true;
      try {
        applySingleRemoteDraft(id, snap.val() as { title?: string; html?: string; updatedAt?: number } | null);
      } finally {
        isApplyingRemoteRef.current = false;
      }
    };
    const unsubChanged = onChildChanged(contentsRef, handleRemote);
    const unsubAdded = onChildAdded(contentsRef, handleRemote);
    const unsubRemoved = onChildRemoved(contentsRef, (snap) => {
      const id = snap.key;
      if (!id) return;
      isApplyingRemoteRef.current = true;
      try {
        applySingleRemoteDraft(id, null);
      } finally {
        isApplyingRemoteRef.current = false;
      }
    });
    const unsubDrafts = onValue(dbRef(database, `users/${uid}/drafts`), (snap) => {
      const ids = firebaseToArray<string>(snap.val() as string[] | Record<string, string> | null).map(String).filter(Boolean);
      isApplyingRemoteRef.current = true;
      try {
        applyDraftListFromCloud(ids);
      } finally {
        isApplyingRemoteRef.current = false;
      }
    });
    const unsubDeleted = onValue(dbRef(database, `users/${uid}/deletedDraftIds`), (snap) => {
      const ids = firebaseToArray<string>(snap.val() as string[] | Record<string, string> | null).map(String).filter(Boolean);
      pendingDeletedDraftIdsRef.current = new Set([...pendingDeletedDraftIdsRef.current, ...ids]);
      writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
      const next = filterVisibleDrafts(draftsRef.current, pendingDeletedDraftIdsRef.current, pendingLocalDraftIdsRef.current);
      if (JSON.stringify(next) !== JSON.stringify(draftsRef.current)) {
        draftsRef.current = next;
        setDrafts(next);
        safeSetItem('malacadhati_drafts', JSON.stringify(next));
      }
    });
    return () => {
      unsubChanged();
      unsubAdded();
      unsubRemoved();
      unsubDrafts();
      unsubDeleted();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, draftsReady]);

  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    void pullFromCloud(true);
    const unsubPermDeleted = onValue(dbRef(database, `users/${uid}/permanentlyDeletedIds`), (snap) => {
      const remote = parsePermDeletedVal(snap.val());
      const merged = addPermDeleted(permDeletedRef.current, remote);
      if (JSON.stringify(merged) === JSON.stringify(permDeletedRef.current)) return;
      permDeletedRef.current = merged;
      writePermDeleted(merged);
      isApplyingRemoteRef.current = true;
      try {
        const changed = applyPermDeletedLocally();
        if (changed) recoveryLog('applied remote permanently-deleted tombstones');
      } finally {
        isApplyingRemoteRef.current = false;
      }
    });
    const unsubTrashEmptied = onValue(dbRef(database, `users/${uid}/trashEmptiedAt`), (snap) => {
      const remote = Number(snap.val());
      if (!Number.isFinite(remote) || remote <= 0) return;
      const prev = readTrashEmptiedAt();
      if (remote <= prev) return;
      writeTrashEmptiedAt(remote);
      quizSetTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
        quizSetTombstonesRef.current,
        QUIZ_SET_TRASH_TOMBSTONE_KEY,
        remote,
      );
      quizFolderTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
        quizFolderTombstonesRef.current,
        QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
        remote,
      );
      quizItemTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
        quizItemTombstonesRef.current,
        QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
        remote,
      );
      noteTrashTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
        noteTrashTombstonesRef.current,
        NOTE_TRASH_TOMBSTONE_KEY,
        remote,
      );
      // Drop emptied ghosts immediately so Trash matches the device that emptied.
      applyPermDeletedLocally();
      applyTrashTombstonesToState();
      const nextNotes = filterResurrectedTrash(notesRef.current, notesRef.current);
      const nextQuizzes = filterResurrectedTrash(quizzesRef.current, quizzesRef.current);
      if (JSON.stringify(nextNotes) !== JSON.stringify(notesRef.current)) {
        notesRef.current = nextNotes;
        setNotes(nextNotes);
        safeSetItem('malacadhati', JSON.stringify(nextNotes));
      }
      if (JSON.stringify(nextQuizzes) !== JSON.stringify(quizzesRef.current)) {
        quizzesRef.current = nextQuizzes;
        setQuizzes(nextQuizzes);
        safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
      }
    });
    // Whole-array nodes: Firebase re-delivers the complete value of every
    // onValue listener after each reconnect, and mobile Safari drops the socket
    // constantly (backgrounding, network switches, even long scrolls). Re-running
    // the array merges on a payload we already applied replaced notes/quizSets/
    // quizFolders wholesale every time — that is what made the page blink and
    // feel like it had reloaded itself. Skip snapshots byte-identical to the last
    // one applied, and coalesce a burst of nodes into one merge pass so four
    // listeners firing together cost one state update instead of four.
    const lastAppliedArrayJson = new Map<string, string>();
    let arrayPatch: Parameters<typeof applyRemoteTrashData>[0] = {};
    let arrayPatchTimer: ReturnType<typeof setTimeout> | null = null;
    const flushArrayPatch = () => {
      arrayPatchTimer = null;
      const patch = arrayPatch;
      arrayPatch = {};
      if (Object.keys(patch).length) applyRemoteTrashData(patch);
    };
    const bindRealtime = <T,>(path: string, key: 'notes' | 'quizzes' | 'quizSets' | 'quizFolders', map?: (val: unknown) => T) =>
      onValue(dbRef(database, `users/${uid}/${path}`), (snap) => {
        const val = snap.val();
        // Bail before recording: a snapshot applyRemoteTrashData would refuse
        // (not loaded yet) must not poison the dedupe cache, or the change would
        // never be applied at all.
        if (val == null || !loadedRef.current) return;
        const json = JSON.stringify(val);
        if (lastAppliedArrayJson.get(key) === json) return;
        lastAppliedArrayJson.set(key, json);
        arrayPatch = { ...arrayPatch, [key]: map ? map(val) : val };
        if (arrayPatchTimer) return;
        arrayPatchTimer = setTimeout(flushArrayPatch, 60);
      });
    const unsubNotes = bindRealtime('notes', 'notes');
    const unsubQuizzes = bindRealtime('quizzes', 'quizzes');
    const unsubSets = bindRealtime('quizSets', 'quizSets', (val) =>
      firebaseToArray<QuizSet>(val as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] })));
    const unsubFolders = bindRealtime('quizFolders', 'quizFolders');

    // Tiny Manual Egen order mirror — keeps set-list order identical across devices
    // without rewriting question bodies through ById.
    const unsubSetsListOrder = onValue(dbRef(database, `users/${uid}/quizSetsListOrder`), (snap) => {
      const val = snap.val();
      if (val == null || !loadedRef.current) return;
      if (!ingestQuizSetsListOrder(val)) return;
      const next = applyStoredQuizSetsListOrder(quizSetsRef.current);
      if (quizSetsEqualForUI(next, quizSetsRef.current)) return;
      quizSetsRef.current = next;
      setQuizSets(next);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
      writeQuizSetsShellJournal(next);
    });

    // AI chat conversations had no listener at all: a chat started on the phone
    // only showed up on the desktop after a refresh or the 60s poll.
    let lastAppliedChatsJson = '';
    const unsubChats = onValue(dbRef(database, `users/${uid}/chats`), (snap) => {
      const val = snap.val();
      if (val == null || !loadedRef.current) return;
      const json = JSON.stringify(val);
      if (json === lastAppliedChatsJson) return;
      lastAppliedChatsJson = json;
      const remote = firebaseToArray<ChatConversation>(val as ChatConversation[] | Record<string, ChatConversation>)
        .map((c) => ({ ...c, messages: c.messages ?? [] }));
      const merged = mergeChatsForSync(chatsRef.current, remote);
      if (JSON.stringify(merged) === JSON.stringify(chatsRef.current)) return;
      chatsRef.current = merged;
      setChats(merged);
      safeSetItem('malacadhati_chats', JSON.stringify(merged));
    });

    // Token counter is a single number — cheap to keep live so the AI quota
    // shown on one device reflects usage from the other.
    const unsubTokenUsage = onValue(dbRef(database, `users/${uid}/tokenUsage`), (snap) => {
      const remote = Number(snap.val());
      if (!Number.isFinite(remote) || remote < 0) return;
      setTokenUsage((prev) => (prev === remote ? prev : remote));
    });

    // Per-id folder/set mirrors — create/delete appears on other devices even when
    // the full quizFolders/quizSets array write is delayed or dropped.
    const foldersByIdRef = dbRef(database, `users/${uid}/quizFoldersById`);
    const unsubFolderAdded = onChildAdded(foldersByIdRef, (snap) => applyRemoteFolderById(snap.val()));
    const unsubFolderChanged = onChildChanged(foldersByIdRef, (snap) => applyRemoteFolderById(snap.val()));
    const unsubFolderRemoved = onChildRemoved(foldersByIdRef, (snap) => {
      const id = String(snap.key || '');
      if (!id) return;
      // Do NOT fabricate trash — that could hide a live folder. Only drop cache
      // entry; hard-delete requires permanentlyDeletedIds.
      quizFoldersByIdCacheRef.current = quizFoldersByIdCacheRef.current.filter((f) => f.id !== id);
      if (permDeletedRef.current.quizFolders.includes(id)) {
        applyRemoteFolderById({
          id,
          name: '',
          createdAt: new Date().toISOString(),
          trashed: true,
          deletedAt: nowStr(),
          updatedAt: new Date().toISOString(),
        } as QuizFolder);
      }
    });
    const setsByIdRef = dbRef(database, `users/${uid}/quizSetsById`);
    const unsubSetAdded = onChildAdded(setsByIdRef, (snap) => applyRemoteSetById(snap.val()));
    const unsubSetChanged = onChildChanged(setsByIdRef, (snap) => applyRemoteSetById(snap.val()));
    const unsubSetRemoved = onChildRemoved(setsByIdRef, (snap) => {
      const id = String(snap.key || '');
      if (!id) return;
      // Never soft-delete a live set from a ById key removal alone.
      quizSetsByIdCacheRef.current = quizSetsByIdCacheRef.current.filter((s) => s.id !== id);
      if (permDeletedRef.current.quizSets.includes(id)) {
        const filtered = quizSetsRef.current.filter((s) => s.id !== id);
        if (filtered.length === quizSetsRef.current.length) return;
        quizSetsRef.current = filtered;
        setQuizSets(filtered);
        safeSetItem('malacadhati_quiz_sets', JSON.stringify(filtered));
      }
    });

    // Soft-delete signal on its own tiny id -> timestamp node. The same
    // `trashed` flag also rides along in quizSetsById/quizSets, but those
    // payloads carry every question (and inline images) of every set, so on
    // mobile they can land seconds later or lose a merge race against a stale
    // live copy — this node is a few bytes and applies the delete immediately.
    // Attaching fires one child event per existing tombstone — coalesce them
    // into a single state pass instead of re-scanning every set each time.
    let trashApplyTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTrashTombstoneApply = () => {
      if (trashApplyTimer) return;
      trashApplyTimer = setTimeout(() => {
        trashApplyTimer = null;
        applyTrashTombstonesToState();
      }, 0);
    };
    const bindTrashTombstoneNode = (path: 'sets' | 'folders' | 'items') => {
      const node = dbRef(database, `users/${uid}/quizTrash/${path}`);
      const key = path === 'sets'
        ? QUIZ_SET_TRASH_TOMBSTONE_KEY
        : path === 'folders'
          ? QUIZ_FOLDER_TRASH_TOMBSTONE_KEY
          : QUIZ_ITEM_TRASH_TOMBSTONE_KEY;
      const currentTombstones = () => (
        path === 'sets'
          ? quizSetTombstonesRef.current
          : path === 'folders'
            ? quizFolderTombstonesRef.current
            : quizItemTombstonesRef.current
      );
      const commit = (next: TrashTombstones) => {
        if (path === 'sets') quizSetTombstonesRef.current = next;
        else if (path === 'folders') quizFolderTombstonesRef.current = next;
        else quizItemTombstonesRef.current = next;
        scheduleTrashTombstoneApply();
      };
      const mark = (snap: { key: string | null; val: () => unknown }) => {
        const id = String(snap.key || '');
        const at = Number(snap.val());
        if (!id || !Number.isFinite(at) || at <= 0) return;
        if (path === 'sets' && permDeletedRef.current.quizSets.includes(id)) return;
        if (path === 'folders' && permDeletedRef.current.quizFolders.includes(id)) return;
        if (path === 'items' && permDeletedRef.current.quizzes.includes(Number(id))) return;
        const emptiedAt = readTrashEmptiedAt();
        // Stale soft-delete markers left over after Empty Trash must not re-open Trash.
        if (emptiedAt && at <= emptiedAt) return;
        const current = currentTombstones();
        if ((current[id] ?? 0) >= at) return;
        commit(markTrashTombstone(key, current, id, at));
      };
      const unsubAdded = onChildAdded(node, mark);
      const unsubChanged = onChildChanged(node, mark);
      // Restore / permanent delete elsewhere — stop forcing the soft-delete so
      // the restored row can come back through quizSetsById.
      const unsubRemoved = onChildRemoved(node, (snap) => {
        const id = String(snap.key || '');
        if (!id) return;
        const current = currentTombstones();
        if (!(id in current)) return;
        commit(clearTrashTombstone(key, current, id));
      });
      return () => {
        unsubAdded();
        unsubChanged();
        unsubRemoved();
      };
    };
    const unsubSetTrash = bindTrashTombstoneNode('sets');
    const unsubFolderTrash = bindTrashTombstoneNode('folders');
    const unsubItemTrash = bindTrashTombstoneNode('items');
    const notesTrashNode = dbRef(database, `users/${uid}/quizTrash/notes`);
    const unsubNoteTrashAdded = onChildAdded(notesTrashNode, (snap) => {
      const id = String(snap.key || '');
      const at = Number(snap.val());
      if (!id || !Number.isFinite(at) || at <= 0) return;
      if (permDeletedRef.current.notes.some((deadId) => Number(deadId) === Number(id))) return;
      const emptiedAt = readTrashEmptiedAt();
      if (emptiedAt && at <= emptiedAt) return;
      if ((noteTrashTombstonesRef.current[id] ?? 0) >= at) return;
      noteTrashTombstonesRef.current = markTrashTombstone(
        NOTE_TRASH_TOMBSTONE_KEY,
        noteTrashTombstonesRef.current,
        id,
        at,
      );
      localTrashIdsRef.current.add(Number(id));
      scheduleTrashTombstoneApply();
    });
    const unsubNoteTrashRemoved = onChildRemoved(notesTrashNode, (snap) => {
      const id = String(snap.key || '');
      if (!id || !(id in noteTrashTombstonesRef.current)) return;
      noteTrashTombstonesRef.current = clearTrashTombstone(
        NOTE_TRASH_TOMBSTONE_KEY,
        noteTrashTombstonesRef.current,
        id,
      );
      localTrashIdsRef.current.delete(Number(id));
    });

    // Instant quiz item sync (add/edit/delete) — tiny per-item path, not the
    // multi-MB quizSets array. Child listeners keep live typing snappy; a full
    // onValue would re-download every question on each keystroke.
    let quizItemApplyQueue: StoredQuizItem[] = [];
    const applyQuizItemsBatch = (durable: StoredQuizItem[]) => {
      if (!durable.length) return;
      if (isApplyingRemoteRef.current) {
        // Never drop live keystrokes because another merge is in flight.
        quizItemApplyQueue.push(...durable);
        return;
      }
      const deadQuizzes = new Set(
        permDeletedRef.current.quizzes.map(Number).filter(Number.isFinite),
      );
      // Ignore tombstoned rows — never DELETE them on every child event (that
      // blocked normal note/quiz sync for tens of seconds after reconnect).
      const liveDurable = durable.filter((item) => {
        const id = Number(item.id);
        return Number.isFinite(id) && !deadQuizzes.has(id);
      });
      if (!liveDurable.length) {
        if (quizItemApplyQueue.length) {
          const more = quizItemApplyQueue;
          quizItemApplyQueue = [];
          queueMicrotask(() => applyQuizItemsBatch(more));
        }
        return;
      }
      const itemTrash = quizItemTombstonesRef.current;
      const appliedRaw = applyDurableQuizItems(quizzesRef.current, quizSetsRef.current, liveDurable);
      const applied = {
        quizzes: honorQuizItemTrashTombstonesOnItems(appliedRaw.quizzes, itemTrash)
          .filter((q) => !deadQuizzes.has(Number(q.id))),
        sets: stripPermDeletedQuizSets(
          honorQuizItemTrashTombstones(appliedRaw.sets, itemTrash),
          permDeletedRef.current,
        ),
      };
      const quizzesChanged = JSON.stringify(applied.quizzes) !== JSON.stringify(quizzesRef.current);
      const setsChanged = JSON.stringify(applied.sets) !== JSON.stringify(quizSetsRef.current);
      if (!quizzesChanged && !setsChanged) {
        if (quizItemApplyQueue.length) {
          const more = quizItemApplyQueue;
          quizItemApplyQueue = [];
          queueMicrotask(() => applyQuizItemsBatch(more));
        }
        return;
      }
      isApplyingRemoteRef.current = true;
      try {
        if (quizzesChanged) {
          const prev = quizzesRef.current;
          quizzesRef.current = applied.quizzes;
          safeSetItem('malacadhati_quiz', JSON.stringify(applied.quizzes));
          if (!quizzesEqualForUI(applied.quizzes, prev)) setQuizzes(applied.quizzes);
        }
        if (setsChanged) {
          commitQuizSetsFromRemote(applied.sets);
        }
      } finally {
        isApplyingRemoteRef.current = false;
        if (quizItemApplyQueue.length) {
          const more = quizItemApplyQueue;
          quizItemApplyQueue = [];
          queueMicrotask(() => applyQuizItemsBatch(more));
        } else {
          flushPendingRemoteById();
          flushPendingInstantDataSave();
        }
      }
    };

    let quizItemChildBuffer: StoredQuizItem[] = [];
    let quizItemChildFlush: ReturnType<typeof setTimeout> | null = null;
    const queueQuizItemChild = (val: unknown) => {
      if (!val || typeof val !== 'object') return;
      const item = val as StoredQuizItem;
      if (item.id == null) return;
      quizItemChildBuffer.push(item);
      if (quizItemChildFlush) return;
      quizItemChildFlush = setTimeout(() => {
        quizItemChildFlush = null;
        const batch = quizItemChildBuffer;
        quizItemChildBuffer = [];
        applyQuizItemsBatch(batch);
      }, 0);
    };

    const quizItemsRefPath = dbRef(database, `users/${uid}/quizItemsById`);
    const unsubQuizItemAdded = onChildAdded(quizItemsRefPath, (snap) => queueQuizItemChild(snap.val()));
    const unsubQuizItemChanged = onChildChanged(quizItemsRefPath, (snap) => queueQuizItemChild(snap.val()));
    const unsubQuizItemRemoved = onChildRemoved(quizItemsRefPath, (snap) => {
      const raw = snap.val();
      const id = typeof raw === 'object' && raw && 'id' in raw
        ? Number((raw as StoredQuizItem).id)
        : Number(snap.key);
      if (!Number.isFinite(id)) return;
      // Permanent delete / Empty Trash removes the ById node. Do NOT synthesize a
      // soft-delete row — that is what made Trash X flash back then vanish.
      if (permDeletedRef.current.quizzes.includes(id)) {
        const nextQuizzes = quizzesRef.current.filter((q) => q.id !== id);
        const nextSets = stripPermDeletedQuizSets(quizSetsRef.current, permDeletedRef.current);
        if (nextQuizzes.length !== quizzesRef.current.length) {
          quizzesRef.current = nextQuizzes;
          setQuizzes(nextQuizzes);
          safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
        }
        if (JSON.stringify(nextSets) !== JSON.stringify(quizSetsRef.current)) {
          quizSetsRef.current = nextSets;
          setQuizSets(nextSets);
          safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
        }
        return;
      }
      queueQuizItemChild({
        id,
        noteId: 0,
        noteTitle: '',
        question: '',
        answer: '',
        date: '',
        trashed: true,
        deletedAt: nowStr(),
        updatedAt: nowStr(),
        setId: null,
      } as StoredQuizItem);
    });

    // Same for notes: trash/restore must land via notesById so refresh cannot
    // resurrect a live IndexedDB copy over a soft-delete that only hit notes[].
    // Per-child events, not onValue: an onValue here re-downloaded EVERY note
    // (legacy base64 images included) whenever any single note changed anywhere,
    // and again after every socket reconnect. One edited note now costs one small
    // payload.
    let notesByIdBuffer: Note[] = [];
    let notesByIdFlush: ReturnType<typeof setTimeout> | null = null;
    const applyNotesByIdBatch = (durable: Note[]) => {
      if (!durable.length) return;
      if (isApplyingRemoteRef.current) {
        // Used to return outright, which silently dropped a remote note edit
        // whenever an array merge happened to hold the lock — the other device
        // then needed a manual refresh to see it.
        notesByIdBuffer.push(...durable);
        scheduleNotesByIdFlush();
        return;
      }
      const tombstones = permDeletedRef.current;
      const liveDurable = incomingNotesSafe(durable);
      if (!liveDurable.length) return;
      const merged = sortNotesByCreatedDesc(
        stripPermDeletedNotes(adoptNotesSafe(notesRef.current, liveDurable), tombstones),
      );
      if (
        notesIdSetEqual(merged, notesRef.current)
        && notesRef.current.length > 0
        && notesFlagsEqual(merged, notesRef.current)
        && !notesBodiesRicher(merged, notesRef.current)
      ) {
        notesRef.current = merged;
        return;
      }
      if (notesMetaEqual(merged, notesRef.current)) return;
      isApplyingRemoteRef.current = true;
      try {
        notesRef.current = merged;
        setNotes(merged);
        writeNotesListCache(merged);
        rememberNotesBootCache(merged);
      } finally {
        isApplyingRemoteRef.current = false;
        flushPendingInstantDataSave();
      }
    };
    function scheduleNotesByIdFlush(delayMs = 120) {
      // Trailing debounce — coalesce the full onChildAdded storm into one paint
      // so newest notes (highest ids) don't trickle in after older ones.
      if (notesByIdFlush) clearTimeout(notesByIdFlush);
      notesByIdFlush = setTimeout(() => {
        notesByIdFlush = null;
        const batch = notesByIdBuffer;
        notesByIdBuffer = [];
        applyNotesByIdBatch(batch);
      }, delayMs);
    }
    const queueNoteChild = (val: unknown, fromChange = false) => {
      if (!val || typeof val !== 'object') return;
      const note = val as Note;
      if (note.id == null) return;
      // onChildAdded replays every note oldest-id-first. Skip ids we already
      // have with an equal-or-richer body so image notes are not dripped last.
      // Never skip a richer body — a fresh PC paints empty shells from notes[]
      // first, and notesById is the copy that still has the photos.
      if (!fromChange) {
        const id = Number(note.id);
        const existing = notesRef.current.find((n) => Number(n.id) === id);
        if (
          existing
          && noteContentLength(existing) >= noteContentLength(note)
          && !!existing.archived === !!note.archived
          && !!existing.read === !!note.read
          && !!existing.fav === !!note.fav
          && !!existing.trashed === !!note.trashed
        ) return;
      }
      notesByIdBuffer.push(note);
      const isLiveNew = notesRef.current.length > 0
        && !notesRef.current.some((n) => Number(n.id) === Number(note.id));
      scheduleNotesByIdFlush(isLiveNew ? 0 : 120);
    };
    const notesByIdRef = dbRef(database, `users/${uid}/notesById`);
    const unsubNoteAdded = onChildAdded(notesByIdRef, (snap) => queueNoteChild(snap.val(), false));
    const unsubNoteChanged = onChildChanged(notesByIdRef, (snap) => queueNoteChild(snap.val(), true));
    const unsubNoteRemoved = onChildRemoved(notesByIdRef, (snap) => {
      // A missing mirror is not a delete — only an explicit permanent-delete
      // tombstone may drop a note, exactly like quizSetsById.
      const id = Number(snap.key);
      if (!Number.isFinite(id)) return;
      if (!permDeletedRef.current.notes.some((deadId) => Number(deadId) === id)) return;
      const next = notesRef.current.filter((n) => Number(n.id) !== id);
      if (next.length === notesRef.current.length) return;
      notesRef.current = next;
      setNotes(next);
      safeSetItem('malacadhati', JSON.stringify(next));
    });

    // Returning to the tab used to trigger a full pull every time. On iOS
    // visibilitychange and focus fire in bursts (keyboard, share sheet, tab
    // switcher), so each burst kicked off another whole-payload download and
    // wholesale state replacement — the flicker the user sees. Realtime
    // listeners already carry every change; this pull is only a safety net.
    const VISIBILITY_PULL_GAP_MS = 20_000;
    let lastVisibilityPullAt = 0;
    const pullIfNotJustPulled = () => {
      const now = Date.now();
      if (now - lastVisibilityPullAt < VISIBILITY_PULL_GAP_MS) return;
      lastVisibilityPullAt = now;
      void pullFromCloud(true);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') pullIfNotJustPulled();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    const onOnline = () => pullIfNotJustPulled();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', flushPersist);
    pullTimer.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') pullIfNotJustPulled();
    }, 60_000);
    // Safety valve: if "Saving…" has been up for too long (hung Firebase write,
    // mismatched increment), clear the badge so the UI is not stuck forever.
    const stuckTimer = window.setInterval(() => {
      if (savingStartedAt.current <= 0) return;
      if (Date.now() - savingStartedAt.current < STUCK_SAVING_MS) return;
      if (savesInFlight.current > 0 || pendingEditorUploads() > 0) {
        console.warn(
          '[cloud-save] clearing stuck in-flight state',
          { saves: savesInFlight.current, uploads: pendingEditorUploads() },
        );
        savesInFlight.current = 0;
        clearPendingEditorUploads();
      }
      setCloudStatus((prev) => (
        prev === 'saving' ? (saveFailedRef.current ? 'error' : 'saved') : prev
      ));
    }, 5_000);
    return () => {
      unsubPermDeleted();
      unsubTrashEmptied();
      unsubNotes();
      unsubQuizzes();
      unsubSets();
      unsubFolders();
      unsubSetsListOrder();
      unsubChats();
      unsubTokenUsage();
      if (arrayPatchTimer) clearTimeout(arrayPatchTimer);
      unsubFolderAdded();
      unsubFolderChanged();
      unsubFolderRemoved();
      unsubSetAdded();
      unsubSetChanged();
      unsubSetRemoved();
      unsubSetTrash();
      unsubFolderTrash();
      unsubItemTrash();
      unsubNoteTrashAdded();
      unsubNoteTrashRemoved();
      if (trashApplyTimer) clearTimeout(trashApplyTimer);
      unsubQuizItemAdded();
      unsubQuizItemChanged();
      unsubQuizItemRemoved();
      if (quizItemChildFlush) clearTimeout(quizItemChildFlush);
      unsubNoteAdded();
      unsubNoteChanged();
      unsubNoteRemoved();
      if (notesByIdFlush) clearTimeout(notesByIdFlush);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', flushPersist);
      if (pullTimer.current) clearInterval(pullTimer.current);
      clearInterval(stuckTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!user || !draftsReady) return;
    const syncRef = dbRef(database, `users/${user.uid}/cloudSyncAt`);
    const unsubscribe = onValue(syncRef, (snap) => {
      const remoteSyncAt = snap.val();
      if (typeof remoteSyncAt !== 'number' || remoteSyncAt <= 0) return;
      if (remoteSyncAt <= lastAppliedRemoteSyncAt.current) return;
      const fromOtherDevice = remoteSyncAt > lastLocalSaveAt.current + 50;
      if (!fromOtherDevice && Math.abs(remoteSyncAt - lastLocalSaveAt.current) < 150) return;
      if (savesInFlight.current > 0 || saveTimer.current) {
        scheduleRemotePull(true);
        return;
      }
      scheduleRemoteDraftPull();
      scheduleRemotePull(true);
    });
    return () => {
      unsubscribe();
      if (draftPullDebounceRef.current) {
        clearTimeout(draftPullDebounceRef.current);
        draftPullDebounceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, draftsReady]);

  const mutateNotes = (fn: (prev: Note[]) => Note[], instantCloud = false) => {
    setNotes((prev) => {
      const next = fn(prev);
      // Keep notesRef in sync before React re-renders — otherwise a remote
      // merge mid-toggle still sees the pre-read/fav snapshot.
      notesRef.current = next;
      persist({ notes: next }, instantCloud);
      if (instantCloud) scheduleInstantDataCloudSave({ notes: next });
      return next;
    });
  };

  const addDraft = () => {
    const id = allocateDraftId(draftCounter, draftsRef.current, pendingDeletedDraftIdsRef.current);
    pendingDeletedDraftIdsRef.current.delete(id);
    const now = Date.now();
    lastDraftEditAt.current = now;
    draftLocalEditAtRef.current.set(id, now);
    pendingLocalDraftIdsRef.current.add(id);
    const next = [...draftsRef.current, { id, title: '', html: '', updatedAt: now }];
    draftsRef.current = next;
    setDrafts(next);
    safeSetItem('malacadhati_drafts', JSON.stringify(next));
    persist({ drafts: next });
    scheduleSingleDraftCloudSave(id);
  };

  const removeDraft = (id: string) => {
    pendingLocalDraftIdsRef.current.delete(id);
    pendingDeletedDraftIdsRef.current.add(id);
    writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
    const next = draftsRef.current.filter((d) => d.id !== id);
    draftsRef.current = next;
    setDrafts(next);
    safeSetItem('malacadhati_drafts', JSON.stringify(next));
    if (draftCloudTimer.current) {
      clearTimeout(draftCloudTimer.current);
      draftCloudTimer.current = null;
    }
    persist({ drafts: next }, true);
    void runDraftDeleteCloudSave(id);
  };

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    const now = Date.now();
    lastDraftEditAt.current = now;
    draftLocalEditAtRef.current.set(id, now);
    const next = draftsRef.current.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: now } : d));
    draftsRef.current = next;
    setDrafts(next);
    safeSetItem('malacadhati_drafts', JSON.stringify(next));
    persist({ drafts: next }, false, true);
    scheduleSingleDraftCloudSave(id);
  };

  const submitDraft = (id: string) => {
    const draft = draftsRef.current.find((d) => d.id === id);
    if (!draft) return;
    // An image-only (or title-only) draft is real content; the old text-only
    // check silently refused to turn it into a note.
    if (!hasRichContent(draft.html) && !draft.title.trim()) return;
    const text = extractPlainText(draft.html);
    const newNote: Note = {
      id: nextId(),
      title: draft.title.trim(),
      html: draft.html,
      text,
      fav: false,
      read: false,
      archived: false,
      date: nowStr(),
      savedAt: new Date().toISOString(),
    };
    recordRecentEdit({ kind: 'note', at: Date.now(), note: newNote });

    const nextNotes = [newNote, ...notesRef.current];
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    pendingLocalDraftIdsRef.current.delete(id);
    pendingDeletedDraftIdsRef.current.add(id);
    writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
    const nextDrafts = draftsRef.current.filter((d) => d.id !== id);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    safeSetItem('malacadhati_drafts', JSON.stringify(nextDrafts));
    safeSetItem('malacadhati', JSON.stringify(nextNotes));

    // One tracked save for durable + notes-only instant sync. Do NOT call
    // persist() — that schedules a full-user PATCH and left "Saving…" stuck.
    beginTrackedSave();
    void (async () => {
      try {
        const durableOk = await persistNoteDurable(userRef.current?.uid, newNote).catch(() => false);
        if (durableOk) bumpCloudSyncAt();
        await runInstantDataCloudSave({ notes: nextNotes }, { trackInFlight: false });
        if (durableOk) {
          saveFailedRef.current = false;
          const syncedAt = Date.now();
          lastLocalSaveAt.current = syncedAt;
          setCloudSyncedAt(syncedAt);
          safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
        } else saveFailedRef.current = true;
      } catch {
        saveFailedRef.current = true;
      } finally {
        endTrackedSave();
      }
    })();
    void runDraftDeleteCloudSave(id);
  };

  const noteMetaChanged = (patch: Partial<Note>) =>
    'read' in patch || 'archived' in patch || 'fav' in patch || 'trashed' in patch;

  const updateNote = (id: number, patch: Partial<Note>) => {
    const contentChanged = 'html' in patch || 'title' in patch || 'text' in patch || 'savedAt' in patch;
    const metaChanged = noteMetaChanged(patch);
    const instant = metaChanged || contentChanged;
    const base = notesRef.current.find((n) => n.id === id);
    if (!base) return;
    // Stamp savedAt on meta toggles (read/fav/archive) too — otherwise
    // pickBetterNote treats cloud's older unread copy as equal-age and the
    // flag snaps back immediately after "Marked as read".
    const merged: Note = (contentChanged || metaChanged) && !patch.savedAt
      ? { ...base, ...patch, savedAt: new Date().toISOString() }
      : { ...base, ...patch };
    recordRecentEdit({ kind: 'note', at: Date.now(), note: merged });

    if (contentChanged) {
      const next = notesRef.current.map((n) => (n.id === id ? merged : n));
      notesRef.current = next;
      setNotes(next);
      safeSetItem('malacadhati', JSON.stringify(next));
      // Single in-flight tracker for durable + notes-only instant write.
      // Previously both persistNoteDurable AND scheduleInstantDataCloudSave
      // incremented, and persist() also queued a full-user PATCH — any hang in
      // that PATCH left cloudStatus='saving' / beforeunload stuck forever.
      beginTrackedSave();
      void (async () => {
        try {
          const durableOk = await persistNoteDurable(userRef.current?.uid, merged).catch(() => false);
          if (durableOk) bumpCloudSyncAt();
          await runInstantDataCloudSave({ notes: next }, { trackInFlight: false });
          if (durableOk) {
            saveFailedRef.current = false;
            const syncedAt = Date.now();
            lastLocalSaveAt.current = syncedAt;
            setCloudSyncedAt(syncedAt);
            safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
          } else {
            saveFailedRef.current = true;
          }
        } catch {
          saveFailedRef.current = true;
        } finally {
          endTrackedSave();
        }
      })();
      return;
    }

    // Meta-only: durable ById + localStorage so refresh/boot cannot resurrect
    // the previous read/fav/archive flag from notesById / IndexedDB.
    const next = notesRef.current.map((n) => (n.id === id ? merged : n));
    notesRef.current = next;
    setNotes(next);
    safeSetItem('malacadhati', JSON.stringify(next));
    void persistNoteDurable(userRef.current?.uid, merged).catch(() => false);
    persist({ notes: next }, instant);
    if (instant) scheduleInstantDataCloudSave({ notes: next });
  };

  const hydrateNote = async (id: number) => {
    const uid = userRef.current?.uid;
    if (!uid) return;
    if (blockedNoteIdSet(permDeletedRef.current, rejectedNoteIdsRef.current).has(Number(id))) return;
    const current = notesRef.current.find((n) => Number(n.id) === Number(id));
    if (current && noteHasDisplayableImage(current.html)) return;
    const [local, cloud] = await Promise.all([
      getNoteLocal(Number(id)),
      fetchNoteByIdCloud(uid, Number(id)),
    ]);
    const incoming = incomingNotesSafe([local, cloud].filter((n): n is Note => !!n));
    if (!incoming.length) return;
    const merged = sortNotesByCreatedDesc(mergeNotesPreferRicher(notesRef.current, incoming));
    if (!notesBodiesRicher(merged, notesRef.current) && notesFlagsEqual(merged, notesRef.current)) return;
    notesRef.current = merged;
    setNotes(merged);
    const found = merged.find((n) => Number(n.id) === Number(id));
    if (found) void putNoteLocal(found);
  };

  const hydrateQuizSet = async (setId: string) => {
    const uid = userRef.current?.uid;
    if (!setId || hydrateQuizSetInFlight.current.has(setId)) return;
    const set = quizSetsRef.current.find((s) => s.id === setId);
    if (!set) return;
    const items = coerceQuizItems(set.items as QuizItem[] | Record<string, QuizItem> | null | undefined);
    const orderIds = (set.itemsOrder?.length
      ? set.itemsOrder
      : items.map((item) => item.id)
    ).map(Number).filter(Number.isFinite);
    if (!orderIds.length) return;
    const hasBody = (item: QuizItem | undefined) => {
      if (!item || item.trashed) return false;
      return !!(
        (item.question || '').trim()
        || (item.answer || '').trim()
        || (item.options ?? []).length
        || (item.explanation || '').trim()
      );
    };
    const missing = orderIds.filter((id) => !hasBody(items.find((item) => Number(item.id) === id)));
    if (!missing.length) return;
    hydrateQuizSetInFlight.current.add(setId);
    try {
      let cursor = 0;
      const worker = async () => {
        while (cursor < missing.length) {
          const id = missing[cursor++];
          const [local, cloud] = await Promise.all([
            getQuizItemLocal(id),
            uid ? fetchQuizItemByIdCloud(uid, id) : Promise.resolve(null),
          ]);
          const durable = [local, cloud].filter((row): row is StoredQuizItem => {
            if (!row || row.id == null) return false;
            if (permDeletedRef.current.quizzes.some((dead) => Number(dead) === Number(row.id))) return false;
            return hasBody(row);
          }).map((row) => ({ ...row, setId }));
          if (!durable.length) continue;
          const applied = applyDurableQuizItems(
            quizzesRef.current,
            quizSetsRef.current,
            durable,
          );
          const nextQuizzes = honorQuizItemTrashTombstonesOnItems(
            stripPermDeletedQuizzes(applied.quizzes, permDeletedRef.current),
            quizItemTombstonesRef.current,
          );
          const nextSets = honorQuizItemTrashTombstones(
            stripPermDeletedQuizSets(applied.sets, permDeletedRef.current),
            quizItemTombstonesRef.current,
          );
          quizzesRef.current = nextQuizzes;
          quizSetsRef.current = nextSets;
          lastPaintedQuizSetsRef.current = nextSets;
          setQuizzes(nextQuizzes);
          setQuizSets(nextSets);
          for (const row of durable) {
            void putQuizItemLocal(row);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, missing.length) }, () => worker()));
      if (!quizContentReadyRef.current) {
        quizContentReadyRef.current = true;
        quizAuthoritativeByIdSeenRef.current = true;
        setQuizContentReady(true);
      }
    } finally {
      hydrateQuizSetInFlight.current.delete(setId);
    }
  };

  const addQuiz = (item: Omit<QuizItem, 'id'>): number => {
    const newId = Date.now();
    const now = new Date().toISOString();
    const newItem: QuizItem = { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now };
    recordRecentEdit({ kind: 'quiz', at: Date.now(), quiz: newItem });
    void persistQuizItemDurable(userRef.current?.uid, newItem, null);
    const next = [...quizzesRef.current, newItem];
    quizzesRef.current = next;
    setQuizzes(next);
    safeSetItem('malacadhati_quiz', JSON.stringify(next));
    everHadQuizzesRef.current = true;
    // Field-level cloud write only (never force a full-user PATCH that could wipe notes).
    persist({ quizzes: next }, false);
    scheduleInstantDataCloudSave({ quizzes: next });
    return newId;
  };

  const deleteQuiz = (id: number, fromSetId?: string | null) => {
    const trashAt = new Date().toISOString();
    const trashAtMs = Date.parse(trashAt) || Date.now();
    let item: QuizItem | undefined;
    if (fromSetId) {
      item = quizSetsRef.current.find((set) => set.id === fromSetId)?.items.find((q) => q.id === id);
    }
    if (!item) {
      for (const set of quizSetsRef.current) {
        const found = set.items.find((q) => q.id === id);
        if (found) {
          item = found;
          break;
        }
      }
    }
    if (!item) item = quizzesRef.current.find((q) => q.id === id);
    if (!item) return;

    const trashedItem: QuizItem = {
      ...item,
      trashed: true,
      deletedAt: nowStr(),
      updatedAt: trashAt,
    };

    const nextQuizzes = quizzesRef.current.some((q) => q.id === id)
      ? quizzesRef.current.map((q) => (q.id === id ? trashedItem : q))
      : [...quizzesRef.current, trashedItem];

    // Soft-delete inside every set that holds this id (keep trashed tombstone)
    // so inbound union-merge cannot resurrect a live remote copy.
    let touchedSetId = fromSetId ?? null;
    let nextSets = quizSetsRef.current.map((set) => {
      if (set.id === FAVORITES_SET_ID) {
        return { ...set, items: set.items.filter((q) => q.favOf !== id && q.id !== id) };
      }
      if (!set.items.some((q) => q.id === id)) {
        if (fromSetId && set.id === fromSetId) {
          touchedSetId = set.id;
          return { ...set, updatedAt: trashAt, items: [...set.items, trashedItem] };
        }
        return set;
      }
      touchedSetId = touchedSetId ?? set.id;
      return {
        ...set,
        updatedAt: trashAt,
        items: set.items.map((q) => (q.id === id ? trashedItem : q)),
      };
    });

    // Durable soft-delete marker (same pattern as set/folder quizTrash) so
    // refresh + richer ById shells cannot revive this question as live.
    quizItemTombstonesRef.current = markTrashTombstone(
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      quizItemTombstonesRef.current,
      String(id),
      trashAtMs,
    );
    const uid = userRef.current?.uid;
    if (uid) pushTrashTombstoneCloud(uid, 'items', String(id), trashAtMs);

    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    lastPaintedQuizSetsRef.current = nextSets;
    quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
      preferRicherQuizSetsMembership(quizSetsByIdCacheRef.current, nextSets),
      quizItemTombstonesRef.current,
    );
    // Lower max-known floors so soft-delete is not treated as an incomplete shell.
    for (const set of nextSets) {
      if (!set?.id || set.id === FAVORITES_SET_ID) continue;
      if (!set.items.some((q) => q.id === id)) continue;
      maxKnownLiveBySetRef.current.set(set.id, countLiveItemsInSet(set));
    }
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    rememberLastGoodComplete(nextQuizzes, nextSets);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    // Instant cross-device delete: tiny single-item write first, then the big
    // quizSets array in the background. Other devices listen to quizItemsById.
    void tombstoneQuizItemDurable(userRef.current?.uid, trashedItem, touchedSetId);
    if (touchedSetId) {
      const touched = nextSets.find((s) => s.id === touchedSetId);
      if (touched) void pushQuizSetById(touched);
    }
    persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
    persistSets(nextSets, true, true);
    scheduleInstantDataCloudSave({ quizzes: nextQuizzes, quizSets: nextSets });
  };

  const restoreQuiz = (id: number) => {
    const restoredAt = new Date().toISOString();
    let source: QuizItem | undefined = quizzesRef.current.find((q) => q.id === id);
    if (!source?.trashed) {
      for (const set of quizSetsRef.current) {
        const found = set.items.find((q) => q.id === id && q.trashed);
        if (found) {
          source = found;
          break;
        }
      }
    }
    if (!source) return;

    quizItemTombstonesRef.current = clearTrashTombstone(
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      quizItemTombstonesRef.current,
      String(id),
    );
    const uid = userRef.current?.uid;
    if (uid) clearTrashTombstoneCloud(uid, 'items', String(id));

    const live: QuizItem = {
      ...source,
      trashed: false,
      deletedAt: undefined,
      updatedAt: restoredAt,
    };

    // Leave "Questions from Notes" — restored quiz questions live under Restored.
    const nextQuizzes = quizzesRef.current.filter((q) => q.id !== id);

    let nextSets = ensureRestoredQuestionsSet(quizSetsRef.current).map((set) => {
      if (set.id === RESTORED_QUESTIONS_SET_ID) {
        const items = set.items.some((i) => i.id === id)
          ? set.items.map((i) => (i.id === id ? live : i))
          : [...set.items, live];
        return {
          ...set,
          folderId: RESTORED_FOLDER_ID,
          trashed: false,
          deletedAt: undefined,
          items,
          updatedAt: restoredAt,
        };
      }
      if (!set.items.some((i) => i.id === id)) return set;
      // Drop the trashed copy from the original set so it only lives in Restored.
      return {
        ...set,
        items: set.items.filter((i) => i.id !== id),
        updatedAt: restoredAt,
      };
    });

    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    rememberLastGoodComplete(nextQuizzes, nextSets);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    void persistQuizItemDurable(userRef.current?.uid, live, RESTORED_QUESTIONS_SET_ID, { immediate: true });
    persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
    persistSets(nextSets, true, true);
    scheduleInstantDataCloudSave({ quizzes: nextQuizzes, quizSets: nextSets });
  };

  const permDeleteQuiz = (id: number) => {
    const numId = Number(id);
    if (!Number.isFinite(numId)) return;
    recordPermDeleted({ quizzes: [numId] });
    const uid = userRef.current?.uid;
    const touchedSetIds = quizSetsRef.current
      .filter((s) => (s.items ?? []).some((i) => Number(i.id) === numId))
      .map((s) => s.id);

    // Destroy ById/IDB mirror BEFORE clearing soft-delete markers (same order as
    // Empty Trash). Otherwise a lingering trashed quizItemsById row re-imports
    // into Trash and then vanish when permanentlyDeletedIds catches up.
    void removeQuizItemDurable(uid, numId);

    quizSetsByIdCacheRef.current = stripPermDeletedQuizSets(
      quizSetsByIdCacheRef.current,
      permDeletedRef.current,
    );

    quizItemTombstonesRef.current = clearTrashTombstone(
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      quizItemTombstonesRef.current,
      String(numId),
    );
    if (uid) clearTrashTombstoneCloud(uid, 'items', String(numId));

    const nextQuizzes = stripPermDeletedQuizzes(
      quizzesRef.current.filter((q) => Number(q.id) !== numId),
      permDeletedRef.current,
    );
    const nextSets = stripPermDeletedQuizSets(
      quizSetsRef.current.map((s) => ({
        ...s,
        items: (s.items ?? []).filter((i) => Number(i.id) !== numId),
        ...(touchedSetIds.includes(s.id) ? { updatedAt: new Date().toISOString() } : {}),
      })),
      permDeletedRef.current,
    );
    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    lastPaintedQuizSetsRef.current = nextSets;
    lastPaintedQuizzesRef.current = nextQuizzes;
    for (const set of nextSets) {
      if (!set?.id) continue;
      maxKnownLiveBySetRef.current.set(set.id, countLiveItemsInSet(set));
    }
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    rememberLastGoodComplete(nextQuizzes, nextSets, true);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    // Push cleaned set shells so quizSetsById cannot keep re-unioning the ghost.
    for (const setId of touchedSetIds) {
      const cleaned = nextSets.find((s) => s.id === setId);
      if (cleaned) void pushQuizSetById(cleaned);
    }
    persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
    persistSets(nextSets, true, true);
    void pushPermDeletedCloud({ quizzes: nextQuizzes, quizSets: nextSets });
  };

  const updateQuiz = (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud = false) => {
    const existing = quizzesRef.current.find((q) => q.id === id);
    if (!existing || !quizPatchChangesContent(existing, patch)) return;
    const updated: QuizItem = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    recordRecentEdit({ kind: 'quiz', at: Date.now(), quiz: updated });
    void persistQuizItemDurable(userRef.current?.uid, updated, null, { immediate: true });
    const next = quizzesRef.current.map((q) => (q.id === id ? updated : q));
    quizzesRef.current = next;
    setQuizzes(next);
    safeSetItem('malacadhati_quiz', JSON.stringify(next));
    persist({ quizzes: next }, false);
    if (forceCloud) {
      persist({ quizzes: next }, true);
      scheduleInstantDataCloudSave({ quizzes: next });
    }
  };

  const addQuizSet = async (name: string, folderId?: string): Promise<QuizSet> => {
    const id = Date.now().toString();
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value), id);
    const stamp = new Date().toISOString();
    const targetFolderId = folderId
      && !quizFoldersRef.current.find((f) => f.id === folderId)?.system
      ? folderId
      : undefined;
    const newSet: QuizSet = {
      id,
      name,
      items: [],
      createdAt: stamp,
      updatedAt: stamp,
      // Stamp list order so sync keeps this append; never fall back to createdAt.
      listOrderUpdatedAt: stamp,
      color,
      colorInitialized: true,
      ...(targetFolderId ? { folderId: targetFolderId } : {}),
    };
    // Single shot with folder — avoids add-then-move racing two giant array writes.
    const next = insertQuizSetInFolderOrder(quizSetsRef.current, newSet);
    quizSetsRef.current = next;
    setQuizSets(next);
    everHadSetsRef.current = true;
    recordRecentEdit({ kind: 'quizSet', at: Date.now(), set: newSet });
    // Await ById + IndexedDB before resolve so hard refresh cannot lose the set.
    await pushQuizSetStructure(next, newSet);
    return newSet;
  };

  const deleteQuizSet = (id: string) => {
    if (id === FAVORITES_SET_ID) return;
    const trashAt = new Date().toISOString();
    const next = quizSetsRef.current.map((s) => (
      s.id === id ? { ...s, trashed: true, deletedAt: nowStr(), updatedAt: trashAt } : s
    ));
    quizSetsRef.current = next;
    lastPaintedQuizSetsRef.current = next;
    setQuizSets(next);
    rememberLastGoodComplete(quizzesRef.current, next);
    // Durable tombstone — proves the soft-delete happened even if the ById/array
    // writes below race or fail, so refresh can never resurrect this set.
    quizSetTombstonesRef.current = markTrashTombstone(
      QUIZ_SET_TRASH_TOMBSTONE_KEY,
      quizSetTombstonesRef.current,
      id,
      Date.parse(trashAt),
    );
    const uid = userRef.current?.uid;
    if (uid) pushTrashTombstoneCloud(uid, 'sets', id, Date.parse(trashAt));
    const trashed = next.find((s) => s.id === id);
    void pushQuizSetStructure(next, trashed ? [trashed] : []);
  };

  const restoreQuizSet = (id: string) => {
    const set = quizSetsRef.current.find((item) => item.id === id);
    if (!set) return;
    const restored: QuizSet = {
      ...set,
      trashed: false,
      deletedAt: undefined,
      folderId: RESTORED_FOLDER_ID,
      updatedAt: new Date().toISOString(),
    };
    const next = [...quizSetsRef.current.filter((item) => item.id !== id), restored];
    quizSetsRef.current = next;
    setQuizSets(next);
    quizSetTombstonesRef.current = clearTrashTombstone(QUIZ_SET_TRASH_TOMBSTONE_KEY, quizSetTombstonesRef.current, id);
    const uid = userRef.current?.uid;
    if (uid) clearTrashTombstoneCloud(uid, 'sets', id);
    void pushQuizSetStructure(next, restored);
  };

  const permDeleteQuizSet = (id: string) => {
    if (id === FAVORITES_SET_ID) return;
    const doomed = quizSetsRef.current.find((s) => s.id === id);
    recordPermDeleted({
      quizSets: [id],
      quizzes: (doomed?.items ?? []).map((item) => item.id),
    });
    const nextSets = quizSetsRef.current.filter((s) => s.id !== id);
    quizSetsRef.current = nextSets;
    setQuizSets(nextSets);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persistSets(nextSets, true, true);
    quizSetTombstonesRef.current = clearTrashTombstone(QUIZ_SET_TRASH_TOMBSTONE_KEY, quizSetTombstonesRef.current, id);
    const uid = userRef.current?.uid;
    purgeQuizSetByIdCloud(id);
    if (uid) clearTrashTombstoneCloud(uid, 'sets', id);
    void pushPermDeletedCloud({ quizSets: nextSets });
  };

  const reorderQuizSets = (dragId: string, targetId: string) => {
    const stamp = nowStr();
    const next = reorderQuizSetsList(quizSetsRef.current, dragId, targetId, stamp);
    if (!next) return;
    quizSetsRef.current = next;
    lastPaintedQuizSetsRef.current = next;
    setQuizSets(next);
    // Write the tiny order mirror first (local + cloud) so refresh/other devices
    // keep Egen order even when giant quizSets[] / ById scramble.
    persistQuizSetsListOrder(next, stamp);
    void pushQuizSetStructure(next);
  };

  const renameQuizSet = (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const stamp = new Date().toISOString();
    const next = quizSetsRef.current.map((s) => (
      s.id === id ? { ...s, name: trimmed, updatedAt: stamp } : s
    ));
    quizSetsRef.current = next;
    setQuizSets(next);
    const updated = next.find((s) => s.id === id);
    void pushQuizSetStructure(next, updated ? [updated] : []);
  };

  const setQuizSetColor = (id: string, color: string) => {
    const stamp = new Date().toISOString();
    const next = quizSetsRef.current.map((s) => (
      s.id === id ? { ...s, color, colorInitialized: true, updatedAt: stamp } : s
    ));
    quizSetsRef.current = next;
    setQuizSets(next);
    const updated = next.find((s) => s.id === id);
    void pushQuizSetStructure(next, updated ? [updated] : []);
  };

  const setQuizSetFolder = (id: string, folderId: string | undefined) => {
    if (id === FAVORITES_SET_ID) return;
    const set = quizSetsRef.current.find((s) => s.id === id);
    if (!set || set.system) return;
    if (folderId && quizFoldersRef.current.find((f) => f.id === folderId)?.system) return;
    if (set.folderId === folderId) return;
    const stamp = new Date().toISOString();
    const updated: QuizSet = { ...set, folderId, updatedAt: stamp, listOrderUpdatedAt: stamp };
    const without = quizSetsRef.current.filter((s) => s.id !== id);
    // Append after the last set already in the target folder (or ungrouped),
    // so "+ Add set" lands at the bottom of that folder's Manual list.
    let insertAt = without.length;
    for (let i = without.length - 1; i >= 0; i -= 1) {
      const row = without[i];
      if (row.system || row.trashed) continue;
      const sameGroup = folderId ? row.folderId === folderId : !row.folderId;
      if (sameGroup) {
        insertAt = i + 1;
        break;
      }
    }
    const next = [...without.slice(0, insertAt), updated, ...without.slice(insertAt)];
    quizSetsRef.current = next;
    setQuizSets(next);
    recordRecentEdit({ kind: 'quizSet', at: Date.now(), set: updated });
    void pushQuizSetStructure(next, updated);
  };

  const addQuizFolder = (name: string): QuizFolder => {
    const id = 'f' + Date.now().toString();
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value), id);
    const stamp = new Date().toISOString();
    const folder: QuizFolder = {
      id,
      name,
      createdAt: stamp,
      updatedAt: stamp,
      orderUpdatedAt: stamp,
      color,
      colorInitialized: true,
    };
    const next = [...quizFoldersRef.current, folder];
    quizFoldersRef.current = next;
    setQuizFolders(next);
    pushQuizFolderStructure(next, folder);
    return folder;
  };

  const renameQuizFolder = (id: string, name: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const stamp = new Date().toISOString();
    const next = quizFoldersRef.current.map((f) => (
      f.id === id ? { ...f, name: trimmed, updatedAt: stamp } : f
    ));
    quizFoldersRef.current = next;
    setQuizFolders(next);
    const updated = next.find((f) => f.id === id);
    pushQuizFolderStructure(next, updated ? [updated] : []);
  };

  const setQuizFolderColor = (id: string, color: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const stamp = new Date().toISOString();
    const next = quizFoldersRef.current.map((f) => (
      f.id === id ? { ...f, color, colorInitialized: true, updatedAt: stamp } : f
    ));
    quizFoldersRef.current = next;
    setQuizFolders(next);
    const updated = next.find((f) => f.id === id);
    pushQuizFolderStructure(next, updated ? [updated] : []);
  };

  const reorderQuizFolders = (dragId: string, targetId: string) => {
    setQuizFolders((prev) => {
      const drag = prev.find((f) => f.id === dragId);
      const target = prev.find((f) => f.id === targetId);
      if (!drag || !target || drag.system || target.system || dragId === targetId) return prev;
      const systemFolders = prev.filter((f) => f.system);
      const normalFolders = prev.filter((f) => !f.system);
      const from = normalFolders.findIndex((f) => f.id === dragId);
      const to = normalFolders.findIndex((f) => f.id === targetId);
      if (from < 0 || to < 0) return prev;
      const stamp = nowStr();
      const [item] = normalFolders.splice(from, 1);
      normalFolders.splice(to, 0, { ...item, orderUpdatedAt: stamp });
      const next = [...systemFolders, ...normalFolders];
      persistFolders(next, true);
      scheduleInstantDataCloudSave({ quizFolders: next });
      return next;
    });
  };

  const deleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const trashAt = new Date().toISOString();
    // Soft-delete the folder only. Sets keep folderId so they stay hidden with
    // the trashed folder (QuizPage filters by trashedFolderIds) and come back
    // on restore — clearing folderId used to orphan them as ungrouped sets.
    const nextFolders = quizFoldersRef.current.map((f) => (
      f.id === id ? { ...f, trashed: true, deletedAt: nowStr(), updatedAt: trashAt } : f
    ));
    quizFoldersRef.current = nextFolders;
    setQuizFolders(nextFolders);
    // Durable tombstone — see deleteQuizSet for why this must not depend on
    // the (larger, more failure-prone) array/ById writes below succeeding.
    quizFolderTombstonesRef.current = markTrashTombstone(
      QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
      quizFolderTombstonesRef.current,
      id,
      Date.parse(trashAt),
    );
    const uid = userRef.current?.uid;
    if (uid) pushTrashTombstoneCloud(uid, 'folders', id, Date.parse(trashAt));
    const trashedFolder = nextFolders.find((f) => f.id === id);
    pushQuizFolderStructure(nextFolders, trashedFolder ? [trashedFolder] : []);
  };

  const restoreQuizFolder = (id: string) => {
    quizFolderTombstonesRef.current = clearTrashTombstone(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY, quizFolderTombstonesRef.current, id);
    const restoreUid = userRef.current?.uid;
    if (restoreUid) clearTrashTombstoneCloud(restoreUid, 'folders', id);
    setQuizFolders((prev) => {
      const next = prev.map((f) => f.id === id ? {
        ...f,
        trashed: false,
        deletedAt: undefined,
        updatedAt: new Date().toISOString(),
      } : f);
      persistFolders(next, true);
      scheduleInstantDataCloudSave({ quizFolders: next });
      return next;
    });
  };

  const permDeleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    recordPermDeleted({ quizFolders: [id] });
    const nextSets = quizSetsRef.current.map((s) => s.folderId === id ? { ...s, folderId: undefined } : s);
    const nextFolders = quizFoldersRef.current.filter((f) => f.id !== id);
    quizSetsRef.current = nextSets;
    quizFoldersRef.current = nextFolders;
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist({ quizSets: nextSets, quizFolders: nextFolders }, true);
    quizFolderTombstonesRef.current = clearTrashTombstone(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY, quizFolderTombstonesRef.current, id);
    const uid = userRef.current?.uid;
    purgeQuizFolderByIdCloud(id);
    if (uid) clearTrashTombstoneCloud(uid, 'folders', id);
    void pushPermDeletedCloud({ quizSets: nextSets, quizFolders: nextFolders });
  };

  const recoverQuizFolders = async (): Promise<number> => {
    if (!user) return 0;
    const before = new Set(quizFolders.filter((folder) => !folder.system && !folder.trashed).map((folder) => folder.id));
    let cloudFolders: QuizFolder[] = [];
    let cloudSets: QuizSet[] = [];
    let dedicatedFolders: QuizFolder[] = [];
    let dedicatedSets: QuizSet[] = [];
    try {
      const cloud = await fetch(`${FB_DB_URL}/users/${user.uid}.json`).then((r) => r.json());
      cloudFolders = firebaseToArray<QuizFolder>(cloud?.quizFolders);
      cloudSets = firebaseToArray<QuizSet>(cloud?.quizSets).map((set) => ({ ...set, items: set.items ?? [] }));
    } catch { /* ignore */ }
    try {
      dedicatedFolders = firebaseToArray<QuizFolder>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`).then((r) => r.json()));
    } catch { /* ignore */ }
    try {
      dedicatedSets = firebaseToArray<QuizSet>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`).then((r) => r.json())).map((set) => ({ ...set, items: set.items ?? [] }));
    } catch { /* ignore */ }

    const rawFolders = mergeById(
      cloudFolders,
      dedicatedFolders,
      quizFolders,
      firebaseToArray<QuizFolder>(readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? []),
    );
    const rawSets = mergeById(
      cloudSets,
      dedicatedSets,
      quizSets,
      firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>('malacadhati_quiz_sets') ?? []).map((set) => ({ ...set, items: set.items ?? [] })),
    );
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(rawFolders, rawSets));
    const nextSets = ensureFavoritesSet(initializeQuizColors(rawSets, nextFolders.map((folder) => folder.color).filter((color): color is string => !!color)));
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    persistFolders(nextFolders, true);
    persistSets(nextSets, true);
    const after = nextFolders.filter((folder) => !folder.system && !folder.trashed);
    return after.filter((folder) => !before.has(folder.id)).length;
  };

  const listQuizFolderBackups = async (): Promise<{ key: string; label: string; folderCount: number }[]> => {
    if (!user) return [];
    try {
      const res = await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory.json?shallow=true`);
      const keys = Object.keys((await res.json()) || {}).sort().reverse();
      const snapshots = await Promise.all(keys.map(async (key) => {
        const folders = firebaseToArray<QuizFolder>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory/${key}.json`).then((r) => r.json()));
        const userFolders = folders.filter((folder) => !folder.system);
        const names = userFolders.map((folder) => folder.name).slice(0, 3).join(', ');
        return {
          key,
          label: new Date(Number(key)).toLocaleString(t.dateLocale),
          folderCount: userFolders.length,
          names,
        };
      }));
      return snapshots.map(({ key, label, folderCount, names }) => ({
        key,
        label: names ? `${label} · ${names}` : label,
        folderCount,
      }));
    } catch {
      return [];
    }
  };

  const restoreQuizFolderBackup = async (key: string): Promise<number> => {
    if (!user) return 0;
    const before = new Set(quizFolders.filter((folder) => !folder.system).map((folder) => folder.id));
    const folders = firebaseToArray<QuizFolder>(
      await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory/${key}.json`).then((r) => r.json()),
    );
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(folders, quizSets));
    setQuizFolders(nextFolders);
    persistFolders(nextFolders);
    const after = nextFolders.filter((folder) => !folder.system && !folder.trashed);
    return after.filter((folder) => !before.has(folder.id)).length;
  };

  const summarizeDataSnapshot = (snapshot: DataHistorySnapshot) => ({
    notes: snapshot.notes.length,
    quizzes: snapshot.quizzes.length,
    sets: countUserQuizSets(snapshot.quizSets),
    folders: countUserQuizFolders(snapshot.quizFolders),
    chats: snapshot.chats.length,
  });

  const listDataBackups = async (): Promise<{ key: string; label: string; notes: number; quizzes: number; sets: number; folders: number; chats: number }[]> => {
    if (!user) return [];
    try {
      const res = await rtdbFetch(`/users/${user.uid}/dataHistory?shallow=true`);
      const keys = Object.keys((await res.json()) || {}).sort().reverse();
      const snapshots = await Promise.all(keys.slice(0, 24).map(async (key) => {
        const snapshot = await fetchDataHistorySnapshot(user.uid, key);
        if (!snapshot) return null;
        const counts = summarizeDataSnapshot(snapshot);
        if (!counts.notes && !counts.quizzes && !counts.sets && !counts.folders && !counts.chats) return null;
        return {
          key,
          label: new Date(Number(key)).toLocaleString(t.dateLocale),
          ...counts,
        };
      }));
      return snapshots.filter((item): item is NonNullable<typeof item> => !!item);
    } catch {
      return [];
    }
  };

  const restoreDataBackup = async (key: string): Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }> => {
    if (!user) return { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 };
    const snapshot = await fetchDataHistorySnapshot(user.uid, key);
    if (!snapshot) return { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 };
    const nextNotes = snapshot.notes;
    const nextQuizzes = snapshot.quizzes;
    const nextChats = snapshot.chats;
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(snapshot.quizFolders, snapshot.quizSets));
    const nextSets = ensureFavoritesSet(initializeQuizColors(
      snapshot.quizSets,
      nextFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    ));
    const counts = summarizeDataSnapshot({ ...snapshot, quizFolders: nextFolders, quizSets: nextSets });
    recoveryLog('manual cloud dataHistory restore', { key, ...counts });
    setNotes(nextNotes);
    setQuizzes(nextQuizzes);
    setChats(nextChats);
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_chats', JSON.stringify(nextChats));
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    markEverHadContent(nextNotes, nextQuizzes, nextSets);
    persist({ notes: nextNotes, quizzes: nextQuizzes, chats: nextChats, quizSets: nextSets, quizFolders: nextFolders }, true);
    await rtdbFetch(`/users/${user.uid}/quizSets`, {
      method: 'PUT',
      body: JSON.stringify(nextSets),
      headers: { 'Content-Type': 'application/json' },
    });
    await rtdbFetch(`/users/${user.uid}/quizFolders`, {
      method: 'PUT',
      body: JSON.stringify(nextFolders),
      headers: { 'Content-Type': 'application/json' },
    });
    return counts;
  };

  const hasDataBackups = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const res = await rtdbFetch(`/users/${user.uid}/dataHistory?shallow=true`);
      const keys = Object.keys((await res.json()) || {});
      return keys.length > 0;
    } catch {
      return false;
    }
  };

  const applyRecoverySnapshot = async (snapshot: DataHistorySnapshot, label: string) => {
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(snapshot.quizFolders, snapshot.quizSets));
    const nextSets = ensureFavoritesSet(initializeQuizColors(
      snapshot.quizSets,
      nextFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    ));
    const counts = summarizeDataSnapshot({ ...snapshot, quizFolders: nextFolders, quizSets: nextSets });
    recoveryLog(label, counts);
    setNotes(snapshot.notes);
    setQuizzes(snapshot.quizzes);
    setChats(snapshot.chats);
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    safeSetItem('malacadhati', JSON.stringify(snapshot.notes));
    safeSetItem('malacadhati_quiz', JSON.stringify(snapshot.quizzes));
    safeSetItem('malacadhati_chats', JSON.stringify(snapshot.chats));
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    markEverHadContent(snapshot.notes, snapshot.quizzes, nextSets);
    persist({ notes: snapshot.notes, quizzes: snapshot.quizzes, chats: snapshot.chats, quizSets: nextSets, quizFolders: nextFolders }, true);
    await rtdbFetch(`/users/${user!.uid}/quizSets`, {
      method: 'PUT',
      body: JSON.stringify(nextSets),
      headers: { 'Content-Type': 'application/json' },
    });
    await rtdbFetch(`/users/${user!.uid}/quizFolders`, {
      method: 'PUT',
      body: JSON.stringify(nextFolders),
      headers: { 'Content-Type': 'application/json' },
    });
    return counts;
  };

  const scanRecoverableCloud = async (): Promise<RecoverableCloudSummary> => {
    if (!user) {
      return {
        sources: {
          cloud: { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 },
          dataHistoryBest: { key: null, notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 },
          drafts: 0,
          chatUserMessages: 0,
          folderHistoryKeys: 0,
          dedicatedSets: 0,
          dedicatedFolders: 0,
          orphaned: { notes: 0, quizzes: 0, sets: 0 },
        },
        totalRecoverable: { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 },
        folderNames: [],
      };
    }
    const cloudRes = await rtdbFetch(`/users/${user.uid}`).catch(() => null);
    const cloud = cloudRes && cloudRes.ok
      ? ((await cloudRes.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
    const fullUserTree = cloud;
    const orphaned = deepScanOrphanedContent(fullUserTree);
    const [{ key: bestKey, snapshot: bestHistory }, dedicated, folderHistRes] = await Promise.all([
      fetchBestDataHistory(user.uid),
      readDedicatedQuizData(user.uid),
      rtdbFetch(`/users/${user.uid}/quizFoldersHistory?shallow=true`).catch(() => null),
    ]);
    const folderHistoryKeys = folderHistRes && folderHistRes.ok
      ? Object.keys((await folderHistRes.json().catch(() => ({}))) || {}).length
      : 0;
    const cloudChats = cloud
      ? firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>).map((chat) => ({ ...chat, messages: chat.messages ?? [] }))
      : [];
    const draftNotes = cloud?.draftContents && typeof cloud.draftContents === 'object'
      ? recoverNotesFromDraftContents(cloud.draftContents as Record<string, { title?: string; html?: string }>)
      : [];
    const recovery = await buildRecoverySnapshot(user.uid, cloud);
    const cloudSets = cloud
      ? firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] }))
      : [];
    const cloudFolders = cloud ? firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>) : [];
    const folderNames = recovery.quizFolders
      .filter((folder) => !folder.system && !folder.trashed)
      .map((folder) => folder.name)
      .filter(Boolean);
    return {
      sources: {
        cloud: {
          notes: firebaseToArray<Note>(cloud?.notes as Note[] | Record<string, Note>).length,
          quizzes: firebaseToArray<QuizItem>(cloud?.quizzes as QuizItem[] | Record<string, QuizItem>).length,
          sets: countUserQuizSets(cloudSets),
          folders: countUserQuizFolders(cloudFolders),
          chats: cloudChats.length,
        },
        dataHistoryBest: {
          key: bestKey,
          notes: bestHistory?.notes.length ?? 0,
          quizzes: bestHistory?.quizzes.length ?? 0,
          sets: bestHistory ? countUserQuizSets(bestHistory.quizSets) : 0,
          folders: bestHistory ? countUserQuizFolders(bestHistory.quizFolders) : 0,
          chats: bestHistory?.chats.length ?? 0,
        },
        drafts: draftNotes.length,
        chatUserMessages: countChatUserMessages(cloudChats),
        folderHistoryKeys,
        dedicatedSets: countUserQuizSets(dedicated.sets),
        dedicatedFolders: countUserQuizFolders(dedicated.folders),
        orphaned: {
          notes: orphaned.notes.length,
          quizzes: orphaned.quizzes.length,
          sets: countUserQuizSets(orphaned.sets),
        },
      },
      totalRecoverable: summarizeDataSnapshot(recovery),
      folderNames,
    };
  };

  const emergencyRecoverFromCloud = async (): Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }> => {
    if (!user) return { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 };
    const cloudRes = await rtdbFetch(`/users/${user.uid}`).catch(() => null);
    const cloud = cloudRes && cloudRes.ok
      ? ((await cloudRes.json().catch(() => null)) as Record<string, unknown> | null)
      : null;
    const recovery = await buildRecoverySnapshot(user.uid, cloud);
    const merged: DataHistorySnapshot = {
      notes: mergeNotesById(notes, recovery.notes),
      quizzes: mergeQuizzesById(quizzes, recovery.quizzes, recovery.quizSets.flatMap((set) => set.items ?? [])),
      chats: recovery.chats.length > chats.length ? recovery.chats : chats,
      quizSets: mergeById(quizSets, recovery.quizSets),
      quizFolders: mergeById(quizFolders, recovery.quizFolders),
    };
    return applyRecoverySnapshot(merged, 'emergency cloud recovery');
  };

  const getLocalBackupSummary = () => {
    const local = readLocalNotesData();
    const summary = {
      notes: local.notes.length,
      quizzes: local.quizzes.length,
      sets: local.sets.filter((set) => !set.system).length,
      folders: local.folders.filter((folder) => !folder.system).length,
      chats: local.chats.length,
      hasData: false,
    };
    summary.hasData = summary.notes > 0 || summary.quizzes > 0 || summary.sets > 0 || summary.folders > 0 || summary.chats > 0;
    return summary;
  };

  const restoreFromLocalBackup = async (): Promise<{ notes: number; quizzes: number; sets: number; folders: number; chats: number }> => {
    if (!user) return { notes: 0, quizzes: 0, sets: 0, folders: 0, chats: 0 };
    const local = readLocalNotesData();
    const nextNotes = local.notes;
    const nextQuizzes = local.quizzes;
    const nextChats = local.chats;
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(local.folders, local.sets));
    const nextSets = ensureFavoritesSet(initializeQuizColors(local.sets, nextFolders.map((folder) => folder.color).filter((color): color is string => !!color)));
    const counts = {
      notes: nextNotes.length,
      quizzes: nextQuizzes.length,
      sets: nextSets.filter((set) => !set.system).length,
      folders: nextFolders.filter((folder) => !folder.system).length,
      chats: nextChats.length,
    };
    recoveryLog('manual local restore', counts);
    setNotes(nextNotes);
    setQuizzes(nextQuizzes);
    setChats(nextChats);
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_chats', JSON.stringify(nextChats));
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ notes: nextNotes, quizzes: nextQuizzes, chats: nextChats, quizSets: nextSets, quizFolders: nextFolders }, true);
    await fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`, {
      method: 'PUT',
      body: JSON.stringify(nextSets),
      headers: { 'Content-Type': 'application/json' },
    });
    await fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`, {
      method: 'PUT',
      body: JSON.stringify(nextFolders),
      headers: { 'Content-Type': 'application/json' },
    });
    return counts;
  };

  const hasQuizFolderBackups = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const res = await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory.json?shallow=true`);
      const keys = Object.keys((await res.json()) || {});
      return keys.length > 0;
    } catch {
      return false;
    }
  };

  const addItemToSet = (setId: string, item: Omit<QuizItem, 'id'>): number => {
    const now = new Date().toISOString();
    const newId = Date.now();
    const newItem: QuizItem = { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now };
    recordRecentEdit({ kind: 'setItem', at: Date.now(), setId, item: newItem });
    void persistQuizItemDurable(userRef.current?.uid, newItem, setId);
    let found = false;
    const next = quizSetsRef.current.map((s) => {
      if (s.id !== setId) return s;
      found = true;
      return { ...s, items: [...s.items, newItem], updatedAt: now };
    });
    if (!found) {
      console.error('[addItemToSet] quiz set not found:', setId);
      return -1;
    }
    quizSetsRef.current = next;
    setQuizSets(next);
    rememberLastGoodComplete(quizzesRef.current, next);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    everHadSetsRef.current = true;
    persistSets(next, true, true);
    scheduleInstantDataCloudSave({ quizSets: next });
    return newId;
  };

  const removeItemFromSet = (setId: string, itemId: number) => {
    const trashAt = new Date().toISOString();
    const trashAtMs = Date.parse(trashAt) || Date.now();
    const existing = quizSetsRef.current.find((s) => s.id === setId)?.items.find((i) => i.id === itemId);
    // Soft-delete + bump set.updatedAt so remote merge drops the live copy on
    // other devices (union-merge used to resurrect hard-removed items).
    const next = quizSetsRef.current.map((s) => {
      if (s.id !== setId) return s;
      const items = existing
        ? s.items.map((i) => (
          i.id === itemId
            ? { ...i, trashed: true, deletedAt: nowStr(), updatedAt: trashAt }
            : i
        ))
        : s.items.filter((i) => i.id !== itemId);
      return { ...s, items, updatedAt: trashAt };
    });
    quizItemTombstonesRef.current = markTrashTombstone(
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      quizItemTombstonesRef.current,
      String(itemId),
      trashAtMs,
    );
    const uid = userRef.current?.uid;
    if (uid) pushTrashTombstoneCloud(uid, 'items', String(itemId), trashAtMs);
    quizSetsRef.current = next;
    lastPaintedQuizSetsRef.current = next;
    quizSetsByIdCacheRef.current = honorQuizItemTrashTombstones(
      preferRicherQuizSetsMembership(quizSetsByIdCacheRef.current, next),
      quizItemTombstonesRef.current,
    );
    const touched = next.find((s) => s.id === setId);
    if (touched) maxKnownLiveBySetRef.current.set(setId, countLiveItemsInSet(touched));
    setQuizSets(next);
    rememberLastGoodComplete(quizzesRef.current, next);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    if (existing) {
      void tombstoneQuizItemDurable(userRef.current?.uid, {
        ...existing,
        trashed: true,
        deletedAt: nowStr(),
        updatedAt: trashAt,
      }, setId);
    }
    if (touched) void pushQuizSetById(touched);
    persistSets(next, true, true);
    scheduleInstantDataCloudSave({ quizSets: next });
  };

  const updateItemInSet = (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud = false) => {
    const set = quizSetsRef.current.find((s) => s.id === setId);
    const existing = set?.items.find((i) => i.id === itemId);
    if (!existing || !quizPatchChangesContent(existing, patch)) return;
    const updated: QuizItem = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    recordRecentEdit({ kind: 'setItem', at: Date.now(), setId, item: updated });
    // Live path: always push the single item immediately. Full quizSets array
    // only when forceCloud (finalize / explicit save) — keystrokes must not
    // rewrite multi-MB arrays or other devices lag behind typing.
    void persistQuizItemDurable(userRef.current?.uid, updated, setId, { immediate: true });
    const next = quizSetsRef.current.map((s) => (
      s.id === setId
        ? { ...s, items: s.items.map((i) => (i.id === itemId ? updated : i)) }
        : s
    ));
    quizSetsRef.current = next;
    setQuizSets(next);
    rememberLastGoodComplete(quizzesRef.current, next);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    persistSets(next, false, true);
    if (forceCloud) {
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
    }
  };

  // ── Editor image → Storage URL swap ──────────────────────────────────────
  // The editor uploads pasted/inserted images to Firebase Storage in the
  // background and swaps its own DOM src when done — but if the user saves and
  // closes before the upload finishes, the persisted note/quiz item keeps the
  // multi-hundred-KB base64 copy. That payload size is what overflows the
  // (likely already image-crowded) localStorage quota and turns the cloud
  // write slow enough for a refresh to cancel it — i.e. the "saved then gone
  // after reload" failures. This rewrites every persisted copy of the base64
  // form to the short URL, whenever the upload lands.
  const replaceEditorImageUrl = (fromUrl: string, toUrl: string, quiet = false) => {
    if (!fromUrl || !toUrl || fromUrl === toUrl) return;
    const swap = (s: string) => (s.includes(fromUrl) ? s.split(fromUrl).join(toUrl) : s);
    const now = new Date().toISOString();
    const uid = userRef.current?.uid;

    if (notesRef.current.some((n) => n.html.includes(fromUrl))) {
      const next = notesRef.current.map((n) => (
        n.html.includes(fromUrl) ? { ...n, html: swap(n.html), savedAt: now } : n
      ));
      notesRef.current = next;
      setNotes(next);
      safeSetItem('malacadhati', JSON.stringify(next));
      // Always persist the changed notes one-by-one (durable). Full-array cloud
      // sync is skipped in quiet/migration mode — that was what kept "Saving…"
      // and the leave-page warning stuck for minutes while 60 images migrated.
      next.filter((n) => n.html.includes(toUrl)).forEach((n) => {
        void persistNoteDurable(uid, n);
      });
      if (!quiet) {
        persist({ notes: next }, true);
        scheduleInstantDataCloudSave({ notes: next });
      }
    }

    const quizItemHasUrl = (q: QuizItem) =>
      q.question.includes(fromUrl)
      || q.answer.includes(fromUrl)
      || (q.explanation ?? '').includes(fromUrl)
      || (q.options ?? []).some((o) => o.includes(fromUrl));
    const swapQuizItem = (q: QuizItem): QuizItem => (
      quizItemHasUrl(q)
        ? {
            ...q,
            question: swap(q.question),
            answer: swap(q.answer),
            explanation: q.explanation ? swap(q.explanation) : q.explanation,
            options: q.options ? q.options.map(swap) : q.options,
            updatedAt: now,
          }
        : q
    );

    if (quizzesRef.current.some(quizItemHasUrl)) {
      const next = quizzesRef.current.map(swapQuizItem);
      quizzesRef.current = next;
      setQuizzes(next);
      safeSetItem('malacadhati_quiz', JSON.stringify(next));
      next.filter(quizItemHasUrl).forEach((q) => {
        void persistQuizItemDurable(uid, q, null);
      });
      if (!quiet) {
        persist({ quizzes: next }, true);
        scheduleInstantDataCloudSave({ quizzes: next });
      }
    }

    if (quizSetsRef.current.some((s) => s.items.some(quizItemHasUrl))) {
      const next = quizSetsRef.current.map((s) => (
        s.items.some(quizItemHasUrl)
          ? { ...s, updatedAt: now, items: s.items.map(swapQuizItem) }
          : s
      ));
      quizSetsRef.current = next;
      setQuizSets(next);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
      next.forEach((s) => {
        s.items.filter(quizItemHasUrl).forEach((q) => {
          void persistQuizItemDurable(uid, q, s.id);
        });
      });
      if (!quiet) {
        persistSets(next, true, true);
        scheduleInstantDataCloudSave({ quizSets: next });
      }
    }
  };

  useEffect(() => onEditorImageSwap((from, to) => {
    // Quiet: URL upgrade is an optimization on already-saved content. Firing the
    // full-array cloud sync here was what left "Saving…" / leave-page warnings
    // stuck long after the user finished editing.
    replaceEditorImageUrl(from, to, true);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legacy inline-image migration ─────────────────────────────────────────
  // Old notes/questions still embed images as base64, which keeps localStorage
  // near its quota permanently — the reason fresh saves' local writes can fail
  // silently. Once per session, quietly upload those to Storage and swap the
  // content to short URLs, a few images at a time.
  const collectNoteInlineImageUrls = (html?: string): string[] => {
    if (!html) return [];
    const found: string[] = [];
    const re = /src=["'](data:image\/[^"']+)["']/gi;
    for (let match = re.exec(html); match; match = re.exec(html)) {
      if (match[1] && match[1].length > 80) found.push(match[1]);
    }
    return found;
  };

  const syncNoteImagesToCloud = async () => {
    const uid = userRef.current?.uid;
    if (!uid) return;
    beginTrackedSave();
    try {
      const inline = [...new Set(notesRef.current.flatMap((n) => collectNoteInlineImageUrls(n.html)))];
      for (const dataUrl of inline) {
        if (!userRef.current) return;
        try {
          const remoteUrl = await uploadEditorImage(dataUrl, { trackPending: false });
          if (remoteUrl) replaceEditorImageUrl(dataUrl, remoteUrl, true);
        } catch {
          /* keep the base64 copy — retried next session */
        }
      }
      const imageNotes = notesRef.current.filter((n) => noteHasDisplayableImage(n.html));
      const pushedAt = new Date().toISOString();
      for (const note of imageNotes) {
        if (!userRef.current) return;
        await persistNoteDurable(uid, { ...note, savedAt: pushedAt }).catch(() => false);
      }
    } finally {
      endTrackedSave();
    }
  };

  const noteImageSyncRanRef = useRef(false);
  useEffect(() => {
    if (!user || noteImageSyncRanRef.current) return;
    const hasImages = notes.some((n) => (
      noteHasDisplayableImage(n.html) || /data:image\//i.test(n.html || '')
    ));
    if (!hasImages) return;
    // Home PC: IDB already has the photos. Push them (as Storage URLs) so the
    // hospital PC can load notes the same way Quiz already does.
    noteImageSyncRanRef.current = true;
    const timer = setTimeout(() => { void syncNoteImagesToCloud(); }, 600);
    return () => clearTimeout(timer);
  }, [user?.uid, notes]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveItemInSet = (setId: string, itemId: number, direction: 'up' | 'down') => {
    setQuizSets((prev) => {
      let changed = false;
      const stamp = nowStr();
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const idx = items.findIndex((i) => i.id === itemId);
        if (idx < 0) return s;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= items.length) return s;
        [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
        changed = true;
        return { ...s, items, orderUpdatedAt: stamp, itemsOrder: items.map((i) => i.id) };
      });
      if (!changed) return prev;
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
      // Durable ById + IndexedDB must carry Manual item order — giant array alone
      // is what lost order on refresh when ById/IDB shells won the merge.
      const updated = next.find((s) => s.id === setId);
      if (updated) void pushQuizSetById(updated);
      return next;
    });
  };

  const moveQuiz = (itemId: number, direction: 'up' | 'down') => {
    setQuizzes((prev) => {
      const next = [...prev];
      const idx = next.findIndex((q) => q.id === itemId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      const stamp = nowStr();
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      next[idx] = { ...next[idx], updatedAt: stamp };
      next[swapIdx] = { ...next[swapIdx], updatedAt: stamp };
      persist({ quizzes: next }, true);
      scheduleInstantDataCloudSave({ quizzes: next });
      return next;
    });
  };

  const reorderItemInSet = (setId: string, dragId: number, targetId: number) => {
    setQuizSets((prev) => {
      let changed = false;
      const stamp = nowStr();
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const from = items.findIndex((i) => i.id === dragId);
        const to = items.findIndex((i) => i.id === targetId);
        if (from < 0 || to < 0 || from === to) return s;
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        changed = true;
        return { ...s, items, orderUpdatedAt: stamp, itemsOrder: items.map((i) => i.id) };
      });
      if (!changed) return prev;
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
      const updated = next.find((s) => s.id === setId);
      if (updated) void pushQuizSetById(updated);
      return next;
    });
  };

  const reorderQuiz = (dragId: number, targetId: number) => {
    setQuizzes((prev) => {
      const next = [...prev];
      const from = next.findIndex((q) => q.id === dragId);
      const to = next.findIndex((q) => q.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const stamp = nowStr();
      const [item] = next.splice(from, 1);
      next.splice(to, 0, { ...item, updatedAt: stamp });
      persist({ quizzes: next }, true);
      scheduleInstantDataCloudSave({ quizzes: next });
      return next;
    });
  };

  const orderItemsByIds = (items: QuizItem[], itemIds: number[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = itemIds.map((id) => byId.get(id)).filter((i): i is QuizItem => !!i);
    const rest = items.filter((i) => !itemIds.includes(i.id));
    return [...ordered, ...rest];
  };

  const setItemsOrderInSet = (setId: string, itemIds: number[]) => {
    setQuizSets((prev) => {
      const stamp = nowStr();
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = orderItemsByIds(s.items, itemIds);
        if (items.map((i) => i.id).join() === s.items.map((i) => i.id).join()) return s;
        changed = true;
        return { ...s, items, orderUpdatedAt: stamp, itemsOrder: items.map((i) => i.id) };
      });
      if (!changed) return prev;
      quizSetsRef.current = next;
      rememberLastGoodComplete(quizzesRef.current, next);
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
      // Push the full reordered set (never a shorter items[]) so ById/IDB honor
      // Manual order on the next refresh merge — same durability path as create.
      const updated = next.find((s) => s.id === setId);
      if (updated) void pushQuizSetById(updated);
      return next;
    });
  };

  const setQuizzesOrder = (itemIds: number[]) => {
    setQuizzes((prev) => {
      const next = orderItemsByIds(prev, itemIds);
      if (next.map((q) => q.id).join() === prev.map((q) => q.id).join()) return prev;
      const stamp = nowStr();
      // Stamp the head so mergeQuizzesForSync treats this device as order authority.
      const stamped = next.length ? [{ ...next[0], updatedAt: stamp }, ...next.slice(1)] : next;
      persist({ quizzes: stamped }, true);
      scheduleInstantDataCloudSave({ quizzes: stamped });
      return stamped;
    });
  };

  const toggleRead = (id: number) => updateNote(id, { read: true });
  const toggleUnread = (id: number) => updateNote(id, { read: false });
  const toggleFav = (id: number) => {
    const base = notesRef.current.find((n) => n.id === id);
    if (!base) return;
    updateNote(id, { fav: !base.fav });
  };
  const archive = (id: number) => updateNote(id, { archived: true });
  const unarchive = (id: number) => updateNote(id, { archived: false, read: false });
  const trash = (id: number) => {
    const savedAt = new Date().toISOString();
    const trashAtMs = Date.parse(savedAt) || Date.now();
    const base = notesRef.current.find((n) => n.id === id);
    if (!base) return;
    markNotesTrashedLocally([id]);
    noteTrashTombstonesRef.current = markTrashTombstone(
      NOTE_TRASH_TOMBSTONE_KEY,
      noteTrashTombstonesRef.current,
      String(id),
      trashAtMs,
    );
    const uid = userRef.current?.uid;
    if (uid) pushTrashTombstoneCloud(uid, 'notes', String(id), trashAtMs);
    const trashedNote: Note = { ...base, trashed: true, deletedAt: nowStr(), savedAt };
    // Write the tombstone to IndexedDB + notesById FIRST — otherwise a refresh
    // reloads the live copy from those stores and the note "comes back".
    recordRecentEdit({ kind: 'note', at: Date.now(), note: trashedNote });
    void tombstoneNoteDurable(userRef.current?.uid, trashedNote);
    notesRef.current = notesRef.current.map((n) => (n.id === id ? trashedNote : n));
    setNotes(notesRef.current);
    safeSetItem('malacadhati', JSON.stringify(notesRef.current));
    persist({ notes: notesRef.current }, true);
    scheduleInstantDataCloudSave({ notes: notesRef.current });
  };
  const restore = (id: number) => {
    const savedAt = new Date().toISOString();
    const base = notesRef.current.find((n) => n.id === id);
    if (!base) return;
    localTrashIdsRef.current.delete(Number(id));
    rejectedNoteIdsRef.current.delete(Number(id));
    noteTrashTombstonesRef.current = clearTrashTombstone(
      NOTE_TRASH_TOMBSTONE_KEY,
      noteTrashTombstonesRef.current,
      String(id),
    );
    const restoreUid = userRef.current?.uid;
    if (restoreUid) clearTrashTombstoneCloud(restoreUid, 'notes', String(id));
    const restored: Note = { ...base, trashed: false, deletedAt: undefined, savedAt };
    recordRecentEdit({ kind: 'note', at: Date.now(), note: restored });
    void persistNoteDurable(userRef.current?.uid, restored);
    notesRef.current = notesRef.current.map((n) => (n.id === id ? restored : n));
    setNotes(notesRef.current);
    safeSetItem('malacadhati', JSON.stringify(notesRef.current));
    persist({ notes: notesRef.current }, true);
    scheduleInstantDataCloudSave({ notes: notesRef.current });
  };
  const permDelete = (id: number) => {
    const numId = Number(id);
    if (!Number.isFinite(numId)) return;
    rejectNoteIds([numId]);
    recordPermDeleted({ notes: [numId] });
    purgeNotesFromListCache([numId]);
    noteTrashTombstonesRef.current = clearTrashTombstone(
      NOTE_TRASH_TOMBSTONE_KEY,
      noteTrashTombstonesRef.current,
      String(numId),
    );
    const permUid = userRef.current?.uid;
    if (permUid) clearTrashTombstoneCloud(permUid, 'notes', String(numId));
    const nextNotes = stripPermDeletedNotes(
      notesRef.current.filter((n) => Number(n.id) !== numId),
      permDeletedRef.current,
    );
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    // Single targeted delete — never re-scrub the whole notesById tree on sync.
    void removeNoteDurable(userRef.current?.uid, numId);
    persist({ notes: nextNotes }, true);
    void pushPermDeletedCloud({ notes: nextNotes });
  };
  const emptyTrash = () => {
    const trashedNotes = notesRef.current.filter((n) => n.trashed);
    const trashedQuizzes = quizzesRef.current.filter((q) => q.trashed);
    const trashedSets = quizSetsRef.current.filter((set) => set.trashed);
    const trashedFolders = quizFoldersRef.current.filter((folder) => folder.trashed);
    const quizIdsFromTrashedSets = trashedSets.flatMap((set) => (set.items ?? []).map((item) => item.id));
    const inSetTrashedIds = quizSetsRef.current
      .filter((set) => !set.trashed)
      .flatMap((set) => (set.items ?? []).filter((item) => item.trashed).map((item) => item.id));
    const emptiedAt = new Date().toISOString();
    const emptiedAtMs = Date.now();
    rejectNoteIds(trashedNotes.map((n) => n.id));
    purgeNotesFromListCache(trashedNotes.map((n) => n.id));
    recordPermDeleted({
      notes: trashedNotes.map((n) => n.id),
      quizzes: [...trashedQuizzes.map((q) => q.id), ...quizIdsFromTrashedSets, ...inSetTrashedIds],
      quizSets: trashedSets.map((set) => set.id),
      quizFolders: trashedFolders.map((folder) => folder.id),
    });
    const deadQuizzes = new Set(permDeletedRef.current.quizzes);
    const nextNotes = notesRef.current.filter((n) => !n.trashed);
    const nextQuizzes = quizzesRef.current.filter((q) => !q.trashed);
    const removedFolderIds = new Set(trashedFolders.map((folder) => folder.id));
    const nextSets = quizSetsRef.current
      .filter((set) => !set.trashed)
      .map((set) => {
        const hadTrashed = (set.items ?? []).some((item) => item.trashed || deadQuizzes.has(item.id));
        return {
          ...set,
          folderId: set.folderId && removedFolderIds.has(set.folderId) ? undefined : set.folderId,
          items: (set.items ?? []).filter((item) => !item.trashed && !deadQuizzes.has(item.id)),
          // Bump membership so durable live copies cannot re-append stripped ids.
          ...(hadTrashed ? { updatedAt: emptiedAt } : {}),
        };
      });
    const nextFolders = quizFoldersRef.current.filter((folder) => !folder.trashed);

    notesRef.current = nextNotes;
    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    quizFoldersRef.current = nextFolders;

    setNotes(nextNotes);
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);

    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    writeTrashEmptiedAt(emptiedAtMs);
    quizSetTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizSetTombstonesRef.current,
      QUIZ_SET_TRASH_TOMBSTONE_KEY,
      emptiedAtMs,
    );
    quizFolderTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizFolderTombstonesRef.current,
      QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
      emptiedAtMs,
    );
    quizItemTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      quizItemTombstonesRef.current,
      QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
      emptiedAtMs,
    );
    noteTrashTombstonesRef.current = pruneSoftTombstonesAfterEmpty(
      noteTrashTombstonesRef.current,
      NOTE_TRASH_TOMBSTONE_KEY,
      emptiedAtMs,
    );

    const uid = userRef.current?.uid;
    // Destroy ById mirrors BEFORE clearing soft-delete markers. Otherwise a
    // lingering trashed ById row re-imports and re-stamps quizTrash (Empty Trash
    // looks like it worked, then "dia" comes back alone).
    trashedSets.forEach((s) => purgeQuizSetByIdCloud(s.id));
    trashedFolders.forEach((f) => purgeQuizFolderByIdCloud(f.id));
    // Soft-delete markers are obsolete once the row is permanently gone.
    trashedSets.forEach((s) => {
      quizSetTombstonesRef.current = clearTrashTombstone(QUIZ_SET_TRASH_TOMBSTONE_KEY, quizSetTombstonesRef.current, s.id);
      if (uid) clearTrashTombstoneCloud(uid, 'sets', s.id);
    });
    trashedFolders.forEach((f) => {
      quizFolderTombstonesRef.current = clearTrashTombstone(QUIZ_FOLDER_TRASH_TOMBSTONE_KEY, quizFolderTombstonesRef.current, f.id);
      if (uid) clearTrashTombstoneCloud(uid, 'folders', f.id);
    });
    const emptiedQuizIds = [...trashedQuizzes.map((q) => q.id), ...quizIdsFromTrashedSets, ...inSetTrashedIds];
    emptiedQuizIds.forEach((id) => {
      quizItemTombstonesRef.current = clearTrashTombstone(
        QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
        quizItemTombstonesRef.current,
        String(id),
      );
      if (uid) clearTrashTombstoneCloud(uid, 'items', String(id));
    });
    trashedNotes.forEach((n) => {
      noteTrashTombstonesRef.current = clearTrashTombstone(
        NOTE_TRASH_TOMBSTONE_KEY,
        noteTrashTombstonesRef.current,
        String(n.id),
      );
      if (uid) clearTrashTombstoneCloud(uid, 'notes', String(n.id));
      void removeNoteDurable(uid, n.id);
    });
    emptiedQuizIds.forEach((id) => { void removeQuizItemDurable(uid, id); });
    lastPaintedQuizSetsRef.current = nextSets;
    lastPaintedQuizzesRef.current = nextQuizzes;
    for (const set of nextSets) {
      if (!set?.id) continue;
      maxKnownLiveBySetRef.current.set(set.id, countLiveItemsInSet(set));
    }
    rememberLastGoodComplete(nextQuizzes, nextSets, true);

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    writeLocalCache();

    const u = userRef.current;
    if (u && loadedRef.current) {
      void runInstantTrashCloudSave(nextNotes, nextQuizzes, nextSets, nextFolders);
    }
  };
  const deleteMany = (ids: number[]) => {
    if (ids.length === 0) return;
    rejectNoteIds(ids);
    recordPermDeleted({ notes: ids });
    purgeNotesFromListCache(ids);
    ids.forEach((id) => {
      noteTrashTombstonesRef.current = clearTrashTombstone(
        NOTE_TRASH_TOMBSTONE_KEY,
        noteTrashTombstonesRef.current,
        String(id),
      );
      const manyUid = userRef.current?.uid;
      if (manyUid) clearTrashTombstoneCloud(manyUid, 'notes', String(id));
    });
    const idSet = new Set(ids);
    const nextNotes = notesRef.current.filter((n) => !idSet.has(n.id));
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    ids.forEach((id) => { void removeNoteDurable(userRef.current?.uid, id); });
    persist({ notes: nextNotes }, true);
    void pushPermDeletedCloud({ notes: nextNotes });
  };

  return (
    <NotesContext.Provider
      value={{
        notes: notes.filter((n) => (
          !blockedNoteIdSet(permDeletedRef.current, rejectedNoteIdsRef.current).has(Number(n.id))
        )),
        drafts,
        quizzes: quizzes.filter((q) => !q.trashed),
        // Never surface permanently-deleted ghosts even if a stale sync briefly
        // rehydrates them into `quizzes` — that blink is what Trash X felt like.
        trashedQuizzes: quizzes.filter((q) => (
          !!q.trashed
          && !permDeletedRef.current.quizzes.some((deadId) => Number(deadId) === Number(q.id))
        )),
        quizSets,
        quizFolders,
        sidebarCounts,
        cloudStatus,
        cloudSyncedAt,
        loaded,
        quizLocalReady,
        quizContentReady,
        draftsReady,
        draftsLoading,
        addQuiz,
        deleteQuiz, restoreQuiz, permDeleteQuiz,
        updateQuiz,
        addQuizSet,
        reorderQuizSets,
        deleteQuizSet,
        restoreQuizSet,
        permDeleteQuizSet,
        renameQuizSet,
        setQuizSetColor,
        setQuizSetFolder,
        addQuizFolder,
        renameQuizFolder,
        reorderQuizFolders,
        setQuizFolderColor,
        deleteQuizFolder,
        restoreQuizFolder,
        permDeleteQuizFolder,
        recoverQuizFolders,
        listQuizFolderBackups,
        restoreQuizFolderBackup,
        hasQuizFolderBackups,
        listDataBackups,
        restoreDataBackup,
        hasDataBackups,
        scanRecoverableCloud,
        emergencyRecoverFromCloud,
        getLocalBackupSummary,
        restoreFromLocalBackup,
        addItemToSet,
        removeItemFromSet,
        updateItemInSet,
        moveItemInSet,
        reorderItemInSet,
        setItemsOrderInSet,
        moveQuiz,
        reorderQuiz,
        setQuizzesOrder,
        addDraft,
        removeDraft,
        updateDraft,
        submitDraft,
        toggleRead,
        toggleUnread,
        toggleFav,
        archive,
        unarchive,
        trash,
        restore,
        permDelete,
        emptyTrash,
        deleteMany,
        updateNote,
        hydrateNote,
        hydrateQuizSet,
        nowStr,
        chats,
        saveChats,
      }}
    >
      {children}
    </NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within NotesProvider');
  return ctx;
}
