/**
 * localStorage writes that never throw — QuotaExceeded used to white-screen Quiz
 * when clicking Restored/Favourites (saveQuizSelection of a tiny JSON still fails
 * once the origin is full of legacy multi-MB quiz/note caches).
 */

/** Skip (and never retry) payloads that can OOM Chrome during setItem. */
export const MAX_LOCALSTORAGE_VALUE_CHARS = 1_500_000;
/** After a quota prune, only retry values small enough to actually fit. */
export const MAX_LOCALSTORAGE_RETRY_CHARS = 400_000;

/** Disposable caches — durable copies live in IndexedDB / Firebase. */
const PRUNE_ON_QUOTA = [
  'malacadhati_quiz_sets',
  'malacadhati_quiz',
  'malacadhati',
  'malacadhati_quiz_sets_shells',
  'malacadhati_chats',
  'malacadhati_drafts',
  'malacadhati_quiz_complete_cache',
  'malacadhati_quiz_sets_complete_cache',
  'malacadhati_notes_list_cache',
  'malacadhati_notes_boot_cache',
];

function pruneLocalStorageCaches(exceptKey?: string) {
  for (const key of PRUNE_ON_QUOTA) {
    if (exceptKey && key === exceptKey) continue;
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
  if (typeof value !== 'string' || value.length > MAX_LOCALSTORAGE_VALUE_CHARS) {
    return false;
  }
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    pruneLocalStorageCaches(key);
    if (value.length > MAX_LOCALSTORAGE_RETRY_CHARS) {
      return false;
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
