import { describe, expect, it } from 'vitest';
import { applyDurableQuizItems, type StoredQuizItem } from './itemsStore';
import {
  adoptByIdMembershipWhenRicher,
  countLiveQuizItems,
  pickBetterQuizSet,
  preferRicherQuizSetsMembership,
  quizSetsMembershipGrew,
  quizSetsMembershipShrunk,
  unionQuizSetsForCommit,
} from './quizSetMerge';
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

describe('notes-like union commit (no paint gates)', () => {
  const nine = Array.from({ length: 9 }, (_, i) => item(i + 1, `Q${i + 1}`, '2026-08-11T10:00:00.000Z'));
  const eleven = Array.from({ length: 11 }, (_, i) =>
    item(i + 1, `Q${i + 1}-cloud`, '2026-08-11T12:00:00.000Z'),
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
  const byIdEleven = [
    set({
      id: 'koag',
      name: 'Koagulationsstatus',
      items: eleven,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-11T11:00:00.000Z',
    }),
  ];

  it('union 9+11 → 11', () => {
    const merged = unionQuizSetsForCommit(localNine, byIdEleven);
    expect(merged[0].items.filter((i) => !i.trashed)).toHaveLength(11);
    expect(countLiveQuizItems(merged)).toBe(11);
  });

  it('short array cannot shrink richer local/ById', () => {
    const shortRemote = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: nine.slice(0, 3),
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    const merged = unionQuizSetsForCommit(shortRemote, localNine, byIdEleven);
    expect(merged[0].items.filter((i) => !i.trashed)).toHaveLength(11);
    expect(quizSetsMembershipShrunk(byIdEleven, merged)).toBe(false);
  });

  it('preferRicher keeps 11 from ById over newer array-9', () => {
    const merged = preferRicherQuizSetsMembership(localNine, byIdEleven);
    expect(merged[0].items.filter((i) => !i.trashed)).toHaveLength(11);
  });

  it('adoptByIdMembershipWhenRicher ignores shorter array membership', () => {
    const merged = adoptByIdMembershipWhenRicher(localNine, byIdEleven);
    expect(merged[0].items.filter((i) => !i.trashed)).toHaveLength(11);
  });

  it('detects membership growth 9→11', () => {
    expect(quizSetsMembershipGrew(localNine, byIdEleven)).toBe(true);
  });

  it('detects new set ids even with empty items shells (mobile Prover case)', () => {
    const mobileTwo = [
      set({ id: 'abl', name: 'ABL', items: [item(1, 'q', '2026-01-01T00:00:00.000Z')], createdAt: '2026-01-01T00:00:00.000Z' }),
      set({ id: 'tb', name: 'Tuberkulos', items: [], createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const cloudFull = [
      ...mobileTwo,
      set({ id: 'serum', name: 'Serum & Plasma', items: [], createdAt: '2026-01-01T00:00:00.000Z' }),
      set({ id: 'koag', name: 'Koagulationsstatus', items: [], createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(quizSetsMembershipGrew(mobileTwo, cloudFull)).toBe(true);
    const committed = unionQuizSetsForCommit(mobileTwo, cloudFull);
    expect(committed.map((s) => s.id).sort()).toEqual(['abl', 'koag', 'serum', 'tb']);
  });

  it('local-first paint path: incomplete LS then ById enrich always grows', () => {
    const lsPartial = [
      set({ id: 'abl', name: 'ABL', items: [item(1, 'q', '2026-01-01T00:00:00.000Z')], createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const painted = unionQuizSetsForCommit(lsPartial);
    expect(painted).toHaveLength(1);
    const afterById = unionQuizSetsForCommit(painted, [
      set({ id: 'abl', name: 'ABL', items: [item(1, 'q', '2026-01-01T00:00:00.000Z')], createdAt: '2026-01-01T00:00:00.000Z' }),
      set({
        id: 'serum',
        name: 'Serum & Plasma',
        items: [item(2, 'q2', '2026-01-01T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    expect(afterById.map((s) => s.id).sort()).toEqual(['abl', 'serum']);
    expect(quizSetsMembershipGrew(painted, afterById)).toBe(true);
  });
});
