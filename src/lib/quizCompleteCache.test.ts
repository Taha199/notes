import { afterEach, describe, expect, it } from 'vitest';
import {
  clearQuizCompleteCache,
  pickBootQuizLists,
  quizSetsHaveCompleteBodies,
  readQuizCompleteCache,
  shouldApplyBackgroundQuizUpdate,
  writeQuizCompleteCache,
  QUIZ_COMPLETE_CACHE_LS_KEY,
} from './quizCompleteCache';
import { countLiveQuizItems, decideQuizListsUiPaint } from './quizSetMerge';
import { quizzesEqualForUI, quizSetsEqualForUI } from './quizContent';
import type { QuizItem, QuizSet } from '../types';

function item(id: number, question: string, updatedAt: string, extra?: Partial<QuizItem>): QuizItem {
  return {
    id,
    noteId: 0,
    noteTitle: '',
    question,
    answer: `a${id}`,
    date: updatedAt,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

function set(partial: Partial<QuizSet> & Pick<QuizSet, 'id' | 'name' | 'items' | 'createdAt'>): QuizSet {
  return { ...partial };
}

const nine = Array.from({ length: 9 }, (_, i) => item(i + 1, `Q${i + 1}`, '2026-08-11T10:00:00.000Z'));
const eleven = Array.from({ length: 11 }, (_, i) =>
  item(i + 1, `Q${i + 1}-full`, '2026-08-11T12:00:00.000Z'),
);

const localNine = [
  set({
    id: 'koag',
    name: 'Koagulationsstatus',
    items: nine,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-11T22:00:00.000Z',
  }),
];

const lastGoodEleven = [
  set({
    id: 'koag',
    name: 'Koagulationsstatus',
    items: eleven,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-11T11:00:00.000Z',
    orderUpdatedAt: '2026-08-11T21:00:00.000Z',
    itemsOrder: eleven.map((i) => i.id),
  }),
];

afterEach(() => {
  clearQuizCompleteCache();
  try {
    localStorage.removeItem(QUIZ_COMPLETE_CACHE_LS_KEY);
  } catch {
    /* ignore */
  }
});

describe('quizCompleteCache last-good boot', () => {
  it('last-good 11 beats incomplete LS 9 on boot', () => {
    const boot = pickBootQuizLists({
      localQuizzes: [],
      localSets: localNine,
      lastGood: {
        quizzes: [],
        sets: lastGoodEleven,
        savedAt: Date.now(),
        liveItemCount: 11,
      },
      memory: null,
    });
    expect(boot.fromLastGood).toBe(true);
    expect(boot.source).toBe('last-good');
    expect(boot.sets[0].items.filter((i) => !i.trashed)).toHaveLength(11);
    expect(countLiveQuizItems(boot.sets)).toBe(11);
  });

  it('does not paint shorter LS over last-good', () => {
    writeQuizCompleteCache([], lastGoodEleven);
    const stored = readQuizCompleteCache();
    expect(stored?.liveItemCount).toBe(11);
    // Attempt to poison with 9 — must be rejected.
    expect(writeQuizCompleteCache([], localNine)).toBe(false);
    expect(readQuizCompleteCache()?.liveItemCount).toBe(11);
  });

  it('structure-only shells are not treated as complete bodies', () => {
    const shells = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [],
        createdAt: '2026-08-01T00:00:00.000Z',
        itemsOrder: [1, 2, 3],
      }),
    ];
    expect(quizSetsHaveCompleteBodies(shells)).toBe(false);
    expect(writeQuizCompleteCache([], shells)).toBe(false);
  });

  it('memory session cache preferred when at least as rich', () => {
    const boot = pickBootQuizLists({
      localQuizzes: [],
      localSets: localNine,
      lastGood: {
        quizzes: [],
        sets: lastGoodEleven,
        savedAt: Date.now(),
        liveItemCount: 11,
      },
      memory: { quizzes: [], sets: lastGoodEleven },
    });
    expect(boot.source).toBe('memory');
    expect(countLiveQuizItems(boot.sets)).toBe(11);
  });

  it('falls back to local when no last-good exists', () => {
    const boot = pickBootQuizLists({
      localQuizzes: [],
      localSets: localNine,
      lastGood: null,
      memory: null,
    });
    expect(boot.fromLastGood).toBe(false);
    expect(boot.source).toBe('local');
    expect(countLiveQuizItems(boot.sets)).toBe(9);
  });
});

describe('background updates after last-good paint', () => {
  it('allows membership growth and strictly newer item bodies', () => {
    expect(shouldApplyBackgroundQuizUpdate(localNine, lastGoodEleven)).toBe(true);
    const older = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [item(1, '<p>old</p>', '2026-01-01T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const newer = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [item(1, '<p>new</p>', '2026-01-02T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(shouldApplyBackgroundQuizUpdate(older, newer)).toBe(true);
  });

  it('rejects older/shorter shells over painted last-good', () => {
    expect(shouldApplyBackgroundQuizUpdate(lastGoodEleven, localNine)).toBe(false);
  });

  it('allows soft-delete shrink to land', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [
          item(1, 'a', '2026-01-01T00:00:00.000Z'),
          item(2, 'b', '2026-01-01T00:00:00.000Z'),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const deleted = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [
          item(1, 'a', '2026-01-01T00:00:00.000Z'),
          item(2, 'b', '2026-01-02T00:00:00.000Z', { trashed: true }),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(shouldApplyBackgroundQuizUpdate(painted, deleted)).toBe(true);
    // Soft-delete may rewrite last-good (live count drop explained by tombstone).
    writeQuizCompleteCache([], painted);
    expect(writeQuizCompleteCache([], deleted)).toBe(true);
    expect(countLiveQuizItems(readQuizCompleteCache()!.sets)).toBe(1);
  });

  it('decideQuizListsUiPaint applies strictly newer bodies after authoritative last-good', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [item(1, '<p>old</p>', '2026-01-01T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const newer = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [item(1, '<p>new</p>', '2026-01-03T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets: painted,
      nextSets: newer,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    });
    expect(decision).toEqual({ paint: true, reason: 'content-changed' });
  });

  it('decideQuizListsUiPaint still skips same-id older/equal echoes', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [item(1, '<p>same</p>', '2026-01-02T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const echo = [
      set({
        id: 'koag',
        name: 'Koag',
        items: [item(1, '<p>stale</p>', '2026-01-01T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets: painted,
      nextSets: echo,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    });
    expect(decision).toEqual({ paint: false, reason: 'skip' });
  });
});
