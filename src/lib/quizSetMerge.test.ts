import { describe, expect, it } from 'vitest';
import { applyDurableQuizItems, type StoredQuizItem } from './itemsStore';
import {
  countLiveQuizItems,
  decideQuizListsUiPaint,
  pickBetterQuizSet,
  quizSetsMembershipGrew,
} from './quizSetMerge';
import { quizSetsEqualForUI, quizzesEqualForUI } from './quizContent';
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

describe('pickBetterQuizSet item union', () => {
  it('keeps all 10 questions when a newer partial set only has 3', () => {
    const fullItems = Array.from({ length: 10 }, (_, i) =>
      item(i + 1, `Q${i + 1}`, '2024-08-11T10:00:00.000Z'),
    );
    const partialItems = fullItems.slice(0, 3);
    const local = set({
      id: 'koag',
      name: 'Koagulationsstatus',
      items: fullItems,
      createdAt: '2024-08-11T09:00:00.000Z',
      updatedAt: '2024-08-11T10:00:00.000Z',
    });
    // Work device renamed / re-saved a stale 3-item snapshot with a newer stamp.
    const remote = set({
      id: 'koag',
      name: 'Koagulationsstatus',
      items: partialItems,
      createdAt: '2024-08-11T09:00:00.000Z',
      updatedAt: '2026-08-11T18:00:00.000Z',
    });

    const merged = pickBetterQuizSet(local, remote);
    expect(merged.items.filter((i) => !i.trashed)).toHaveLength(10);
    expect(merged.updatedAt).toBe(remote.updatedAt);
    expect(countLiveQuizItems([merged])).toBe(10);
  });

  it('keeps fuller side when IndexedDB/ById shell has items:[] and newer updatedAt', () => {
    const fullItems = Array.from({ length: 8 }, (_, i) =>
      item(100 + i, `Q${i}`, '2024-01-01T00:00:00.000Z'),
    );
    const local = set({
      id: 's1',
      name: 'Serum',
      items: fullItems,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const shell = set({
      id: 's1',
      name: 'Serum & Plasma',
      items: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2026-08-11T20:00:00.000Z',
    });

    const merged = pickBetterQuizSet(local, shell);
    expect(merged.name).toBe('Serum & Plasma');
    expect(merged.items).toHaveLength(8);
  });

  it('honors soft-trash tombstones without dropping sibling live items', () => {
    const local = set({
      id: 's1',
      name: 'Set',
      items: [
        item(1, 'keep', '2024-01-01T00:00:00.000Z'),
        item(2, 'gone', '2024-01-02T00:00:00.000Z', { trashed: true, deletedAt: '2024-01-02T00:00:00.000Z' }),
        item(3, 'keep3', '2024-01-01T00:00:00.000Z'),
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    const remote = set({
      id: 's1',
      name: 'Set',
      items: [
        item(1, 'keep', '2024-01-01T00:00:00.000Z'),
        item(2, 'gone-live-stale', '2024-01-01T00:00:00.000Z'),
        item(3, 'keep3', '2024-01-01T00:00:00.000Z'),
      ],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T12:00:00.000Z',
    });

    const merged = pickBetterQuizSet(local, remote);
    expect(merged.items).toHaveLength(3);
    expect(merged.items.find((i) => i.id === 2)?.trashed).toBe(true);
    expect(merged.items.filter((i) => !i.trashed)).toHaveLength(2);
  });

  it('preserves listOrderUpdatedAt / orderUpdatedAt authority independently', () => {
    const local = set({
      id: 's1',
      name: 'A',
      items: [item(1, 'q', '2024-01-01T00:00:00.000Z')],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-03T00:00:00.000Z',
      orderUpdatedAt: '2024-01-01T00:00:00.000Z',
      listOrderUpdatedAt: '2024-01-05T00:00:00.000Z',
    });
    const remote = set({
      id: 's1',
      name: 'A',
      items: [item(1, 'q', '2024-01-01T00:00:00.000Z'), item(2, 'q2', '2024-01-02T00:00:00.000Z')],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      orderUpdatedAt: '2024-01-04T00:00:00.000Z',
      listOrderUpdatedAt: '2024-01-01T00:00:00.000Z',
    });

    const merged = pickBetterQuizSet(local, remote);
    expect(merged.items).toHaveLength(2);
    expect(merged.orderUpdatedAt).toBe('2024-01-04T00:00:00.000Z');
    expect(merged.listOrderUpdatedAt).toBe('2024-01-05T00:00:00.000Z');
  });

  it('keeps Manual in-set item order from the side with newer orderUpdatedAt', () => {
    const a = item(1, 'first', '2024-01-01T00:00:00.000Z');
    const b = item(2, 'second', '2024-01-01T00:00:00.000Z');
    const c = item(3, 'third', '2024-01-01T00:00:00.000Z');
    const local = set({
      id: 'koag',
      name: 'Koag',
      items: [c, a, b],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-02T00:00:00.000Z',
      orderUpdatedAt: '2024-08-11T21:00:00.000Z',
    });
    const remote = set({
      id: 'koag',
      name: 'Koag',
      items: [a, b, c],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-08-11T20:00:00.000Z',
      orderUpdatedAt: '2024-01-01T00:00:00.000Z',
    });

    const merged = pickBetterQuizSet(local, remote);
    expect(merged.items.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(merged.orderUpdatedAt).toBe('2024-08-11T21:00:00.000Z');
  });
});

describe('applyDurableQuizItems keep-more-data', () => {
  it('re-attaches durable items even when the set shell is newer', () => {
    const sets: QuizSet[] = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [
          item(1, 'Q1', '2024-08-11T10:00:00.000Z'),
          item(2, 'Q2', '2024-08-11T10:00:00.000Z'),
          item(3, 'Q3', '2024-08-11T10:00:00.000Z'),
        ],
        createdAt: '2024-08-11T09:00:00.000Z',
        // Newer than the durable items — old gate blocked re-attach here.
        updatedAt: '2026-08-11T20:00:00.000Z',
      }),
    ];
    const durable: StoredQuizItem[] = Array.from({ length: 10 }, (_, i) => ({
      ...item(i + 1, `Q${i + 1}`, '2024-08-11T10:00:00.000Z'),
      setId: 'koag',
    }));

    const { sets: next } = applyDurableQuizItems([], sets, durable);
    expect(next[0].items.filter((i) => !i.trashed)).toHaveLength(10);
  });
});

describe('quiz UI paint gate after timeout local-9', () => {
  const nine = Array.from({ length: 9 }, (_, i) => item(i + 1, `Q${i + 1}`, '2026-08-11T10:00:00.000Z'));
  const eleven = Array.from({ length: 11 }, (_, i) =>
    item(i + 1, `Q${i + 1}-cloud`, '2026-08-11T12:00:00.000Z'),
  );
  const paintedSets = [
    set({
      id: 'koag',
      name: 'Koagulationsstatus',
      items: nine,
      createdAt: '2026-08-01T00:00:00.000Z',
    }),
  ];
  const richerSets = [
    set({
      id: 'koag',
      name: 'Koagulationsstatus',
      items: eleven,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-11T12:00:00.000Z',
    }),
  ];

  it('detects membership growth 9→11', () => {
    expect(quizSetsMembershipGrew(paintedSets, richerSets)).toBe(true);
    expect(countLiveQuizItems(richerSets)).toBe(11);
  });

  it('paints richer cloud after timeout revealed local-9 (ById catch-up)', () => {
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: true,
      seenAuthoritativeById: false,
      isAuthoritativeByIdMerge: true,
      paintedSets,
      nextSets: richerSets,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI,
    });
    expect(decision.paint).toBe(true);
    expect(['byid-catchup', 'membership-grew']).toContain(decision.reason);
  });

  it('still paints membership growth after authoritative ById (no stick at 9)', () => {
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets,
      nextSets: richerSets,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI,
    });
    expect(decision.paint).toBe(true);
    expect(decision.reason).toBe('membership-grew');
  });

  it('skips same-id HTML flip after authoritative reveal when membership is unchanged', () => {
    const sameIdsNewHtml = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: nine.map((q) => ({ ...q, question: `${q.question} edited`, updatedAt: '2026-08-11T13:00:00.000Z' })),
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
    ];
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets,
      nextSets: sameIdsNewHtml,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI,
    });
    expect(decision.paint).toBe(false);
    expect(decision.reason).toBe('skip');
  });
});
