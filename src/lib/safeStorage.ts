/**
 * localStorage writes that never throw — QuotaExceeded used to white-screen Quiz
 * when clicking Restored/Favourites (saveQuizSelection of a tiny JSON still fails
 * once the origin is full of legacy multi-MB quiz/note caches).
 */

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
  // Drop any oversized leftover keys (except the one we are writing).
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    for (const key of keys) {
      if (exceptKey && key === exceptKey) continue;
      if (!key.startsWith('malacadhati')) continue;
      try {
        const size = (localStorage.getItem(key) || '').length;
        if (size > 200_000) localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (first) {
    pruneLocalStorageCaches(key);
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (second) {
      console.error('[localStorage] setItem failed for', key, second || first);
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
