/**
 * Isolate device-local caches between Firebase accounts.
 *
 * Shared localStorage / IndexedDB / in-memory boot caches are NOT uid-scoped.
 * Without isolation, signing in as account B after account A can paint A's notes
 * into B's UI and even PATCH them into B's cloud via "repair from local".
 *
 * This module NEVER deletes cloud RTDB data. It only clears shared device caches
 * when the signed-in uid changes so each account loads from its own users/{uid}/ tree.
 */
import { clearQuizCompleteCache, QUIZ_COMPLETE_CACHE_LS_KEY } from './quizCompleteCache';
import {
  clearNotesBootCache,
  clearNotesListCache,
  clearServerNotesCatalog,
  NOTES_LIST_CACHE_KEY,
} from './notesListCache';
import {
  clearNotesPrefetchMemory,
  clearQuizCatalogMemory,
  clearSharedItemsIdb,
} from './itemsStore';
import {
  NOTE_TRASH_TOMBSTONE_KEY,
  PERM_DELETED_KEY,
  QUIZ_FOLDER_TRASH_TOMBSTONE_KEY,
  QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
  QUIZ_SET_TRASH_TOMBSTONE_KEY,
  SIDEBAR_COUNTS_KEY,
  TRASH_EMPTIED_AT_KEY,
} from './quizTrashTombstones';

export const LAST_UID_KEY = 'malacadhati_last_uid';
/** sessionStorage: uid that just switched onto this device — block local→cloud repair. */
export const ACCOUNT_SWITCH_FLAG_KEY = 'malacadhati_account_switched_uid';

const QUIZ_SETS_SHELL_KEY = 'malacadhati_quiz_sets_shells';
const QUIZ_SETS_LIST_ORDER_KEY = 'malacadhati_quiz_sets_list_order';
const CLOUD_SYNCED_AT_KEY = 'malacadhati_cloud_synced_at';
const DELETED_DRAFT_IDS_KEY = 'malacadhati_deleted_draft_ids';
const FOLDER_NAMES_SNAPSHOT_KEY = 'malacadhati_quiz_folder_names_v1';

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
  NOTE_TRASH_TOMBSTONE_KEY,
  TRASH_EMPTIED_AT_KEY,
  PERM_DELETED_KEY,
  SIDEBAR_COUNTS_KEY,
  NOTES_LIST_CACHE_KEY,
  CLOUD_SYNCED_AT_KEY,
  DELETED_DRAFT_IDS_KEY,
  FOLDER_NAMES_SNAPSHOT_KEY,
] as const;

/** In-flight IndexedDB wipe — NotesProvider must await before reading IDB after a switch. */
let idbClearInFlight: Promise<void> | null = null;

function safeRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

/** Wipe shared device caches (not cloud). Safe when switching accounts. */
export function clearAllSharedAccountLocalData() {
  for (const key of LOCAL_DATA_KEYS) safeRemove(key);
  clearQuizCompleteCache();
  clearNotesListCache();
  clearNotesBootCache();
  clearServerNotesCatalog();
  clearNotesPrefetchMemory();
  clearQuizCatalogMemory();
  const wipe = clearSharedItemsIdb().finally(() => {
    if (idbClearInFlight === wipe) idbClearInFlight = null;
  });
  idbClearInFlight = wipe;
}

/** Resolve once shared IndexedDB stores are empty after an account switch. */
export function waitForAccountLocalIsolation(): Promise<void> {
  return idbClearInFlight ?? Promise.resolve();
}

/**
 * Call as soon as Firebase auth resolves a uid — before NotesProvider paints.
 * Returns whether this login is a different account than the previous device session.
 */
export function prepareLocalCacheForUid(uid: string): { switched: boolean } {
  let prev: string | null = null;
  try {
    prev = localStorage.getItem(LAST_UID_KEY);
  } catch { /* ignore */ }
  const switched = !!(prev && prev !== uid);
  if (switched) {
    clearAllSharedAccountLocalData();
    try {
      sessionStorage.setItem(ACCOUNT_SWITCH_FLAG_KEY, uid);
    } catch { /* ignore */ }
  }
  try {
    localStorage.setItem(LAST_UID_KEY, uid);
  } catch { /* ignore */ }
  return { switched };
}

/** True while this uid's first post-switch session must not push local caches to cloud. */
export function isAccountSwitchPending(uid: string): boolean {
  try {
    return sessionStorage.getItem(ACCOUNT_SWITCH_FLAG_KEY) === uid;
  } catch {
    return false;
  }
}

/** Clear after a successful cloud load for this uid (local cache now belongs to them). */
export function clearAccountSwitchPending(uid: string) {
  try {
    if (sessionStorage.getItem(ACCOUNT_SWITCH_FLAG_KEY) === uid) {
      sessionStorage.removeItem(ACCOUNT_SWITCH_FLAG_KEY);
    }
  } catch { /* ignore */ }
}

export function clearInMemoryCachesOnSignOut() {
  clearNotesBootCache();
  clearServerNotesCatalog();
  clearNotesPrefetchMemory();
  clearQuizCatalogMemory();
}
