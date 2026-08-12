import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERM_DELETED_KEY,
  QUIZ_ITEM_TRASH_TOMBSTONE_KEY,
  TRASH_EMPTIED_AT_KEY,
  pruneQuizListsAgainstTrashState,
  readTrashTombstones,
  writeTinyDurableValue,
  writeTrashEmptiedAt,
  writeTrashTombstones,
} from './quizTrashTombstones';
import { QUIZ_COMPLETE_CACHE_LS_KEY } from './quizCompleteCache';

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.removeItem(QUIZ_ITEM_TRASH_TOMBSTONE_KEY);
    localStorage.removeItem(QUIZ_COMPLETE_CACHE_LS_KEY);
    localStorage.removeItem(PERM_DELETED_KEY);
    localStorage.removeItem(TRASH_EMPTIED_AT_KEY);
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

  it('evicts last-good so empty-trash watermark can persist', () => {
    localStorage.setItem(QUIZ_COMPLETE_CACHE_LS_KEY, '{"sets":[]}');
    const realSetItem = Storage.prototype.setItem;
    let attempts = 0;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === TRASH_EMPTIED_AT_KEY && attempts++ === 0) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return realSetItem.call(this, key, value);
    });
    writeTrashEmptiedAt(1_723_456_789_000);
    expect(localStorage.getItem(TRASH_EMPTIED_AT_KEY)).toBe('1723456789000');
    expect(localStorage.getItem(QUIZ_COMPLETE_CACHE_LS_KEY)).toBeNull();
  });

  it('pruneQuizListsAgainstTrashState drops emptied questions from last-good copies', () => {
    writeTinyDurableValue(
      PERM_DELETED_KEY,
      JSON.stringify({ notes: [], quizzes: [12], quizSets: [], quizFolders: [] }),
    );
    writeTrashEmptiedAt(Date.parse('2026-08-12T18:40:00.000Z'));
    const pruned = pruneQuizListsAgainstTrashState(
      [{
        id: 12,
        noteId: 0,
        noteTitle: '',
        question: 'تجربة ٢',
        answer: '',
        date: '2026-08-12T18:34:00.000Z',
        createdAt: '2026-08-12T18:34:00.000Z',
        updatedAt: '2026-08-12T18:34:00.000Z',
        trashed: true,
      }],
      [{
        id: 's1',
        name: 'Set',
        createdAt: '2026-08-12T00:00:00.000Z',
        items: [{
          id: 12,
          noteId: 0,
          noteTitle: '',
          question: 'تجربة ٢',
          answer: '',
          date: '2026-08-12T18:34:00.000Z',
          createdAt: '2026-08-12T18:34:00.000Z',
          updatedAt: '2026-08-12T18:34:00.000Z',
          trashed: true,
        }, {
          id: 14,
          noteId: 0,
          noteTitle: '',
          question: '1',
          answer: '1',
          date: '2026-08-12T00:00:00.000Z',
          createdAt: '2026-08-12T00:00:00.000Z',
          updatedAt: '2026-08-12T00:00:00.000Z',
        }],
      }],
    );
    expect(pruned.quizzes).toEqual([]);
    expect(pruned.sets[0].items.map((i) => i.id)).toEqual([14]);
  });
});
