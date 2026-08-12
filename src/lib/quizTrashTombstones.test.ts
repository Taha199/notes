import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
  readTrashTombstones,
  writeTrashTombstones,
} from './quizTrashTombstones';
import { QUIZ_COMPLETE_CACHE_LS_KEY } from './quizCompleteCache';

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.removeItem(QUIZ_ITEM_TRASH_TOMBSTONE_KEY);
    localStorage.removeItem(QUIZ_COMPLETE_CACHE_LS_KEY);
  } catch {
    /* ignore */
  }
});

describe('quiz trash tombstone quota recovery', () => {
  it('evicts last-good cache so a tiny tombstone write can land', () => {
    localStorage.setItem(QUIZ_COMPLETE_CACHE_LS_KEY, '{"sets":[]}');
    const realSetItem = Storage.prototype.setItem;
    let tombstoneAttempts = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === QUIZ_ITEM_TRASH_TOMBSTONE_KEY && tombstoneAttempts++ === 0) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    });

    writeTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY, { '12': 1_723_456_789_000 });
    expect(readTrashTombstones(QUIZ_ITEM_TRASH_TOMBSTONE_KEY)['12']).toBe(1_723_456_789_000);
    expect(localStorage.getItem(QUIZ_COMPLETE_CACHE_LS_KEY)).toBeNull();
  });
});
