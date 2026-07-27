import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref as dbRef, update } from 'firebase/database';
import type { Note, QuizItem, QuizSet, QuizFolder, ChatConversation } from '../types';
import { database, FB_DB_URL } from '../lib/firebase';
import { buildFullBackupPayload, shouldRunHourlyFolderBackup, writeBackupToFolder } from '../lib/externalBackup';
import { setTokenSink } from '../lib/gemini';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';
import { quizPatchChangesContent, quizzesEqualForUI, quizSetsEqualForUI } from '../lib/quizContent';
import { getRtdbAuthToken, rtdbFetch } from '../lib/rtdb';
import { onEditorImageSwap, uploadEditorImage } from '../lib/imageUpload';
import { extractPlainText, hasRichContent } from '../lib/richContent';

/**
 * localStorage can throw (QuotaExceededError) when quiz answers embed large
 * base64 images. If that exception escapes an unwrapped setItem call, it can
 * abort the rest of the caller (e.g. addItemToSet) — including the Firebase
 * cloud write — so a newly-saved question would show in the UI but vanish on
 * refresh because it was never persisted anywhere durable. Always go through
 * this helper so a storage failure never blocks cloud sync.
 */
function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    console.error('[localStorage] setItem failed for', key, err);
  }
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

function quizSyncTime(item: QuizItem) {
  return Date.parse(item.updatedAt || item.createdAt || '') || 0;
}

function pickNewerQuizItem(a: QuizItem, b: QuizItem) {
  if (!!a.trashed !== !!b.trashed) return b.trashed ? b : a;
  return quizSyncTime(b) >= quizSyncTime(a) ? b : a;
}

function noteContentLength(note: Note) {
  return (note.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length + (note.title || '').trim().length;
}

const TRASH_EMPTIED_AT_KEY = 'malacadhati_trash_emptied_at';
const PERM_DELETED_KEY = 'malacadhati_perm_deleted';

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
  safeSetItem(PERM_DELETED_KEY, JSON.stringify(ids));
}

function parseCloudPermDeleted(cloud: Record<string, unknown> | null | undefined): PermanentlyDeletedIds {
  return parsePermDeletedVal(cloud?.permanentlyDeletedIds);
}

function parsePermDeletedVal(val: unknown): PermanentlyDeletedIds {
  if (!val || typeof val !== 'object') return emptyPermDeleted();
  const raw = val as Partial<PermanentlyDeletedIds>;
  return {
    notes: Array.isArray(raw.notes) ? [...new Set(raw.notes.map(Number).filter(Number.isFinite))] : [],
    quizzes: Array.isArray(raw.quizzes) ? [...new Set(raw.quizzes.map(Number).filter(Number.isFinite))] : [],
    quizSets: Array.isArray(raw.quizSets) ? [...new Set(raw.quizSets.map(String))] : [],
    quizFolders: Array.isArray(raw.quizFolders) ? [...new Set(raw.quizFolders.map(String))] : [],
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

function addPermDeleted(local: PermanentlyDeletedIds, patch: Partial<PermanentlyDeletedIds>): PermanentlyDeletedIds {
  return {
    notes: [...new Set([...local.notes, ...(patch.notes ?? [])])],
    quizzes: [...new Set([...local.quizzes, ...(patch.quizzes ?? [])])],
    quizSets: [...new Set([...local.quizSets, ...(patch.quizSets ?? [])])],
    quizFolders: [...new Set([...local.quizFolders, ...(patch.quizFolders ?? [])])],
  };
}

function stripPermDeletedQuizSets(sets: QuizSet[], tombstones: PermanentlyDeletedIds): QuizSet[] {
  const deadSets = new Set(tombstones.quizSets);
  const deadQuizzes = new Set(tombstones.quizzes);
  return sets
    .filter((set) => !deadSets.has(set.id))
    .map((set) => ({ ...set, items: (set.items ?? []).filter((item) => !deadQuizzes.has(item.id)) }));
}

function entitySyncTime(item: { updatedAt?: string; createdAt?: string; savedAt?: string }) {
  return Date.parse(item.updatedAt || item.savedAt || item.createdAt || '') || 0;
}

function noteContentKey(note: Note) {
  return `${note.title}\0${note.html}`;
}

function pickBetterNote(local: Note, remote: Note) {
  if (noteSyncKey(local) === noteSyncKey(remote)) return local;
  if (local.trashed !== remote.trashed) return remote.trashed ? remote : local;
  if (noteContentKey(local) === noteContentKey(remote)) {
    return entitySyncTime(remote) >= entitySyncTime(local) ? remote : local;
  }
  const localLen = noteContentLength(local);
  const remoteLen = noteContentLength(remote);
  if (remoteLen !== localLen) return remoteLen > localLen ? remote : local;
  return entitySyncTime(remote) >= entitySyncTime(local) ? remote : local;
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

function mergeNotesForSync(local: Note[], remote: Note[], tombstones: PermanentlyDeletedIds = emptyPermDeleted()) {
  const dead = new Set(tombstones.notes);
  const remoteIds = new Set(remote.map((item) => item.id));
  const map = new Map<number, Note>();
  for (const item of local) {
    if (dead.has(item.id)) continue;
    if (!remoteIds.has(item.id) && item.trashed) continue;
    map.set(item.id, item);
  }
  for (const item of remote) {
    if (dead.has(item.id)) continue;
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickBetterNote(existing, item) : item);
  }
  return [...map.values()];
}

function mergeQuizzesForSync(local: QuizItem[], remote: QuizItem[], tombstones: PermanentlyDeletedIds = emptyPermDeleted()) {
  const dead = new Set(tombstones.quizzes);
  const remoteIds = new Set(remote.map((item) => item.id));
  const map = new Map<number, QuizItem>();
  for (const item of local) {
    if (dead.has(item.id)) continue;
    if (!remoteIds.has(item.id) && item.trashed) continue;
    map.set(item.id, item);
  }
  for (const item of remote) {
    if (dead.has(item.id)) continue;
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickNewerQuizItem(existing, item) : item);
  }
  return [...map.values()];
}

function filterResurrectedTrash<T extends { id: string | number; trashed?: boolean; updatedAt?: string; createdAt?: string; savedAt?: string }>(merged: T[], local: T[]): T[] {
  const emptiedAt = Number(localStorage.getItem(TRASH_EMPTIED_AT_KEY)) || 0;
  const localTrashIds = new Set(local.filter((item) => item.trashed).map((item) => String(item.id)));
  return merged.filter((item) => {
    if (!item.trashed) return true;
    if (localTrashIds.has(String(item.id))) return true;
    if (!emptiedAt) return true;
    return entitySyncTime(item) > emptiedAt;
  });
}

function pickBetterQuizSet(local: QuizSet, remote: QuizSet, tombstones: PermanentlyDeletedIds = emptyPermDeleted()): QuizSet {
  if (!!local.trashed !== !!remote.trashed) return remote.trashed ? remote : local;
  const base = entitySyncTime(remote) >= entitySyncTime(local) ? remote : local;
  return { ...base, items: mergeQuizzesForSync(local.items ?? [], remote.items ?? [], tombstones) };
}

function pickBetterQuizFolder(local: QuizFolder, remote: QuizFolder): QuizFolder {
  if (!!local.trashed !== !!remote.trashed) return remote.trashed ? remote : local;
  const localGeneric = isGenericRecoveredFolderName(local.name);
  const remoteGeneric = isGenericRecoveredFolderName(remote.name);
  if (localGeneric !== remoteGeneric) return localGeneric ? remote : local;
  return entitySyncTime(remote) >= entitySyncTime(local) ? remote : local;
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

function mergeQuizSetsForSync(local: QuizSet[], remote: QuizSet[], tombstones: PermanentlyDeletedIds = emptyPermDeleted()) {
  const dead = new Set(tombstones.quizSets);
  const remoteIds = new Set(remote.map((set) => set.id));
  const map = new Map<string, QuizSet>();
  for (const set of local) {
    if (dead.has(set.id)) continue;
    if (!remoteIds.has(set.id) && set.trashed) continue;
    map.set(set.id, set);
  }
  for (const set of remote) {
    if (dead.has(set.id)) continue;
    const existing = map.get(set.id);
    map.set(set.id, existing ? pickBetterQuizSet(existing, set, tombstones) : set);
  }
  return stripPermDeletedQuizSets([...map.values()], tombstones);
}

function mergeFoldersForSync(local: QuizFolder[], remote: QuizFolder[], tombstones: PermanentlyDeletedIds = emptyPermDeleted()) {
  const dead = new Set(tombstones.quizFolders);
  const remoteIds = new Set(remote.map((folder) => folder.id));
  const map = new Map<string, QuizFolder>();
  for (const folder of local) {
    if (dead.has(folder.id)) continue;
    if (!remoteIds.has(folder.id) && folder.trashed) continue;
    map.set(folder.id, folder);
  }
  for (const folder of remote) {
    if (dead.has(folder.id)) continue;
    const existing = map.get(folder.id);
    map.set(folder.id, existing ? pickBetterQuizFolder(existing, folder) : folder);
  }
  return [...map.values()];
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
  chats: ChatConversation[];
  saveChats: (chats: ChatConversation[]) => void;
  cloudStatus: CloudStatus;
  cloudSyncedAt: number | null;
  loaded: boolean;
  /** Drafts are usable (read/write/cloud) before the full account load finishes. */
  draftsReady: boolean;
  /** Fetching draft bundle from cloud (other devices). */
  draftsLoading: boolean;
  addQuiz: (item: Omit<QuizItem, 'id'>) => number;
  deleteQuiz: (id: number, fromSetId?: string | null) => void;
  restoreQuiz: (id: number) => void;
  permDeleteQuiz: (id: number) => void;
  updateQuiz: (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud?: boolean) => void;
  addQuizSet: (name: string) => QuizSet;
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
  nowStr: () => string;
}

const NotesContext = createContext<NotesCtx | null>(null);

function firebaseToArray<T>(data: T[] | Record<string, T> | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean);
  if (typeof data === 'object') return Object.values(data).filter(Boolean);
  return [];
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

const LOCAL_DATA_KEYS = [
  'malacadhati',
  'malacadhati_drafts',
  'malacadhati_quiz',
  'malacadhati_quiz_sets',
  'malacadhati_quiz_folders',
  'malacadhati_chats',
] as const;

function clearLocalNotesData() {
  for (const key of LOCAL_DATA_KEYS) localStorage.removeItem(key);
}

/** Clear cached notes when a different account signs in (keys are not uid-scoped). */
function syncAccountLocalStorage(uid: string) {
  const prev = localStorage.getItem(LAST_UID_KEY);
  if (prev && prev !== uid) clearLocalNotesData();
  safeSetItem(LAST_UID_KEY, uid);
}

function readLocalNotesData() {
  return {
    notes: firebaseToArray<Note>(readLocalJson<Note[]>('malacadhati') ?? []),
    drafts: firebaseToArray<Draft>(readLocalJson<Draft[]>('malacadhati_drafts') ?? []),
    quizzes: firebaseToArray<QuizItem>(readLocalJson<QuizItem[]>('malacadhati_quiz') ?? []),
    chats: firebaseToArray<ChatConversation>(readLocalJson<ChatConversation[]>('malacadhati_chats') ?? []).map((c) => ({
      ...c,
      messages: c.messages ?? [],
    })),
    folders: firebaseToArray<QuizFolder>(readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? []),
    sets: firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>('malacadhati_quiz_sets') ?? []).map((set) => ({
      ...set,
      items: set.items ?? [],
    })),
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
    && countUserQuizSets(qsList) === 0
    && countUserQuizFolders(qfList) === 0
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

function pickSpacedColor(usedColors: string[]) {
  const used = usedColors.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  const counts = new Map(AUTO_QUIZ_COLORS.map((color) => [color, used.filter((usedColor) => usedColor.toLowerCase() === color).length]));
  const lowestUse = Math.min(...counts.values());
  const leastUsed = AUTO_QUIZ_COLORS.filter((color) => counts.get(color) === lowestUse);
  if (used.length === 0) return leastUsed[Math.floor(Math.random() * leastUsed.length)];
  const scored = leastUsed.map((color) => ({ color, score: Math.min(...used.map((usedColor) => colorDistance(color, usedColor))) }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore);
  return best[Math.floor(Math.random() * best.length)].color;
}

function initializeQuizColors<T extends { color?: string; colorInitialized?: boolean }>(items: T[], initialColors: string[] = []) {
  const used = [...initialColors, ...items.map((item) => item.color).filter((color): color is string => !!color)];
  return items.map((item) => {
    if (item.colorInitialized || item.color) return item;
    const color = pickSpacedColor(used);
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
  const referenced = new Set<string>();
  for (const set of sets) {
    if (!set.folderId || set.trashed) continue;
    if (set.folderId === FAVORITES_FOLDER_ID || set.folderId === RESTORED_FOLDER_ID) continue;
    referenced.add(set.folderId);
  }

  const recovered = [...folders];
  for (const folderId of referenced) {
    if (known.has(folderId)) continue;
    const setsInFolder = sets.filter((set) => set.folderId === folderId && !set.trashed);
    const usedColors = [...folders, ...sets].map((item) => item.color).filter((color): color is string => !!color);
    recovered.push({
      id: folderId,
      name: recoveredFolderNameFromLocal(folderId, setsInFolder),
      createdAt: new Date().toISOString(),
      color: pickSpacedColor(usedColors),
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [quizSets, setQuizSets] = useState<QuizSet[]>([]);
  const [quizFolders, setQuizFolders] = useState<QuizFolder[]>(ensureRestoredFolder([]));
  const [chats, setChats] = useState<ChatConversation[]>([]);
  const [tokenUsage, setTokenUsage] = useState<number>(0);
  const draftCounter = useRef(0);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');
  const [cloudSyncedAt, setCloudSyncedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draftsReady, setDraftsReady] = useState(false);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const loadedRef = useRef(false);
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
  const pendingDeletedDraftIdsRef = useRef<Set<string>>(readDeletedDraftIds());
  const permDeletedRef = useRef<PermanentlyDeletedIds>(readPermDeleted());
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
  const draftLocalEditAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftHtmlRef = useRef<Map<string, string>>(new Map());
  const draftSaveInFlightRef = useRef<Set<string>>(new Set());
  const draftSavePendingAgainRef = useRef<Set<string>>(new Set());
  const pendingLocalDraftIdsRef = useRef<Set<string>>(new Set());
  const pullTimer = useRef<number | null>(null);
  const pendingRemotePullRef = useRef(false);
  const lastPushedDataAtRef = useRef(0);
  const lastPushedPayloadRef = useRef<Partial<Record<'notes' | 'quizzes' | 'quizSets' | 'quizFolders', string>>>({});
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
  const quizFoldersRef = useRef(quizFolders);
  const draftsRef = useRef(drafts);
  const tokenUsageRef = useRef(tokenUsage);
  const MIN_SYNC_VISIBLE_MS = 650;

  notesRef.current = notes;
  quizzesRef.current = quizzes;
  chatsRef.current = chats;
  quizSetsRef.current = quizSets;
  quizFoldersRef.current = quizFolders;
  draftsRef.current = drafts;
  tokenUsageRef.current = tokenUsage;

  const nowStr = () =>
    new Date().toLocaleString(t.dateLocale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  // Load from cloud when user changes
  useEffect(() => {
    let cancelled = false;
    loadedRef.current = false;
    cloudLoadSucceededRef.current = false;
    draftsReadyRef.current = false;
    setDraftsReady(false);
    setDraftsLoading(false);
    setLoaded(false);
    if (!user) {
      setNotes([]);
      setDrafts([]);
      setCloudSyncedAt(null);
      loadedRef.current = true;
      setLoaded(true);
      return;
    }
    syncAccountLocalStorage(user.uid);
    const local = readLocalNotesData();
    const storedCloudSyncAt = Number(localStorage.getItem(CLOUD_SYNCED_AT_KEY));
    if (storedCloudSyncAt > 0) setCloudSyncedAt(storedCloudSyncAt);

    const applyLocalCache = () => {
      if (local.notes.length) setNotes(local.notes);
      if (local.quizzes.length) setQuizzes(local.quizzes);
      if (local.chats.length) setChats(local.chats);
      if (local.folders.length) {
        setQuizFolders(ensureRestoredFolder(initializeQuizColors(local.folders)));
      }
      if (local.sets.length) setQuizSets(local.sets);
      if (local.drafts.length) {
        const stamped = stampDrafts(local.drafts).filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id));
        setDrafts(stamped);
        draftsRef.current = stamped;
        draftCounter.current = maxDraftCounter(stamped) || stamped.length;
      }
    };

    const applyLocalFallback = () => {
      applyLocalCache();
      const { drafts, counter } = resolveDraftsFromSources(null, local.drafts, pendingDeletedDraftIdsRef.current);
      draftCounter.current = counter;
      setDrafts(drafts);
    };

    applyLocalCache();

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

    (async () => {
      try {
        const r = await rtdbFetch(`/users/${user.uid}`);
        if (!r.ok) throw new Error('cloud-fetch-failed');
        cloudLoadSucceededRef.current = true;
        const cloud = (await r.json()) as Record<string, unknown> | null;
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
        const tombstones = permDeletedRef.current;

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
            notes = mergeNotesForSync(notes, historySnapshot.notes, tombstones);
            notesRepair = true;
            historyRepair = true;
            recoveryLog('recovered notes from latest dataHistory', { count: notes.length });
          }
        }

        const historySnapshots = await fetchAllDataHistorySnapshots(user.uid);
        for (const snapshot of historySnapshots) {
          const before = notes.length;
          notes = mergeNotesForSync(notes, snapshot.notes.filter((n) => !n.trashed), tombstones);
          if (notes.length > before) {
            notesRepair = true;
            historyRepair = true;
            recoveryLog('restored notes from dataHistory snapshot', { before, after: notes.length, savedAt: snapshot.savedAt });
          }
          const quizzesBefore = quizzes.length;
          quizzes = mergeQuizzesForSync(quizzes, snapshot.quizzes.filter((q) => !q.trashed), tombstones);
          if (quizzes.length > quizzesBefore) quizzesRepair = true;
        }

        setNotes(notes);
        safeSetItem('malacadhati', JSON.stringify(notes));

        setQuizzes(quizzes);
        safeSetItem('malacadhati_quiz', JSON.stringify(quizzes));

        setChats(chats);
        safeSetItem('malacadhati_chats', JSON.stringify(chats));

        let dedicatedFolders: QuizFolder[] = [];
        let dedicatedSets: QuizSet[] = [];
        try {
          const folderRes = await rtdbFetch(`/users/${user.uid}/quizFolders`);
          if (folderRes.ok) dedicatedFolders = firebaseToArray<QuizFolder>(await folderRes.json());
        } catch { /* ignore */ }
        try {
          const setRes = await rtdbFetch(`/users/${user.uid}/quizSets`);
          if (setRes.ok) {
            dedicatedSets = firebaseToArray<QuizSet>(await setRes.json()).map((set) => ({ ...set, items: set.items ?? [] }));
          }
        } catch { /* ignore */ }

        const cloudFolders = cloud ? firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>) : [];
        const cloudSets = cloud
          ? firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] }))
          : [];
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
          mergeFoldersForSync(liveFolders, mergeById(cloudFolders, dedicatedFolders), tombstones),
          liveFolders,
        );
        let rawSets: QuizSet[] = filterResurrectedTrash(
          mergeQuizSetsForSync(liveSets, mergeQuizSetsForSync(cloudSets, dedicatedSets, tombstones), tombstones),
          liveSets,
        );
        let repairQuizStructure = false;
        if (countUserQuizFolders(rawFolders) === 0 && liveFolders.some((folder) => !folder.system)) {
          rawFolders = mergeById(rawFolders, liveFolders);
          repairQuizStructure = true;
        }
        if (countUserQuizSets(rawSets) === 0 && liveSets.some((set) => !set.system)) {
          rawSets = mergeById(rawSets, liveSets);
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
          const historyFolders = await fetchLatestFolderHistory(user.uid);
          if (historyFolders) {
            rawFolders = mergeById(rawFolders, historyFolders);
            repairQuizStructure = true;
            historyRepair = true;
          }
        }

        const normalizedFolders = finalizeQuizFolders(rawFolders, rawSets);
        const normalizedSets = initializeQuizColors(
          rawSets,
          normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
        );
        setQuizSets(normalizedSets);
        safeSetItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
        setQuizFolders(normalizedFolders);
        safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));

        const needsRepair = notesRepair || quizzesRepair || chatsRepair || repairQuizStructure || historyRepair
          || (cloudSetsEmpty && dedicatedSetsEmpty && liveSets.length > 0)
          || (cloudFoldersEmpty && dedicatedFoldersEmpty && liveFolders.length > 0);
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
        markEverHadContent(notes, quizzes, normalizedSets);
        if (needsRepair) {
          recoveryLog('repairing cloud from local/history');
          const repairBody: Record<string, unknown> = { chats, quizFolders: normalizedFolders };
          if (notes.length > 0) repairBody.notes = notes;
          if (quizzes.length > 0) repairBody.quizzes = quizzes;
          if (countUserQuizSets(normalizedSets) > 0) repairBody.quizSets = normalizedSets;
          void rtdbFetch(`/users/${user.uid}`, {
            method: 'PATCH',
            body: JSON.stringify(repairBody),
            headers: { 'Content-Type': 'application/json' },
          });
          if (repairQuizStructure || (cloudSetsEmpty && dedicatedSetsEmpty && liveSets.length > 0)) {
            void rtdbFetch(`/users/${user.uid}/quizSets`, {
              method: 'PUT',
              body: JSON.stringify(normalizedSets),
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (repairQuizStructure || (cloudFoldersEmpty && dedicatedFoldersEmpty && liveFolders.length > 0)) {
            void rtdbFetch(`/users/${user.uid}/quizFolders`, {
              method: 'PUT',
              body: JSON.stringify(normalizedFolders),
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
    };
  }, [user]);

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
  const persistSets = (nextSets: QuizSet[], forceCloud = false, skipDirectPut = false) => {
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    quizSetsRef.current = nextSets;
    // Never force a full-user PATCH here — that raced with empty notes and wiped the cloud.
    persist({ quizSets: nextSets }, false);
    if (user && loadedRef.current && forceCloud) {
      if (countUserQuizSets(nextSets) === 0 && everHadSetsRef.current) {
        recoveryLog('skipped quizSets PUT wipe');
        return;
      }
      if (countUserQuizSets(nextSets) > 0) everHadSetsRef.current = true;
      if (skipDirectPut) return;
      savesInFlight.current += 1;
      void rtdbFetch(`/users/${user.uid}/quizSets`, {
        method: 'PUT',
        body: JSON.stringify(nextSets),
        headers: { 'Content-Type': 'application/json' },
      }).finally(() => {
        savesInFlight.current = Math.max(0, savesInFlight.current - 1);
      });
    }
  };

  const persistFolders = (nextFolders: QuizFolder[], forceCloud = false) => {
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist({ quizFolders: nextFolders }, forceCloud);
    if (user && loadedRef.current && (forceCloud || countUserQuizFolders(nextFolders) > 0 || countUserQuizSets(quizSets) > 0)) {
      void rtdbFetch(`/users/${user.uid}/quizFolders`, {
        method: 'PUT',
        body: JSON.stringify(nextFolders),
        headers: { 'Content-Type': 'application/json' },
      });
      void appendFolderHistory(user.uid, nextFolders);
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
    safeSetItem('malacadhati', JSON.stringify(notesRef.current));
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
      await getRtdbAuthToken(true);
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
    const deadNotes = new Set(tombstones.notes);
    const deadQuizzes = new Set(tombstones.quizzes);
    const deadSets = new Set(tombstones.quizSets);
    const deadFolders = new Set(tombstones.quizFolders);

    const nextNotes = notesRef.current.filter((n) => !deadNotes.has(n.id));
    const nextQuizzes = quizzesRef.current.filter((q) => !deadQuizzes.has(q.id));
    const nextSets = stripPermDeletedQuizSets(
      quizSetsRef.current.filter((s) => !deadSets.has(s.id)),
      tombstones,
    );
    const nextFolders = quizFoldersRef.current.filter((f) => !deadFolders.has(f.id));
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

  const applyRemoteTrashData = (patch: {
    notes?: unknown;
    quizzes?: unknown;
    quizSets?: unknown;
    quizFolders?: unknown;
  }) => {
    if (!loadedRef.current || isApplyingRemoteRef.current) return;
    const tombstones = permDeletedRef.current;
    let nextNotes = notesRef.current;
    let nextQuizzes = quizzesRef.current;
    let nextSets = quizSetsRef.current;
    let nextFolders = quizFoldersRef.current;
    let changed = false;

    if (patch.notes !== undefined) {
      const remoteNotes = firebaseToArray<Note>(patch.notes as Note[] | Record<string, Note>);
      const merged = filterResurrectedTrash(
        mergeNotesForSync(notesRef.current, remoteNotes, tombstones),
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
      const merged = filterResurrectedTrash(
        mergeQuizzesForSync(quizzesRef.current, remoteQuizzes, tombstones),
        quizzesRef.current,
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
      const merged = filterResurrectedTrash(
        mergeQuizSetsForSync(quizSetsRef.current, remoteSets, tombstones),
        quizSetsRef.current,
      );
      const json = JSON.stringify(merged);
      if (!shouldSkipRemoteEcho('quizSets', json) && json !== JSON.stringify(quizSetsRef.current)) {
        nextSets = merged;
        changed = true;
      }
    }
    if (patch.quizFolders !== undefined) {
      const remoteFolders = firebaseToArray<QuizFolder>(patch.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
      const merged = filterResurrectedTrash(
        mergeFoldersForSync(quizFoldersRef.current, remoteFolders, tombstones),
        quizFoldersRef.current,
      );
      const json = JSON.stringify(merged);
      if (!shouldSkipRemoteEcho('quizFolders', json) && json !== JSON.stringify(quizFoldersRef.current)) {
        nextFolders = merged;
        changed = true;
      }
    }
    if (!changed) return;

    const normalizedFolders = finalizeQuizFolders(nextFolders, nextSets);
    const normalizedSets = initializeQuizColors(
      nextSets,
      normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
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
        const prevSets = quizSetsRef.current;
        quizSetsRef.current = normalizedSets;
        safeSetItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
        if (!quizSetsEqualForUI(normalizedSets, prevSets)) setQuizSets(normalizedSets);
      }
      if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
        quizFoldersRef.current = normalizedFolders;
        setQuizFolders(normalizedFolders);
        safeSetItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
      }
    } finally {
      isApplyingRemoteRef.current = false;
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
      await getRtdbAuthToken(true);
      await update(dbRef(database, `users/${u.uid}`), {
        notes: nextNotes,
        quizzes: nextQuizzes,
        quizSets: nextSets,
        quizFolders: nextFolders,
        permanentlyDeletedIds: permDeletedRef.current,
        cloudSyncAt: syncedAt,
      });
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
    if (!u || !loadedRef.current) return;
    const syncedAt = Date.now();
    try {
      await update(dbRef(database, `users/${u.uid}`), {
        ...(payload?.notes ? { notes: payload.notes } : {}),
        ...(payload?.quizzes ? { quizzes: payload.quizzes } : {}),
        ...(payload?.quizSets ? { quizSets: payload.quizSets } : {}),
        ...(payload?.quizFolders ? { quizFolders: payload.quizFolders } : {}),
        permanentlyDeletedIds: permDeletedRef.current,
        cloudSyncAt: syncedAt,
      });
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      safeSetItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
      markPushedData(payload ?? {}, syncedAt);
    } catch (err) {
      // Full cloud save will retry the data, but surface the failure instead
      // of silently pretending the delete was synced.
      console.error('[cloud-save] perm-delete push failed', err);
      saveFailedRef.current = true;
      setCloudStatus('error');
    }
  };

  const runInstantDataCloudSave = async (patch: {
    notes?: Note[];
    quizzes?: QuizItem[];
    quizSets?: QuizSet[];
    quizFolders?: QuizFolder[];
  }) => {
    const u = userRef.current;
    if (!u || !loadedRef.current) return;
    const safe: typeof patch = { ...patch };
    if (safe.notes && safe.notes.length === 0 && everHadNotesRef.current) {
      recoveryLog('skipped instant notes wipe');
      delete safe.notes;
    }
    if (safe.quizzes && safe.quizzes.length === 0 && everHadQuizzesRef.current) {
      recoveryLog('skipped instant quizzes wipe');
      delete safe.quizzes;
    }
    if (safe.quizSets && countUserQuizSets(safe.quizSets) === 0 && everHadSetsRef.current) {
      recoveryLog('skipped instant quizSets wipe');
      delete safe.quizSets;
    }
    if (!safe.notes && !safe.quizzes && !safe.quizSets && !safe.quizFolders) return;
    if (safe.notes?.length) everHadNotesRef.current = true;
    if (safe.quizzes?.length) everHadQuizzesRef.current = true;
    if (safe.quizSets && countUserQuizSets(safe.quizSets) > 0) everHadSetsRef.current = true;
    const syncedAt = Date.now();
    // Track this write in savesInFlight so a hasty refresh right after clicking
    // Save (e.g. adding a quiz question) is caught by the beforeunload guard —
    // this is the hot path for every quiz/note instant save.
    savesInFlight.current += 1;
    try {
      // Skip forceRefresh: the SDK's cached token is normally valid and this call
      // is on the critical path between a user's click and a page refresh. Forcing
      // a network round-trip here just to fetch a token widens the window during
      // which a quick reload can cancel the write before it reaches Firebase.
      await getRtdbAuthToken(false);
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
    } catch (err) {
      // This is the hot path for every quiz/note instant save. Swallowing the
      // failure used to leave the UI claiming "saved" while Firebase never got
      // the write (oversized payload, expired auth, offline) — the item then
      // vanished on the next reload with no hint why.
      console.error('[cloud-save] instant data save failed', err);
      saveFailedRef.current = true;
      setCloudStatus('error');
    } finally {
      savesInFlight.current = Math.max(0, savesInFlight.current - 1);
    }
  };

  const scheduleInstantDataCloudSave = (patch: {
    notes?: Note[];
    quizzes?: QuizItem[];
    quizSets?: QuizSet[];
    quizFolders?: QuizFolder[];
  }) => {
    if (!userRef.current || !loadedRef.current || isApplyingRemoteRef.current) return;
    pendingInstantDataSaveRef.current = { ...pendingInstantDataSaveRef.current, ...patch };
    if (instantDataSaveQueuedRef.current) return;
    instantDataSaveQueuedRef.current = true;
    queueMicrotask(() => {
      instantDataSaveQueuedRef.current = false;
      const nextPatch = pendingInstantDataSaveRef.current;
      pendingInstantDataSaveRef.current = null;
      if (nextPatch) void runInstantDataCloudSave(nextPatch);
    });
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
      permanentlyDeletedIds: permDeletedRef.current,
      tokenUsage: tokenUsageRef.current,
      cloudSyncAt: Date.now(),
    };
    if (nextNotes.length > 0 || !everHadNotesRef.current) body.notes = nextNotes;
    else recoveryLog('skipped wiping notes with empty local array');
    if (qList.length > 0 || !everHadQuizzesRef.current) body.quizzes = qList;
    else recoveryLog('skipped wiping quizzes with empty local array');
    if (chatList.length > 0) body.chats = chatList;
    if (countUserQuizSets(qsList) > 0 || !everHadSetsRef.current) body.quizSets = qsList;
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
    const tombstones = permDeletedRef.current;
    const remoteNotes = firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>);
    const remoteQuizzes = firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>);
    const remoteChats = firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>)
      .map((c) => ({ ...c, messages: c.messages ?? [] }));
    const remoteSets = firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>)
      .map((set) => ({ ...set, items: set.items ?? [] }));
    const remoteFolders = firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
    const remoteDrafts = parseCloudDrafts(cloud).filter((draft) => !pendingDeletedDraftIdsRef.current.has(draft.id));
    lastCloudDraftIdsRef.current = new Set(parseCloudDrafts(cloud).map((d) => d.id));

    const mergedNotes = filterResurrectedTrash(mergeNotesForSync(notesRef.current, remoteNotes, tombstones), notesRef.current);
    const mergedQuizzes = filterResurrectedTrash(mergeQuizzesForSync(quizzesRef.current, remoteQuizzes, tombstones), quizzesRef.current);
    const mergedChats = mergeChatsForSync(chatsRef.current, remoteChats);
    const mergedSets = filterResurrectedTrash(
      mergeQuizSetsForSync(quizSetsRef.current, remoteSets, tombstones),
      quizSetsRef.current,
    );
    const mergedFolders = filterResurrectedTrash(
      mergeFoldersForSync(quizFoldersRef.current, remoteFolders, tombstones),
      quizFoldersRef.current,
    );
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
    if (JSON.stringify(mergedNotes) !== JSON.stringify(notesRef.current)) {
      setNotes(mergedNotes);
      safeSetItem('malacadhati', JSON.stringify(mergedNotes));
      changed = true;
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
    if (JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)) {
      setQuizSets(normalizedSets);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
      changed = true;
    }
    if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
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
    if (!u || !loadedRef.current || isApplyingRemoteRef.current) return;
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
      const r = await rtdbFetch(`/users/${u.uid}`);
      if (!r.ok) return;
      const cloud = (await r.json()) as Record<string, unknown> | null;
      if (!cloud) return;
      isApplyingRemoteRef.current = true;
      applyRemoteSnapshot(cloud);
    } catch {
      /* ignore pull errors */
    } finally {
      isApplyingRemoteRef.current = false;
    }
  };

  const scheduleRemotePull = (force = true) => {
    if (pendingRemotePullRef.current) return;
    pendingRemotePullRef.current = true;
    window.setTimeout(() => {
      pendingRemotePullRef.current = false;
      void pullFromCloud(force);
    }, force ? 0 : 400);
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
    if (!user || !loaded) return;
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
    const bindRealtime = <T,>(path: string, key: 'notes' | 'quizzes' | 'quizSets' | 'quizFolders', map?: (val: unknown) => T) =>
      onValue(dbRef(database, `users/${uid}/${path}`), (snap) => {
        const val = snap.val();
        if (val == null) return;
        applyRemoteTrashData({ [key]: map ? map(val) : val });
      });
    const unsubNotes = bindRealtime('notes', 'notes');
    const unsubQuizzes = bindRealtime('quizzes', 'quizzes');
    const unsubSets = bindRealtime('quizSets', 'quizSets', (val) =>
      firebaseToArray<QuizSet>(val as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] })));
    const unsubFolders = bindRealtime('quizFolders', 'quizFolders');
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullFromCloud(true);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    // A user who clicks Save and immediately hits refresh (Cmd+R) can cancel the
    // in-flight cloud write before it reaches Firebase — the item was already
    // applied to local React state so it looked saved, but nothing durable ever
    // received it. Warn on unload while a save is still pending so the browser's
    // native confirmation gives the write a chance to finish (and lets the user
    // simply not leave).
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (savesInFlight.current <= 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pagehide', flushPersist);
    window.addEventListener('beforeunload', onBeforeUnload);
    pullTimer.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pullFromCloud(true);
    }, 60_000);
    return () => {
      unsubPermDeleted();
      unsubNotes();
      unsubQuizzes();
      unsubSets();
      unsubFolders();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pagehide', flushPersist);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (pullTimer.current) clearInterval(pullTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, loaded]);

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
      void pullDraftsFromCloud(true);
      if (loadedRef.current) scheduleRemotePull(true);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, draftsReady]);

  const mutateNotes = (fn: (prev: Note[]) => Note[], instantCloud = false) => {
    setNotes((prev) => {
      const next = fn(prev);
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
    setNotes((prevNotes) => {
      const nextNotes = [newNote, ...prevNotes];
      setDrafts((prevDrafts) => {
        pendingLocalDraftIdsRef.current.delete(id);
        pendingDeletedDraftIdsRef.current.add(id);
        writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
        const nextDrafts = prevDrafts.filter((d) => d.id !== id);
        draftsRef.current = nextDrafts;
        safeSetItem('malacadhati_drafts', JSON.stringify(nextDrafts));
        persist({ notes: nextNotes, drafts: nextDrafts }, true);
        void runDraftDeleteCloudSave(id);
        return nextDrafts;
      });
      return nextNotes;
    });
  };

  const noteMetaChanged = (patch: Partial<Note>) =>
    'read' in patch || 'archived' in patch || 'fav' in patch || 'trashed' in patch;

  const updateNote = (id: number, patch: Partial<Note>) => {
    const instant = noteMetaChanged(patch);
    mutateNotes((prev) => prev.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      if (instant && !patch.savedAt) {
        return { ...next, savedAt: new Date().toISOString() };
      }
      return next;
    }), instant);
  };

  const addQuiz = (item: Omit<QuizItem, 'id'>): number => {
    const newId = Date.now();
    const now = new Date().toISOString();
    const next = [...quizzesRef.current, { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now }];
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
    let item: QuizItem | undefined;
    if (fromSetId) {
      item = quizSetsRef.current.find((set) => set.id === fromSetId)?.items.find((q) => q.id === id);
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

    // Soft-delete inside the set (keep trashed tombstone) so inbound union-merge
    // cannot resurrect a live remote copy of the same id.
    let nextSets = quizSetsRef.current;
    if (fromSetId) {
      nextSets = nextSets.map((set) => (
        set.id === fromSetId
          ? {
              ...set,
              updatedAt: trashAt,
              items: set.items.some((q) => q.id === id)
                ? set.items.map((q) => (q.id === id ? trashedItem : q))
                : [...set.items, trashedItem],
            }
          : set
      ));
    }
    nextSets = nextSets.map((set) => (
      set.id === FAVORITES_SET_ID
        ? { ...set, items: set.items.filter((q) => q.favOf !== id && q.id !== id) }
        : set
    ));

    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
    persistSets(nextSets, true, true);
    scheduleInstantDataCloudSave({ quizzes: nextQuizzes, quizSets: nextSets });
  };

  const restoreQuiz = (id: number) => {
    const restoredAt = new Date().toISOString();
    const nextQuizzes = quizzesRef.current.map((q) => (
      q.id === id ? { ...q, trashed: false, deletedAt: undefined, updatedAt: restoredAt } : q
    ));
    let setsChanged = false;
    const nextSets = quizSetsRef.current.map((set) => {
      if (!set.items.some((q) => q.id === id && q.trashed)) return set;
      setsChanged = true;
      return {
        ...set,
        updatedAt: restoredAt,
        items: set.items.map((q) => (
          q.id === id ? { ...q, trashed: false, deletedAt: undefined, updatedAt: restoredAt } : q
        )),
      };
    });
    quizzesRef.current = nextQuizzes;
    setQuizzes(nextQuizzes);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    if (setsChanged) {
      quizSetsRef.current = nextSets;
      setQuizSets(nextSets);
      safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
      persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
      persistSets(nextSets, true, true);
      scheduleInstantDataCloudSave({ quizzes: nextQuizzes, quizSets: nextSets });
    } else {
      persist({ quizzes: nextQuizzes }, true);
      scheduleInstantDataCloudSave({ quizzes: nextQuizzes });
    }
  };

  const permDeleteQuiz = (id: number) => {
    recordPermDeleted({ quizzes: [id] });
    const nextQuizzes = quizzesRef.current.filter((q) => q.id !== id);
    const nextSets = stripPermDeletedQuizSets(
      quizSetsRef.current.map((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
      permDeletedRef.current,
    );
    quizzesRef.current = nextQuizzes;
    quizSetsRef.current = nextSets;
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    safeSetItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ quizzes: nextQuizzes, quizSets: nextSets }, true);
    void pushPermDeletedCloud({ quizzes: nextQuizzes, quizSets: nextSets });
  };

  const updateQuiz = (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud = false) => {
    const existing = quizzesRef.current.find((q) => q.id === id);
    if (!existing || !quizPatchChangesContent(existing, patch)) return;
    const next = quizzesRef.current.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q));
    quizzesRef.current = next;
    setQuizzes(next);
    safeSetItem('malacadhati_quiz', JSON.stringify(next));
    persist({ quizzes: next }, forceCloud);
    if (forceCloud) scheduleInstantDataCloudSave({ quizzes: next });
  };

  const addQuizSet = (name: string): QuizSet => {
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value));
    const newSet: QuizSet = { id: Date.now().toString(), name, items: [], createdAt: nowStr(), color, colorInitialized: true };
    setQuizSets((prev) => {
      const next = [...prev, newSet];
      persistSets(next);
      return next;
    });
    return newSet;
  };

  const deleteQuizSet = (id: string) => {
    if (id === FAVORITES_SET_ID) return;
    const trashAt = new Date().toISOString();
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, trashed: true, deletedAt: nowStr(), updatedAt: trashAt } : s);
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
      return next;
    });
  };

  const restoreQuizSet = (id: string) => {
    setQuizSets((prev) => {
      const set = prev.find((item) => item.id === id);
      if (!set) return prev;
      const next = [...prev.filter((item) => item.id !== id), {
        ...set,
        trashed: false,
        deletedAt: undefined,
        folderId: RESTORED_FOLDER_ID,
        updatedAt: new Date().toISOString(),
      }];
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
      return next;
    });
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
    void pushPermDeletedCloud({ quizSets: nextSets });
  };

  const reorderQuizSets = (dragId: string, targetId: string) => {
    setQuizSets((prev) => {
      const next = [...prev];
      const from = next.findIndex((s) => s.id === dragId);
      const to = next.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      if (next[from].system || next[to].system) return prev;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      persistSets(next);
      return next;
    });
  };

  const renameQuizSet = (id: string, name: string) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name } : s));
      persistSets(next);
      return next;
    });
  };

  const setQuizSetColor = (id: string, color: string) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, color, colorInitialized: true } : s));
      persistSets(next);
      return next;
    });
  };

  const setQuizSetFolder = (id: string, folderId: string | undefined) => {
    if (id === FAVORITES_SET_ID) return;
    setQuizSets((prev) => {
      const set = prev.find((s) => s.id === id);
      if (set?.system) return prev;
      if (folderId && quizFolders.find((f) => f.id === folderId)?.system) return prev;
      if (!set || set.folderId === folderId) return prev;
      const next = [...prev.filter((s) => s.id !== id), { ...set, folderId }];
      persistSets(next);
      return next;
    });
  };

  const addQuizFolder = (name: string): QuizFolder => {
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value));
    const folder: QuizFolder = { id: 'f' + Date.now().toString(), name, createdAt: nowStr(), color, colorInitialized: true };
    setQuizFolders((prev) => {
      const next = [...prev, folder];
      persistFolders(next);
      return next;
    });
    return folder;
  };

  const renameQuizFolder = (id: string, name: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name: trimmed, updatedAt: nowStr() } : f));
      persistFolders(next, true);
      return next;
    });
  };

  const setQuizFolderColor = (id: string, color: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, color, colorInitialized: true } : f));
      persistFolders(next);
      return next;
    });
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
      const [item] = normalFolders.splice(from, 1);
      normalFolders.splice(to, 0, item);
      const next = [...systemFolders, ...normalFolders];
      persistFolders(next);
      return next;
    });
  };

  const deleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const trashAt = new Date().toISOString();
    const nextFolders = quizFoldersRef.current.map((f) => (
      f.id === id ? { ...f, trashed: true, deletedAt: nowStr(), updatedAt: trashAt } : f
    ));
    const nextSets = quizSetsRef.current.map((s) => (
      s.folderId === id ? { ...s, folderId: undefined } : s
    ));
    quizFoldersRef.current = nextFolders;
    quizSetsRef.current = nextSets;
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    safeSetItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ quizFolders: nextFolders, quizSets: nextSets }, true);
    scheduleInstantDataCloudSave({ quizFolders: nextFolders, quizSets: nextSets });
  };

  const restoreQuizFolder = (id: string) => {
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
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    everHadSetsRef.current = true;
    persistSets(next, true, true);
    scheduleInstantDataCloudSave({ quizSets: next });
    return newId;
  };

  const removeItemFromSet = (setId: string, itemId: number) => {
    const next = quizSetsRef.current.map((s) => (
      s.id === setId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s
    ));
    quizSetsRef.current = next;
    setQuizSets(next);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    persistSets(next, true, true);
    scheduleInstantDataCloudSave({ quizSets: next });
  };

  const updateItemInSet = (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>, forceCloud = false) => {
    const set = quizSetsRef.current.find((s) => s.id === setId);
    const existing = set?.items.find((i) => i.id === itemId);
    if (!existing || !quizPatchChangesContent(existing, patch)) return;
    const next = quizSetsRef.current.map((s) => (
      s.id === setId
        ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i)) }
        : s
    ));
    quizSetsRef.current = next;
    setQuizSets(next);
    safeSetItem('malacadhati_quiz_sets', JSON.stringify(next));
    persistSets(next, forceCloud, forceCloud);
    if (forceCloud) scheduleInstantDataCloudSave({ quizSets: next });
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
  const replaceEditorImageUrl = (fromUrl: string, toUrl: string) => {
    if (!fromUrl || !toUrl || fromUrl === toUrl) return;
    const swap = (s: string) => (s.includes(fromUrl) ? s.split(fromUrl).join(toUrl) : s);
    const now = new Date().toISOString();

    if (notesRef.current.some((n) => n.html.includes(fromUrl))) {
      const next = notesRef.current.map((n) => (
        n.html.includes(fromUrl) ? { ...n, html: swap(n.html), savedAt: now } : n
      ));
      notesRef.current = next;
      setNotes(next);
      safeSetItem('malacadhati', JSON.stringify(next));
      persist({ notes: next }, true);
      scheduleInstantDataCloudSave({ notes: next });
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
      persist({ quizzes: next }, true);
      scheduleInstantDataCloudSave({ quizzes: next });
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
      persistSets(next, true, true);
      scheduleInstantDataCloudSave({ quizSets: next });
    }
  };

  useEffect(() => onEditorImageSwap(replaceEditorImageUrl), []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Legacy inline-image migration ─────────────────────────────────────────
  // Old notes/questions still embed images as base64, which keeps localStorage
  // near its quota permanently — the reason fresh saves' local writes can fail
  // silently. Once per session, quietly upload those to Storage and swap the
  // content to short URLs, a few images at a time.
  const INLINE_IMAGE_MIGRATE_MIN_CHARS = 65_000;
  const INLINE_IMAGE_MIGRATE_MAX_PER_SESSION = 20;

  const collectInlineImageUrls = (): string[] => {
    const found = new Set<string>();
    const scan = (html?: string) => {
      if (!html) return;
      let idx = 0;
      for (;;) {
        const start = html.indexOf('src="data:image/', idx);
        if (start === -1) break;
        const urlStart = start + 5;
        const end = html.indexOf('"', urlStart);
        if (end === -1) break;
        const url = html.slice(urlStart, end);
        if (url.length > INLINE_IMAGE_MIGRATE_MIN_CHARS) found.add(url);
        idx = end + 1;
      }
    };
    const scanQuizItem = (q: QuizItem) => {
      scan(q.question);
      scan(q.answer);
      scan(q.explanation);
      (q.options ?? []).forEach((o) => scan(o));
    };
    notesRef.current.forEach((n) => scan(n.html));
    quizzesRef.current.forEach(scanQuizItem);
    quizSetsRef.current.forEach((s) => s.items.forEach(scanQuizItem));
    return [...found];
  };

  const migrateInlineImagesToStorage = async () => {
    const urls = collectInlineImageUrls().slice(0, INLINE_IMAGE_MIGRATE_MAX_PER_SESSION);
    for (const dataUrl of urls) {
      if (!userRef.current) return;
      try {
        const remoteUrl = await uploadEditorImage(dataUrl);
        if (remoteUrl) replaceEditorImageUrl(dataUrl, remoteUrl);
      } catch {
        /* keep the base64 copy — retried next session */
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  };

  const inlineImageMigrationRanRef = useRef(false);
  useEffect(() => {
    if (!user || !loaded || inlineImageMigrationRanRef.current) return;
    inlineImageMigrationRanRef.current = true;
    // Wait for the initial load/sync to settle before generating extra writes.
    const timer = setTimeout(() => { void migrateInlineImagesToStorage(); }, 15_000);
    return () => clearTimeout(timer);
  }, [user?.uid, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveItemInSet = (setId: string, itemId: number, direction: 'up' | 'down') => {
    setQuizSets((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const idx = items.findIndex((i) => i.id === itemId);
        if (idx < 0) return s;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= items.length) return s;
        [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
        changed = true;
        return { ...s, items };
      });
      if (!changed) return prev;
      persistSets(next);
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
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      persist({ quizzes: next });
      return next;
    });
  };

  const reorderItemInSet = (setId: string, dragId: number, targetId: number) => {
    setQuizSets((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const from = items.findIndex((i) => i.id === dragId);
        const to = items.findIndex((i) => i.id === targetId);
        if (from < 0 || to < 0 || from === to) return s;
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        changed = true;
        return { ...s, items };
      });
      if (!changed) return prev;
      persistSets(next);
      return next;
    });
  };

  const reorderQuiz = (dragId: number, targetId: number) => {
    setQuizzes((prev) => {
      const next = [...prev];
      const from = next.findIndex((q) => q.id === dragId);
      const to = next.findIndex((q) => q.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      persist({ quizzes: next });
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
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        return { ...s, items: orderItemsByIds(s.items, itemIds) };
      });
      persistSets(next);
      return next;
    });
  };

  const setQuizzesOrder = (itemIds: number[]) => {
    setQuizzes((prev) => {
      const next = orderItemsByIds(prev, itemIds);
      persist({ quizzes: next });
      return next;
    });
  };

  const toggleRead = (id: number) => updateNote(id, { read: true });
  const toggleUnread = (id: number) => updateNote(id, { read: false });
  const toggleFav = (id: number) =>
    mutateNotes((prev) => prev.map((n) => (
      n.id === id ? { ...n, fav: !n.fav, savedAt: new Date().toISOString() } : n
    )), true);
  const archive = (id: number) => updateNote(id, { archived: true });
  const unarchive = (id: number) => updateNote(id, { archived: false, read: false });
  const trash = (id: number) => {
    const savedAt = new Date().toISOString();
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, trashed: true, deletedAt: nowStr(), savedAt } : n));
      persist({ notes: next }, true);
      scheduleInstantDataCloudSave({ notes: next });
      return next;
    });
  };
  const restore = (id: number) => {
    const savedAt = new Date().toISOString();
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, trashed: false, deletedAt: undefined, savedAt } : n));
      persist({ notes: next }, true);
      scheduleInstantDataCloudSave({ notes: next });
      return next;
    });
  };
  const permDelete = (id: number) => {
    recordPermDeleted({ notes: [id] });
    const nextNotes = notesRef.current.filter((n) => n.id !== id);
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    persist({ notes: nextNotes }, true);
    void pushPermDeletedCloud({ notes: nextNotes });
  };
  const emptyTrash = () => {
    const trashedNotes = notesRef.current.filter((n) => n.trashed);
    const trashedQuizzes = quizzesRef.current.filter((q) => q.trashed);
    const trashedSets = quizSetsRef.current.filter((set) => set.trashed);
    const trashedFolders = quizFoldersRef.current.filter((folder) => folder.trashed);
    const quizIdsFromTrashedSets = trashedSets.flatMap((set) => (set.items ?? []).map((item) => item.id));
    recordPermDeleted({
      notes: trashedNotes.map((n) => n.id),
      quizzes: [...trashedQuizzes.map((q) => q.id), ...quizIdsFromTrashedSets],
      quizSets: trashedSets.map((set) => set.id),
      quizFolders: trashedFolders.map((folder) => folder.id),
    });
    const deadQuizzes = new Set(permDeletedRef.current.quizzes);
    const nextNotes = notesRef.current.filter((n) => !n.trashed);
    const nextQuizzes = quizzesRef.current.filter((q) => !q.trashed);
    const removedFolderIds = new Set(trashedFolders.map((folder) => folder.id));
    const nextSets = quizSetsRef.current
      .filter((set) => !set.trashed)
      .map((set) => ({
        ...set,
        folderId: set.folderId && removedFolderIds.has(set.folderId) ? undefined : set.folderId,
        items: (set.items ?? []).filter((item) => !item.trashed && !deadQuizzes.has(item.id)),
      }));
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
    safeSetItem(TRASH_EMPTIED_AT_KEY, String(Date.now()));

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
    recordPermDeleted({ notes: ids });
    const idSet = new Set(ids);
    const nextNotes = notesRef.current.filter((n) => !idSet.has(n.id));
    notesRef.current = nextNotes;
    setNotes(nextNotes);
    safeSetItem('malacadhati', JSON.stringify(nextNotes));
    persist({ notes: nextNotes }, true);
    void pushPermDeletedCloud({ notes: nextNotes });
  };

  return (
    <NotesContext.Provider
      value={{
        notes,
        drafts,
        quizzes: quizzes.filter((q) => !q.trashed),
        trashedQuizzes: quizzes.filter((q) => q.trashed),
        quizSets,
        quizFolders,
        cloudStatus,
        cloudSyncedAt,
        loaded,
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
