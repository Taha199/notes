import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref as dbRef, update } from 'firebase/database';
import type { Note, QuizItem, QuizSet, QuizFolder, ChatConversation } from '../types';
import { database, FB_DB_URL } from '../lib/firebase';
import { buildFullBackupPayload, shouldRunHourlyFolderBackup, writeBackupToFolder } from '../lib/externalBackup';
import { setTokenSink } from '../lib/gemini';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';

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
  return url;
}

function noteSyncKey(note: Note) {
  return `${note.title}\0${note.html}\0${note.read}\0${note.fav}\0${note.archived}\0${note.trashed}`;
}

function quizSyncTime(item: QuizItem) {
  return Date.parse(item.updatedAt || item.createdAt || '') || 0;
}

function pickNewerQuizItem(a: QuizItem, b: QuizItem) {
  return quizSyncTime(b) >= quizSyncTime(a) ? b : a;
}

function noteContentLength(note: Note) {
  return (note.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length + (note.title || '').trim().length;
}

function pickBetterNote(local: Note, remote: Note) {
  if (noteSyncKey(local) === noteSyncKey(remote)) return local;
  const localLen = noteContentLength(local);
  const remoteLen = noteContentLength(remote);
  if (remoteLen !== localLen) return remoteLen > localLen ? remote : local;
  if (local.trashed && !remote.trashed) return remote;
  if (!local.trashed && remote.trashed) return local;
  return local;
}

function draftContentLength(d: Draft) {
  return (d.html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length + (d.title || '').trim().length;
}

function pickBetterDraft(local: Draft, remote: Draft) {
  const localAt = local.updatedAt ?? 0;
  const remoteAt = remote.updatedAt ?? 0;
  if (localAt !== remoteAt) return remoteAt > localAt ? remote : local;
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
    if (cloudHasMembership && cloudDraftIds.length > 0 && !cloudDraftIds.includes(item.id)) {
      // Removed on another device — keep only if edited locally after last cloud sync.
      if (!item.updatedAt || item.updatedAt <= cloudSyncAt) continue;
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

function mergeNotesForSync(local: Note[], remote: Note[]) {
  const map = new Map<number, Note>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickBetterNote(existing, item) : item);
  }
  return [...map.values()];
}

function mergeQuizzesForSync(local: QuizItem[], remote: QuizItem[]) {
  const map = new Map<number, QuizItem>();
  for (const item of local) map.set(item.id, item);
  for (const item of remote) {
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickNewerQuizItem(existing, item) : item);
  }
  return [...map.values()];
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

function mergeQuizSetsForSync(local: QuizSet[], remote: QuizSet[]) {
  const map = new Map<string, QuizSet>();
  for (const set of local) map.set(set.id, set);
  for (const set of remote) {
    const existing = map.get(set.id);
    if (!existing) map.set(set.id, set);
    else map.set(set.id, { ...set, items: mergeQuizzesForSync(existing.items ?? [], set.items ?? []) });
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
  deleteQuiz: (id: number) => void;
  restoreQuiz: (id: number) => void;
  permDeleteQuiz: (id: number) => void;
  updateQuiz: (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => void;
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
  updateItemInSet: (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => void;
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
  localStorage.setItem(LAST_UID_KEY, uid);
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
  localStorage.setItem(DELETED_DRAFT_IDS_KEY, JSON.stringify([...ids]));
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
  return drafts.some((d) => d.title.trim().length > 0 || d.html.replace(/<[^>]*>/g, '').trim().length > 0);
}

function maxDraftCounter(drafts: Draft[]) {
  return drafts.reduce((max, d) => {
    const n = Number.parseInt(d.id.replace(/^d/, ''), 10);
    return Number.isFinite(n) ? Math.max(max, n) : max;
  }, 0);
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

async function fetchCloudDraftBundle(uid: string, getToken: () => Promise<string | null>) {
  const base = `${FB_DB_URL}/users/${uid}`;
  const get = async (field: string) => {
    const r = await fetch(await withAuth(`${base}/${field}.json`, getToken));
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
    const res = await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory.json?shallow=true`);
    if (!res.ok) return null;
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    if (!keys.length) return null;
    const folders = firebaseToArray<QuizFolder>(
      await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory/${keys[0]}.json`).then((r) => r.json()),
    );
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
    localStorage.setItem(lastDataHistoryKey(uid), String(ts));
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
    const res = await fetch(`${FB_DB_URL}/users/${uid}/${path}.json?shallow=true`);
    const keys = Object.keys((await res.json()) || {}).sort();
    const overflow = keys.length - max;
    for (let i = 0; i < overflow; i += 1) {
      await fetch(`${FB_DB_URL}/users/${uid}/${path}/${keys[i]}.json`, { method: 'DELETE' });
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
  await fetch(`${FB_DB_URL}/users/${uid}/dataHistory/${key}.json`, {
    method: 'PUT',
    body: JSON.stringify({ ...snapshot, savedAt: new Date(now).toISOString() }),
    headers: { 'Content-Type': 'application/json' },
  });
  await trimHistoryKeys(uid, 'dataHistory', MAX_DATA_HISTORY);
}

async function fetchDataHistorySnapshot(uid: string, key: string): Promise<DataHistorySnapshot | null> {
  try {
    const snap = await fetch(`${FB_DB_URL}/users/${uid}/dataHistory/${key}.json`).then((r) => r.json());
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
    const res = await fetch(`${FB_DB_URL}/users/${uid}/dataHistory.json?shallow=true`);
    if (!res.ok) return { key: null, snapshot: null };
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    let bestKey: string | null = null;
    let bestSnapshot: DataHistorySnapshot | null = null;
    let bestScore = 0;
    for (const key of keys) {
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
    const res = await fetch(`${FB_DB_URL}/users/${uid}/dataHistory.json?shallow=true`);
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
    const res = await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory.json?shallow=true`);
    if (!res.ok) return [];
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    const lists = await Promise.all(keys.map(async (key) => firebaseToArray<QuizFolder>(
      await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory/${key}.json`).then((r) => r.json()),
    )));
    return mergeById(...lists);
  } catch {
    return [];
  }
}

async function readDedicatedQuizData(uid: string) {
  let folders: QuizFolder[] = [];
  let sets: QuizSet[] = [];
  try {
    folders = firebaseToArray<QuizFolder>(await fetch(`${FB_DB_URL}/users/${uid}/quizFolders.json`).then((r) => r.json()));
  } catch { /* ignore */ }
  try {
    sets = firebaseToArray<QuizSet>(await fetch(`${FB_DB_URL}/users/${uid}/quizSets.json`).then((r) => r.json())).map((set) => ({ ...set, items: set.items ?? [] }));
  } catch { /* ignore */ }
  return { folders, sets };
}

async function fetchAllDataHistorySnapshots(uid: string): Promise<DataHistorySnapshot[]> {
  try {
    const res = await fetch(`${FB_DB_URL}/users/${uid}/dataHistory.json?shallow=true`);
    if (!res.ok) return [];
    const keys = Object.keys((await res.json()) || {}).sort().reverse();
    const snapshots = await Promise.all(keys.map((key) => fetchDataHistorySnapshot(uid, key)));
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
  if (sets.length === 1 && sets[0].name.trim()) return sets[0].name.trim();
  return 'Återställd mapp';
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
      name: inferRecoveredFolderName(setsInFolder),
      createdAt: new Date().toISOString(),
      color: pickSpacedColor(usedColors),
      colorInitialized: true,
    });
    known.set(folderId, recovered[recovered.length - 1]);
  }
  return recovered;
}

function autoRestoreReferencedTrashedFolders(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const referenced = new Set(sets.filter((set) => set.folderId && !set.trashed).map((set) => set.folderId!));
  return folders.map((folder) => {
    if (folder.trashed && !folder.system && referenced.has(folder.id)) {
      return { ...folder, trashed: false, deletedAt: undefined };
    }
    return folder;
  });
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
  const lastDraftEditAt = useRef(0);
  const lastCloudDraftIdsRef = useRef<Set<string>>(new Set());
  const pendingDraftCloudSaveRef = useRef(false);
  const draftCloudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftLocalEditAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const lastPushedDraftHtmlRef = useRef<Map<string, string>>(new Map());
  const draftSaveInFlightRef = useRef<Set<string>>(new Set());
  const draftSavePendingAgainRef = useRef<Set<string>>(new Set());
  const pullTimer = useRef<ReturnType<typeof setInterval> | null>(null);
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
      const seed = [{ id: 'd1', title: '', html: '', updatedAt: Date.now() }];
      setDrafts(seed);
      draftsRef.current = seed;
      draftCounter.current = 1;
      localStorage.setItem('malacadhati_drafts', JSON.stringify(seed));
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
          localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(bundle.cloudSyncAt));
          lastAppliedRemoteSyncAt.current = bundle.cloudSyncAt;
        }
        const cloudDrafts = parseCloudDrafts(bundle);
        lastCloudDraftIdsRef.current = new Set(cloudDrafts.map((d) => d.id));
        const merged = mergeDraftsForPull(
          draftsRef.current,
          cloudDrafts.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id)),
          bundle,
          pendingDeletedDraftIdsRef.current,
        );
        if (JSON.stringify(merged) !== JSON.stringify(draftsRef.current)) {
          setDrafts(merged);
          draftsRef.current = merged;
          draftCounter.current = (bundle.draftId as number | undefined) || maxDraftCounter(merged) || merged.length;
          localStorage.setItem('malacadhati_drafts', JSON.stringify(merged));
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
        const r = await fetch(await withAuth(`${FB_DB_URL}/users/${user.uid}.json`, () => user.getIdToken()));
        if (!r.ok) throw new Error('cloud-fetch-failed');
        const cloud = (await r.json()) as Record<string, unknown> | null;
        if (cancelled) return;

        if (cloud?.tokenUsage) {
          setTokenUsage(cloud.tokenUsage as number);
        }

        if (typeof cloud?.cloudSyncAt === 'number' && cloud.cloudSyncAt > 0) {
          setCloudSyncedAt(cloud.cloudSyncAt);
          localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(cloud.cloudSyncAt));
          lastAppliedRemoteSyncAt.current = cloud.cloudSyncAt;
        }

        pendingDeletedDraftIdsRef.current = mergeDeletedDraftIds(pendingDeletedDraftIdsRef.current, cloud);

        const cloudNotes = cloud ? firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>) : [];
        let notes = mergeNotesForSync(local.notes, cloudNotes);
        let notesRepair = notes.length > cloudNotes.length
          || (local.notes.length > 0 && cloudNotes.length === 0)
          || (local.notes.length > 0 && notes.length > cloudNotes.length);

        const cloudQuizzes = cloud ? firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>) : [];
        let quizzes = mergeQuizzesForSync(local.quizzes, cloudQuizzes);
        let quizzesRepair = quizzes.length > cloudQuizzes.length
          || (local.quizzes.length > 0 && cloudQuizzes.length === 0);

        const cloudChatsRaw = cloud ? firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>) : [];
        let chats = mergeChatsForSync(local.chats, cloudChatsRaw).map((c) => ({
          ...c,
          messages: c.messages ?? [],
        }));
        let chatsRepair = chats.length > cloudChatsRaw.length
          || (local.chats.length > 0 && cloudChatsRaw.length === 0);

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
            notes = mergeNotesForSync(notes, historySnapshot.notes);
            notesRepair = true;
            historyRepair = true;
            recoveryLog('recovered notes from latest dataHistory', { count: notes.length });
          }
        }

        const historySnapshots = await fetchAllDataHistorySnapshots(user.uid);
        for (const snapshot of historySnapshots) {
          const before = notes.length;
          notes = mergeNotesForSync(notes, snapshot.notes);
          if (notes.length > before) {
            notesRepair = true;
            historyRepair = true;
            recoveryLog('restored notes from dataHistory snapshot', { before, after: notes.length, savedAt: snapshot.savedAt });
          }
          const quizzesBefore = quizzes.length;
          quizzes = mergeQuizzesForSync(quizzes, snapshot.quizzes);
          if (quizzes.length > quizzesBefore) quizzesRepair = true;
        }

        setNotes(notes);
        localStorage.setItem('malacadhati', JSON.stringify(notes));

        setQuizzes(quizzes);
        localStorage.setItem('malacadhati_quiz', JSON.stringify(quizzes));

        setChats(chats);
        localStorage.setItem('malacadhati_chats', JSON.stringify(chats));

        let dedicatedFolders: QuizFolder[] = [];
        let dedicatedSets: QuizSet[] = [];
        try {
          const folderRes = await fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`);
          if (folderRes.ok) dedicatedFolders = firebaseToArray<QuizFolder>(await folderRes.json());
        } catch { /* ignore */ }
        try {
          const setRes = await fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`);
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

        let rawFolders = mergeById(cloudFolders, dedicatedFolders, local.folders);
        let rawSets: QuizSet[] = mergeById(cloudSets, dedicatedSets, local.sets);
        let repairQuizStructure = false;
        if (countUserQuizFolders(rawFolders) === 0 && local.folders.some((folder) => !folder.system)) {
          rawFolders = mergeById(rawFolders, local.folders);
          repairQuizStructure = true;
        }
        if (countUserQuizSets(rawSets) === 0 && local.sets.some((set) => !set.system)) {
          rawSets = mergeById(rawSets, local.sets);
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
            localStorage.setItem('malacadhati_quiz', JSON.stringify(quizzes));
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
        localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
        setQuizFolders(normalizedFolders);
        localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));

        const needsRepair = notesRepair || quizzesRepair || chatsRepair || repairQuizStructure || historyRepair
          || (cloudSetsEmpty && dedicatedSetsEmpty && local.sets.length > 0)
          || (cloudFoldersEmpty && dedicatedFoldersEmpty && local.folders.length > 0);
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
        if (needsRepair) {
          recoveryLog('repairing cloud from local/history');
          void fetch(`${FB_DB_URL}/users/${user.uid}.json`, {
            method: 'PATCH',
            body: JSON.stringify({
              notes,
              quizzes,
              chats,
              quizSets: normalizedSets,
              quizFolders: normalizedFolders,
            }),
            headers: { 'Content-Type': 'application/json' },
          });
          if (repairQuizStructure || (cloudSetsEmpty && dedicatedSetsEmpty && local.sets.length > 0)) {
            void fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`, {
              method: 'PUT',
              body: JSON.stringify(normalizedSets),
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (repairQuizStructure || (cloudFoldersEmpty && dedicatedFoldersEmpty && local.folders.length > 0)) {
            void fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`, {
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
        const finalDrafts = mergeDraftsForPull(draftsRef.current, resolvedDrafts, cloud, pendingDeletedDraftIdsRef.current);
        const cloudDraftContentLen = cloudDrafts.reduce((sum, d) => sum + draftContentLength(d), 0);
        const resolvedDraftContentLen = finalDrafts.reduce((sum, d) => sum + draftContentLength(d), 0);
        const draftsRepair = resolvedDraftContentLen > cloudDraftContentLen
          || finalDrafts.length > cloudDrafts.length
          || (bestLocalDrafts.length > 0 && hasDraftContent(finalDrafts) && !hasDraftContent(cloudDrafts));
        setDrafts(finalDrafts);
        draftsRef.current = finalDrafts;
        draftCounter.current = resolvedCounter;
        localStorage.setItem('malacadhati_drafts', JSON.stringify(finalDrafts));
        if (draftsRepair) {
          recoveryLog('repairing cloud drafts from local');
          const draftContents: Record<string, { title: string; html: string; updatedAt?: number }> = {};
          finalDrafts.forEach((d) => {
            draftContents[d.id] = { title: d.title, html: d.html, updatedAt: d.updatedAt ?? Date.now() };
          });
          for (const id of lastCloudDraftIdsRef.current) {
            if (!finalDrafts.some((d) => d.id === id)) draftContents[id] = null as unknown as { title: string; html: string; updatedAt?: number };
          }
          void fetch(`${FB_DB_URL}/users/${user.uid}.json`, {
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
          if (user) setCloudStatus('saved');
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

  const persistSets = (nextSets: QuizSet[], forceCloud = false) => {
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ quizSets: nextSets }, forceCloud);
  };

  const persistFolders = (nextFolders: QuizFolder[], forceCloud = false) => {
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist({ quizFolders: nextFolders }, forceCloud);
    if (user && loadedRef.current && (forceCloud || countUserQuizFolders(nextFolders) > 0 || countUserQuizSets(quizSets) > 0)) {
      void fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`, {
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
        localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(next));
      }
      return next;
    });
    setQuizSets((prev) => {
      const next = ensureFavoritesSet(prev);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(next));
      }
      return next;
    });
    // Run once after each account finishes loading — local only, never cloud-sync empty state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, user?.uid]);

  const saveChats = (nextChats: ChatConversation[]) => {
    setChats(nextChats);
    localStorage.setItem('malacadhati_chats', JSON.stringify(nextChats));
    persist({ chats: nextChats });
  };

  const userRef = useRef(user);
  userRef.current = user;

  const addTokens = useRef((n: number) => {
    setTokenUsage((prev) => {
      const next = prev + n;
      const u = userRef.current;
      if (u) {
        fetch(`${FB_DB_URL}/users/${u.uid}/tokenUsage.json`, {
          method: 'PUT',
          body: JSON.stringify(next),
          headers: { 'Content-Type': 'application/json' },
        });
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
    localStorage.setItem('malacadhati', JSON.stringify(notesRef.current));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(quizzesRef.current));
    localStorage.setItem('malacadhati_drafts', JSON.stringify(draftsRef.current));
  };

  const buildDraftCloudPayload = (dList: Draft[]) => {
    const draftContents: Record<string, { title: string; html: string; updatedAt?: number } | null> = {};
    dList.forEach((d) => {
      draftContents[d.id] = { title: d.title, html: d.html, updatedAt: d.updatedAt ?? Date.now() };
    });
    for (const id of pendingDeletedDraftIdsRef.current) {
      draftContents[id] = null;
    }
    for (const id of lastCloudDraftIdsRef.current) {
      if (!dList.some((d) => d.id === id) && !pendingDeletedDraftIdsRef.current.has(id)) {
        draftContents[id] = null;
      }
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
      localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(bundle.cloudSyncAt));
    }
    const cloudDrafts = parseCloudDrafts(bundle);
    lastCloudDraftIdsRef.current = new Set(cloudDrafts.map((d) => d.id));
    const merged = mergeDraftsForPull(
      draftsRef.current,
      cloudDrafts.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id)),
      bundle,
      pendingDeletedDraftIdsRef.current,
    );
    if (JSON.stringify(merged) !== JSON.stringify(draftsRef.current)) {
      setDrafts(merged);
      draftsRef.current = merged;
      draftCounter.current = (bundle.draftId as number | undefined) || maxDraftCounter(merged) || merged.length;
      localStorage.setItem('malacadhati_drafts', JSON.stringify(merged));
    }
  };

  const applySingleRemoteDraft = (id: string, remote: { title?: string; html?: string; updatedAt?: number } | null) => {
    if (!id) return;
    if (remote === null) {
      pendingDeletedDraftIdsRef.current.add(id);
      writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
      const next = draftsRef.current.filter((d) => d.id !== id);
      if (next.length === draftsRef.current.length) return;
      draftsRef.current = next;
      setDrafts(next);
      localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
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
    if (local && Date.now() - localEditAt < 800 && remoteAt <= localAt) return;

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
    localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
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
      await update(dbRef(database, `users/${u.uid}`), {
        [`draftContents/${draftId}`]: { title: draft.title, html: draft.html, updatedAt },
        drafts: draftsRef.current.map((d) => d.id),
        draftId: draftCounter.current,
        deletedDraftIds: [...pendingDeletedDraftIdsRef.current],
        cloudSyncAt: syncedAt,
      });
      saveFailedRef.current = false;
      lastLocalSaveAt.current = syncedAt;
      lastAppliedRemoteSyncAt.current = syncedAt;
      setCloudSyncedAt(syncedAt);
      localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
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
      localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
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
    const next = draftsRef.current.filter((d) => {
      if (idSet.has(d.id)) return true;
      if (pendingDeletedDraftIdsRef.current.has(d.id)) return false;
      const localEditAt = draftLocalEditAtRef.current.get(d.id) ?? 0;
      return Date.now() - localEditAt < 3000;
    });
    if (JSON.stringify(next) === JSON.stringify(draftsRef.current)) return;
    draftsRef.current = next;
    setDrafts(next);
    localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
  };

  const runDraftCloudSave = (keepalive = false) => {
    const u = userRef.current;
    if (!u || !draftsReadyRef.current || isApplyingRemoteRef.current) return;
    const dList = draftsRef.current;
    const draftPayload = buildDraftCloudPayload(dList);
    savesInFlight.current += 1;
    setCloudStatus('saving');
    savingStartedAt.current = Date.now();
    const syncedAt = Date.now();
    void withAuth(`${FB_DB_URL}/users/${u.uid}.json`, () => u.getIdToken()).then((url) =>
      fetch(url, {
        method: 'PATCH',
        body: JSON.stringify({
          ...draftPayload,
          cloudSyncAt: syncedAt,
        }),
        headers: { 'Content-Type': 'application/json' },
        keepalive,
      }),
    )
      .then((res) => {
        if (!res.ok) throw new Error('cloud-draft-save-failed');
        saveFailedRef.current = false;
        lastLocalSaveAt.current = syncedAt;
        lastAppliedRemoteSyncAt.current = syncedAt;
        setCloudSyncedAt(syncedAt);
        localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
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
    if (!forceCloud && isEmptyUserPayload(nextNotes, qList, chatList, qsList, qfList, dList)) {
      recoveryLog('skipped cloud sync — empty user payload');
      return;
    }
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
    void withAuth(`${FB_DB_URL}/users/${u.uid}.json`, () => u.getIdToken()).then((url) =>
      fetch(url, {
        method: 'PATCH',
        body: JSON.stringify({
          notes: nextNotes,
          ...draftPayload,
          quizzes: qList,
          chats: chatList,
          quizSets: qsList,
          quizFolders: qfList,
          tokenUsage: tokenUsageRef.current,
          cloudSyncAt: Date.now(),
        }),
        headers: { 'Content-Type': 'application/json' },
        keepalive,
      }),
    )
      .then((res) => {
          if (!res.ok) throw new Error('cloud-save-failed');
          saveFailedRef.current = false;
          const syncedAt = Date.now();
          lastLocalSaveAt.current = syncedAt;
          lastAppliedRemoteSyncAt.current = syncedAt;
          setCloudSyncedAt(syncedAt);
          localStorage.setItem(CLOUD_SYNCED_AT_KEY, String(syncedAt));
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
    if (loadedRef.current) runCloudSave(true, true);
    else if (draftsReadyRef.current) runDraftCloudSave(true);
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
    const remoteNotes = firebaseToArray<Note>(cloud.notes as Note[] | Record<string, Note>);
    const remoteQuizzes = firebaseToArray<QuizItem>(cloud.quizzes as QuizItem[] | Record<string, QuizItem>);
    const remoteChats = firebaseToArray<ChatConversation>(cloud.chats as ChatConversation[] | Record<string, ChatConversation>)
      .map((c) => ({ ...c, messages: c.messages ?? [] }));
    const remoteSets = firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>)
      .map((set) => ({ ...set, items: set.items ?? [] }));
    const remoteFolders = firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>);
    const remoteDrafts = parseCloudDrafts(cloud).filter((draft) => !pendingDeletedDraftIdsRef.current.has(draft.id));
    lastCloudDraftIdsRef.current = new Set(parseCloudDrafts(cloud).map((d) => d.id));

    const mergedNotes = mergeNotesForSync(notesRef.current, remoteNotes);
    const mergedQuizzes = mergeQuizzesForSync(quizzesRef.current, remoteQuizzes);
    const mergedChats = mergeChatsForSync(chatsRef.current, remoteChats);
    const mergedSets = mergeQuizSetsForSync(quizSetsRef.current, remoteSets);
    const mergedFolders = mergeById(quizFoldersRef.current, remoteFolders);
    const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
    const mergedDrafts = recentDraftEdit && hasDraftContent(draftsRef.current)
      ? draftsRef.current.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id))
      : mergeDraftsForPull(draftsRef.current, remoteDrafts, cloud, pendingDeletedDraftIdsRef.current);

    const normalizedFolders = finalizeQuizFolders(mergedFolders, mergedSets);
    const normalizedSets = initializeQuizColors(
      mergedSets,
      normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
    );

    let changed = false;
    if (JSON.stringify(mergedNotes) !== JSON.stringify(notesRef.current)) {
      setNotes(mergedNotes);
      localStorage.setItem('malacadhati', JSON.stringify(mergedNotes));
      changed = true;
    }
    if (JSON.stringify(mergedQuizzes) !== JSON.stringify(quizzesRef.current)) {
      setQuizzes(mergedQuizzes);
      localStorage.setItem('malacadhati_quiz', JSON.stringify(mergedQuizzes));
      changed = true;
    }
    if (JSON.stringify(mergedChats) !== JSON.stringify(chatsRef.current)) {
      setChats(mergedChats);
      localStorage.setItem('malacadhati_chats', JSON.stringify(mergedChats));
      changed = true;
    }
    if (JSON.stringify(normalizedSets) !== JSON.stringify(quizSetsRef.current)) {
      setQuizSets(normalizedSets);
      localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
      changed = true;
    }
    if (JSON.stringify(normalizedFolders) !== JSON.stringify(quizFoldersRef.current)) {
      setQuizFolders(normalizedFolders);
      localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
      changed = true;
    }
    if (JSON.stringify(mergedDrafts) !== JSON.stringify(draftsRef.current)) {
      setDrafts(mergedDrafts);
      draftsRef.current = mergedDrafts;
      localStorage.setItem('malacadhati_drafts', JSON.stringify(mergedDrafts));
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
    if (saveTimer.current || savesInFlight.current > 0 || draftCloudTimer.current) return;
    const recentDraftEdit = Date.now() - lastDraftEditAt.current < 12_000;
    if (recentDraftEdit && hasDraftContent(draftsRef.current)) return;
    const localDraftsEmpty = !hasDraftContent(draftsRef.current);
    if (!force && !localDraftsEmpty && Date.now() - lastLocalSaveAt.current < 800) return;
    try {
      const r = await fetch(await withAuth(`${FB_DB_URL}/users/${u.uid}.json`, () => u.getIdToken()));
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
      const next = draftsRef.current.filter((d) => !pendingDeletedDraftIdsRef.current.has(d.id));
      if (JSON.stringify(next) !== JSON.stringify(draftsRef.current)) {
        draftsRef.current = next;
        setDrafts(next);
        localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
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
    void pullFromCloud(false);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pullFromCloud(false);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushPersist();
    };
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pagehide', flushPersist);
    pullTimer.current = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pullFromCloud();
    }, 12_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pagehide', flushPersist);
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
      if (savesInFlight.current > 0 || saveTimer.current || draftCloudTimer.current) return;
      if (Math.abs(remoteSyncAt - lastLocalSaveAt.current) < 150) return;
      lastAppliedRemoteSyncAt.current = remoteSyncAt;
      void pullDraftsFromCloud(true);
      if (loadedRef.current) void pullFromCloud(false);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, draftsReady]);

  const mutateNotes = (fn: (prev: Note[]) => Note[]) => {
    setNotes((prev) => {
      const next = fn(prev);
      persist({ notes: next });
      return next;
    });
  };

  const addDraft = () => {
    const id = 'd' + ++draftCounter.current;
    const now = Date.now();
    lastDraftEditAt.current = now;
    const next = [...draftsRef.current, { id, title: '', html: '', updatedAt: now }];
    draftsRef.current = next;
    setDrafts(next);
    localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
    persist({ drafts: next });
    scheduleSingleDraftCloudSave(id);
  };

  const removeDraft = (id: string) => {
    pendingDeletedDraftIdsRef.current.add(id);
    writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
    const next = draftsRef.current.filter((d) => d.id !== id);
    draftsRef.current = next;
    setDrafts(next);
    localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
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
    localStorage.setItem('malacadhati_drafts', JSON.stringify(next));
    persist({ drafts: next }, false, true);
    scheduleSingleDraftCloudSave(id);
  };

  const submitDraft = (id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    const text = draft.html.replace(/<[^>]*>/g, '').trim();
    if (!text) return;
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
        pendingDeletedDraftIdsRef.current.add(id);
        writeDeletedDraftIds(pendingDeletedDraftIdsRef.current);
        const nextDrafts = prevDrafts.filter((d) => d.id !== id);
        draftsRef.current = nextDrafts;
        localStorage.setItem('malacadhati_drafts', JSON.stringify(nextDrafts));
        persist({ notes: nextNotes, drafts: nextDrafts }, true);
        void runDraftDeleteCloudSave(id);
        return nextDrafts;
      });
      return nextNotes;
    });
  };

  const updateNote = (id: number, patch: Partial<Note>) =>
    mutateNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const addQuiz = (item: Omit<QuizItem, 'id'>): number => {
    const newId = Date.now();
    setQuizzes((prev) => {
      const now = new Date().toISOString();
      const next = [...prev, { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now }];
      persist({ quizzes: next });
      return next;
    });
    return newId;
  };

  const deleteQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, trashed: true, deletedAt: nowStr() } : q);
      persist({ quizzes: next });
      return next;
    });
  };

  const restoreQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, trashed: false, deletedAt: undefined } : q);
      persist({ quizzes: next });
      return next;
    });
  };

  const permDeleteQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.filter((q) => q.id !== id);
      persist({ quizzes: next });
      return next;
    });
  };

  const updateQuiz = (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q));
      persist({ quizzes: next });
      return next;
    });
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
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, trashed: true, deletedAt: nowStr() } : s);
      persistSets(next);
      return next;
    });
  };

  const restoreQuizSet = (id: string) => {
    setQuizSets((prev) => {
      const set = prev.find((item) => item.id === id);
      if (!set) return prev;
      const next = [...prev.filter((item) => item.id !== id), { ...set, trashed: false, deletedAt: undefined, folderId: RESTORED_FOLDER_ID }];
      persistSets(next);
      return next;
    });
  };

  const permDeleteQuizSet = (id: string) => {
    if (id === FAVORITES_SET_ID) return;
    setQuizSets((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSets(next);
      return next;
    });
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
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name } : f));
      persistFolders(next);
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
    setQuizFolders((prev) => {
      const next = prev.map((f) => f.id === id ? { ...f, trashed: true, deletedAt: nowStr() } : f);
      persistFolders(next);
      return next;
    });
  };

  const restoreQuizFolder = (id: string) => {
    setQuizFolders((prev) => {
      const next = prev.map((f) => f.id === id ? { ...f, trashed: false, deletedAt: undefined } : f);
      persistFolders(next);
      return next;
    });
  };

  const permDeleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const nextSets = quizSets.map((s) => s.folderId === id ? { ...s, folderId: undefined } : s);
    const nextFolders = quizFolders.filter((f) => f.id !== id);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist({ quizSets: nextSets, quizFolders: nextFolders });
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
      const res = await fetch(`${FB_DB_URL}/users/${user.uid}/dataHistory.json?shallow=true`);
      const keys = Object.keys((await res.json()) || {}).sort().reverse();
      const snapshots = await Promise.all(keys.map(async (key) => {
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
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    localStorage.setItem('malacadhati_chats', JSON.stringify(nextChats));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
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

  const hasDataBackups = async (): Promise<boolean> => {
    if (!user) return false;
    try {
      const res = await fetch(`${FB_DB_URL}/users/${user.uid}/dataHistory.json?shallow=true`);
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
    localStorage.setItem('malacadhati', JSON.stringify(snapshot.notes));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(snapshot.quizzes));
    localStorage.setItem('malacadhati_chats', JSON.stringify(snapshot.chats));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist({ notes: snapshot.notes, quizzes: snapshot.quizzes, chats: snapshot.chats, quizSets: nextSets, quizFolders: nextFolders }, true);
    await fetch(`${FB_DB_URL}/users/${user!.uid}/quizSets.json`, {
      method: 'PUT',
      body: JSON.stringify(nextSets),
      headers: { 'Content-Type': 'application/json' },
    });
    await fetch(`${FB_DB_URL}/users/${user!.uid}/quizFolders.json`, {
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
    const cloud = await fetch(`${FB_DB_URL}/users/${user.uid}.json`).then((r) => r.json()).catch(() => null) as Record<string, unknown> | null;
    const fullUserTree = await fetch(`${FB_DB_URL}/users/${user.uid}.json`).then((r) => r.json()).catch(() => null);
    const orphaned = deepScanOrphanedContent(fullUserTree);
    const [{ key: bestKey, snapshot: bestHistory }, dedicated, folderHistoryKeys] = await Promise.all([
      fetchBestDataHistory(user.uid),
      readDedicatedQuizData(user.uid),
      fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory.json?shallow=true`).then((r) => r.json()).then((data) => Object.keys(data || {}).length).catch(() => 0),
    ]);
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
    const cloud = await fetch(`${FB_DB_URL}/users/${user.uid}.json`).then((r) => r.json()).catch(() => null) as Record<string, unknown> | null;
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
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    localStorage.setItem('malacadhati_chats', JSON.stringify(nextChats));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
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
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: [...s.items, newItem] } : s);
      persistSets(next);
      return next;
    });
    return newId;
  };

  const removeItemFromSet = (setId: string, itemId: number) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s);
      persistSets(next);
      return next;
    });
  };

  const updateItemInSet = (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.map((i) => i.id === itemId ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i) } : s);
      persistSets(next);
      return next;
    });
  };

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
    mutateNotes((prev) => prev.map((n) => (n.id === id ? { ...n, fav: !n.fav } : n)));
  const archive = (id: number) => updateNote(id, { archived: true });
  const unarchive = (id: number) => updateNote(id, { archived: false, read: false });
  const trash = (id: number) => updateNote(id, { trashed: true, deletedAt: nowStr() });
  const restore = (id: number) => updateNote(id, { trashed: false, deletedAt: undefined });
  const permDelete = (id: number) => mutateNotes((prev) => prev.filter((n) => n.id !== id));
  const emptyTrash = () => {
    const nextNotes = notes.filter((n) => !n.trashed);
    const nextQuizzes = quizzes.filter((q) => !q.trashed);
    const removedFolderIds = new Set(quizFolders.filter((folder) => folder.trashed).map((folder) => folder.id));
    const nextSets = quizSets
      .filter((set) => !set.trashed)
      .map((set) => set.folderId && removedFolderIds.has(set.folderId) ? { ...set, folderId: undefined } : set);
    const nextFolders = quizFolders.filter((folder) => !folder.trashed);
    setNotes(nextNotes);
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist({ notes: nextNotes, quizzes: nextQuizzes, quizSets: nextSets, quizFolders: nextFolders });
  };
  const deleteMany = (ids: number[]) => {
    const idSet = new Set(ids);
    mutateNotes((prev) => prev.filter((n) => !idSet.has(n.id)));
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
