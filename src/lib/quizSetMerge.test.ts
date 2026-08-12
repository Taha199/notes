import { describe, expect, it } from 'vitest';
import { applyDurableQuizItems, type StoredQuizItem } from './itemsStore';
import {
  adoptByIdMembershipWhenRicher,
  applyQuizItemTrashTombstonesToSets,
  applyQuizItemsOrder,
  bumpMaxKnownLiveBySet,
  countLiveQuizItems,
  enforceMaxKnownLiveMembership,
  isQuizSetsLocalWriteSafe,
  orderQuizSetsByListAuthority,
  pickBetterQuizSet,
  preferRicherQuizSetsMembership,
  quizSetsMembershipGrew,
  quizSetsMembershipShrunk,
  quizSetsSoftTrashExplainsShrink,
  decideQuizListsUiPaint,
  quizListsStructuralUiChanged,
  shouldHydrateQuizSetsUi,
  unionQuizSetsForCommit,
} from './quizSetMerge';
import type { QuizItem, QuizSet } from '../types';
import { quizzesEqualForUI, quizSetsEqualForUI } from './quizContent';

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
    expect(merged.itemsOrder).toEqual([3, 1, 2]);
  });

  it('applies itemsOrder from a stamped empty shell over scrambled durable bodies', () => {
    const a = item(1, 'first', '2024-01-01T00:00:00.000Z');
    const b = item(2, 'second', '2024-01-01T00:00:00.000Z');
    const c = item(3, 'third', '2024-01-01T00:00:00.000Z');
    // IDB shell after reorder: items stripped, but itemsOrder + orderUpdatedAt kept.
    const shell = set({
      id: 'koag',
      name: 'Koag',
      items: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      orderUpdatedAt: '2024-08-11T21:00:00.000Z',
      itemsOrder: [3, 1, 2],
    });
    // Bodies reattached in Object.values / store order (wrong) — no itemsOrder yet.
    const reattached = set({
      id: 'koag',
      name: 'Koag',
      items: [a, b, c],
      createdAt: '2024-01-01T00:00:00.000Z',
      orderUpdatedAt: '2024-08-11T21:00:00.000Z',
    });
    const merged = pickBetterQuizSet(shell, reattached);
    expect(merged.items.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(merged.itemsOrder).toEqual([3, 1, 2]);
    expect(applyQuizItemsOrder([a, b, c], [3, 1, 2]).map((i) => i.id)).toEqual([3, 1, 2]);
  });

  it('does not let an empty stamped shell without itemsOrder beat a full sequence', () => {
    const a = item(1, 'first', '2024-01-01T00:00:00.000Z');
    const b = item(2, 'second', '2024-01-01T00:00:00.000Z');
    const full = set({
      id: 'koag',
      name: 'Koag',
      items: [b, a],
      createdAt: '2024-01-01T00:00:00.000Z',
      orderUpdatedAt: '2024-01-01T00:00:00.000Z',
    });
    const emptyNewer = set({
      id: 'koag',
      name: 'Koag',
      items: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      orderUpdatedAt: '2024-08-11T21:00:00.000Z',
    });
    const merged = pickBetterQuizSet(full, emptyNewer);
    expect(merged.items.map((i) => i.id)).toEqual([2, 1]);
  });
});

describe('Manual set-list order across union / ById shells', () => {
  const stamp = (id: string, name: string, listAt: string) =>
    set({
      id,
      name,
      items: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      listOrderUpdatedAt: listAt,
    });

  it('orderQuizSetsByListAuthority prefers newer listOrderUpdatedAt source', () => {
    const manual = [
      stamp('serum', 'Serum & Plasma', '2026-08-12T01:00:00.000Z'),
      stamp('abl', 'ABL', '2026-08-12T01:00:00.000Z'),
      stamp('koag', 'Koagulationsstatus', '2026-08-12T01:00:00.000Z'),
    ];
    const byIdScrambled = [
      stamp('koag', 'Koagulationsstatus', '2026-01-01T00:00:00.000Z'),
      stamp('abl', 'ABL', '2026-01-01T00:00:00.000Z'),
      stamp('serum', 'Serum & Plasma', '2026-01-01T00:00:00.000Z'),
    ];
    const ordered = orderQuizSetsByListAuthority(byIdScrambled, byIdScrambled, manual);
    expect(ordered.map((s) => s.id)).toEqual(['serum', 'abl', 'koag']);
  });

  it('unionQuizSetsForCommit does not lock ById Object.values order over Manual array', () => {
    const manual = [
      stamp('serum', 'Serum & Plasma', '2026-08-12T01:00:00.000Z'),
      stamp('abl', 'ABL', '2026-08-12T01:00:00.000Z'),
      stamp('tb', 'Tuberkulos', '2026-08-12T01:00:00.000Z'),
      stamp('neuro', 'Neuroborrelios', '2026-08-12T01:00:00.000Z'),
      stamp('koag', 'Koagulationsstatus', '2026-08-12T01:00:00.000Z'),
    ];
    // Structure-first ById paint (Object.values) — wrong order, older stamps.
    const byId = [
      stamp('abl', 'ABL', '2026-01-01T00:00:00.000Z'),
      stamp('koag', 'Koagulationsstatus', '2026-01-01T00:00:00.000Z'),
      stamp('neuro', 'Neuroborrelios', '2026-01-01T00:00:00.000Z'),
      stamp('serum', 'Serum & Plasma', '2026-01-01T00:00:00.000Z'),
      stamp('tb', 'Tuberkulos', '2026-01-01T00:00:00.000Z'),
    ];
    // Classic regression: painted ById first, then array arrives as secondary.
    const afterByIdPaint = unionQuizSetsForCommit(byId);
    expect(afterByIdPaint.map((s) => s.id)).toEqual(byId.map((s) => s.id));
    const afterArray = unionQuizSetsForCommit(afterByIdPaint, manual);
    expect(afterArray.map((s) => s.id)).toEqual(manual.map((s) => s.id));
  });

  it('preferRicher reorders when secondary has newer listOrderUpdatedAt', () => {
    const painted = [
      stamp('koag', 'Koagulationsstatus', '2026-01-01T00:00:00.000Z'),
      stamp('serum', 'Serum & Plasma', '2026-01-01T00:00:00.000Z'),
    ];
    const cloud = [
      stamp('serum', 'Serum & Plasma', '2026-08-12T01:30:00.000Z'),
      stamp('koag', 'Koagulationsstatus', '2026-08-12T01:30:00.000Z'),
    ];
    const merged = preferRicherQuizSetsMembership(painted, cloud);
    expect(merged.map((s) => s.id)).toEqual(['serum', 'koag']);
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

  it('does not resurrect a soft-deleted question from a live durable copy', () => {
    const sets: QuizSet[] = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(12, 'تجربة ٢', '2026-08-12T01:20:00.000Z', {
            trashed: true,
            deletedAt: '2026-08-12T01:20:00.000Z',
          }),
          item(14, 'keep', '2026-08-12T00:00:00.000Z'),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    const quizzes = [
      item(12, 'تجربة ٢', '2026-08-12T01:20:00.000Z', {
        trashed: true,
        deletedAt: '2026-08-12T01:20:00.000Z',
      }),
    ];
    const durable: StoredQuizItem[] = [
      { ...item(12, 'تجربة ٢', '2026-08-12T01:20:00.000Z'), setId: 's1' },
    ];
    const { sets: nextSets, quizzes: nextQuizzes } = applyDurableQuizItems(quizzes, sets, durable);
    expect(nextSets[0].items.find((i) => i.id === 12)?.trashed).toBe(true);
    expect(nextQuizzes.find((q) => q.id === 12)?.trashed).toBe(true);
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

  it('sources with 11, 9, and 4 → result 11 (Koagulationsstatus regression)', () => {
    const four = Array.from({ length: 4 }, (_, i) =>
      item(i + 1, `Q${i + 1}-short`, '2026-08-12T00:20:00.000Z'),
    );
    const shellFour = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: four,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-12T00:28:00.000Z',
      }),
    ];
    const merged = unionQuizSetsForCommit(shellFour, localNine, byIdEleven);
    expect(merged[0].items.filter((i) => !i.trashed)).toHaveLength(11);
    expect(countLiveQuizItems(merged)).toBe(11);
    expect(quizSetsMembershipShrunk(byIdEleven, merged)).toBe(false);
  });

  it('max-known floor blocks short LS write after richer paint', () => {
    const maxKnown = new Map<string, number>();
    bumpMaxKnownLiveBySet(maxKnown, byIdEleven);
    expect(maxKnown.get('koag')).toBe(11);
    const short = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: nine.slice(0, 4),
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-12T00:28:00.000Z',
      }),
    ];
    expect(isQuizSetsLocalWriteSafe(short, maxKnown, byIdEleven)).toBe(false);
    const restored = enforceMaxKnownLiveMembership(short, maxKnown, byIdEleven, localNine);
    expect(restored[0].items.filter((i) => !i.trashed)).toHaveLength(11);
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

  it('empty local shell never blocks cloud/ById set-list hydrate (0-set emergency)', () => {
    const cloudSets = [
      set({ id: 'abl', name: 'ABL', items: [item(1, 'q', '2026-01-01T00:00:00.000Z')], createdAt: '2026-01-01T00:00:00.000Z' }),
      set({ id: 'koag', name: 'Koagulationsstatus', items: [], createdAt: '2026-01-01T00:00:00.000Z' }),
      set({ id: 'serum', name: 'Serum & Plasma', items: [], createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const merged = unionQuizSetsForCommit([], cloudSets);
    expect(merged.map((s) => s.id).sort()).toEqual(['abl', 'koag', 'serum']);
    // Refs already equal next, but painted UI is [] → must hydrate React.
    expect(shouldHydrateQuizSetsUi([], merged)).toBe(true);
    expect(shouldHydrateQuizSetsUi([], [])).toBe(false);
    expect(shouldHydrateQuizSetsUi(merged, merged.slice(0, 1))).toBe(false);
  });

  it('decideQuizListsUiPaint skips same-id older/equal HTML echoes after authoritative ById', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [item(1, '<p>current</p>', '2026-01-02T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const staleEcho = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
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
      nextSets: staleEcho,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    });
    expect(decision).toEqual({ paint: false, reason: 'skip' });
    expect(quizListsStructuralUiChanged(painted, staleEcho)).toBe(false);
  });

  it('decideQuizListsUiPaint allows strictly newer item bodies after authoritative ById', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [item(1, '<p>old</p>', '2026-01-01T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const newerHtml = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [item(1, '<p>new</p>', '2026-01-02T00:00:00.000Z')],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets: painted,
      nextSets: newerHtml,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    })).toEqual({ paint: true, reason: 'content-changed' });
  });

  it('decideQuizListsUiPaint still allows soft-delete and Manual order after ById', () => {
    const painted = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [
          item(1, '<p>a</p>', '2026-01-01T00:00:00.000Z'),
          item(2, '<p>b</p>', '2026-01-01T00:00:00.000Z'),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const deleted = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [
          { ...item(1, '<p>a</p>', '2026-01-01T00:00:00.000Z'), trashed: true },
          item(2, '<p>b</p>', '2026-01-01T00:00:00.000Z'),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const reordered = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: [
          item(2, '<p>b</p>', '2026-01-01T00:00:00.000Z'),
          item(1, '<p>a</p>', '2026-01-01T00:00:00.000Z'),
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(quizListsStructuralUiChanged(painted, deleted)).toBe(true);
    expect(quizListsStructuralUiChanged(painted, reordered)).toBe(true);
    expect(decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets: painted,
      nextSets: deleted,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    }).paint).toBe(true);
    expect(decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: false,
      seenAuthoritativeById: true,
      isAuthoritativeByIdMerge: false,
      paintedSets: painted,
      nextSets: reordered,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    }).paint).toBe(true);
  });

  it('decideQuizListsUiPaint allows ById catch-up after timeout reveal', () => {
    const localNine = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: Array.from({ length: 9 }, (_, i) => item(i + 1, `<p>q${i}</p>`, '2026-01-01T00:00:00.000Z')),
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const byIdEleven = [
      set({
        id: 'koag',
        name: 'Koagulationsstatus',
        items: Array.from({ length: 11 }, (_, i) => item(i + 1, `<p>cloud${i}</p>`, '2026-01-02T00:00:00.000Z')),
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const decision = decideQuizListsUiPaint({
      contentReady: true,
      revealedViaTimeout: true,
      seenAuthoritativeById: false,
      isAuthoritativeByIdMerge: true,
      paintedSets: localNine,
      nextSets: byIdEleven,
      paintedQuizzes: [],
      nextQuizzes: [],
      setsEqualForUI: quizSetsEqualForUI,
      quizzesEqualForUI: quizzesEqualForUI,
    });
    expect(decision).toEqual({ paint: true, reason: 'byid-catchup' });
  });
});

describe('soft-deleted quiz items survive richer ById union', () => {
  it('tombstone keeps deleted questions trashed after union with live ById shell', () => {
    const liveById = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(12, 'تجربة ٢', '2026-08-12T00:30:20.000Z'),
          item(13, 'تجربة ٣', '2026-08-12T01:15:42.000Z'),
          item(14, 'keep', '2026-08-12T00:00:00.000Z'),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T01:00:00.000Z',
      }),
    ];
    const afterDelete = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(12, 'تجربة ٢', '2026-08-12T01:20:00.000Z', {
            trashed: true,
            deletedAt: '2026-08-12T01:20:00.000Z',
          }),
          item(13, 'تجربة ٣', '2026-08-12T01:20:00.000Z', {
            trashed: true,
            deletedAt: '2026-08-12T01:20:00.000Z',
          }),
          item(14, 'keep', '2026-08-12T00:00:00.000Z'),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T01:20:00.000Z',
      }),
    ];
    const tombstones = {
      '12': Date.parse('2026-08-12T01:20:00.000Z'),
      '13': Date.parse('2026-08-12T01:20:00.000Z'),
    };

    const unioned = unionQuizSetsForCommit(afterDelete, liveById);
    const honored = applyQuizItemTrashTombstonesToSets(unioned, tombstones);
    expect(honored[0].items.filter((i) => !i.trashed).map((i) => i.id)).toEqual([14]);
    expect(honored[0].items.find((i) => i.id === 12)?.trashed).toBe(true);
    expect(honored[0].items.find((i) => i.id === 13)?.trashed).toBe(true);
    expect(countLiveQuizItems(honored)).toBe(1);
  });

  it('tombstone keeps a question trashed even if last-good/ById live copy is newer', () => {
    const liveNewer = [
      set({
        id: 's1',
        name: 'Set',
        items: [item(12, 'تجربة ٢', '2026-08-12T02:00:00.000Z')],
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    const tombstones = { '12': Date.parse('2026-08-12T01:20:00.000Z') };
    const honored = applyQuizItemTrashTombstonesToSets(liveNewer, tombstones);
    expect(honored[0].items.find((i) => i.id === 12)?.trashed).toBe(true);
    expect(countLiveQuizItems(honored)).toBe(0);
  });

  it('pickBetterQuizSet honors softTrashQuizItems against newer-looking live copy', () => {
    const local = set({
      id: 's1',
      name: 'Set',
      items: [
        item(2, 'gone', '2026-08-12T01:20:00.000Z', { trashed: true, deletedAt: '2026-08-12T01:20:00.000Z' }),
        item(1, 'keep', '2026-08-12T00:00:00.000Z'),
      ],
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T01:20:00.000Z',
    });
    const remote = set({
      id: 's1',
      name: 'Set',
      items: [
        item(2, 'gone-live', '2026-08-12T00:30:00.000Z'),
        item(1, 'keep', '2026-08-12T00:00:00.000Z'),
      ],
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T01:00:00.000Z',
    });
    const merged = pickBetterQuizSet(local, remote, { softTrashQuizItems: [2] });
    expect(merged.items.find((i) => i.id === 2)?.trashed).toBe(true);
    expect(merged.items.filter((i) => !i.trashed)).toHaveLength(1);
  });

  it('allows local write when live count drops only via soft-trash tombstones', () => {
    const painted = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(1, 'a', '2026-08-12T00:00:00.000Z'),
          item(2, 'b', '2026-08-12T00:00:00.000Z'),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    const afterTrash = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(1, 'a', '2026-08-12T00:00:00.000Z'),
          item(2, 'b', '2026-08-12T01:00:00.000Z', { trashed: true, deletedAt: '2026-08-12T01:00:00.000Z' }),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T01:00:00.000Z',
      }),
    ];
    const maxKnown = new Map<string, number>([['s1', 2]]);
    expect(quizSetsSoftTrashExplainsShrink(painted, afterTrash)).toBe(true);
    expect(isQuizSetsLocalWriteSafe(afterTrash, maxKnown, painted)).toBe(true);
    expect(quizSetsMembershipShrunk(painted, afterTrash)).toBe(true);
  });

  it('still blocks incomplete shells that omit ids entirely', () => {
    const painted = [
      set({
        id: 's1',
        name: 'Set',
        items: [
          item(1, 'a', '2026-08-12T00:00:00.000Z'),
          item(2, 'b', '2026-08-12T00:00:00.000Z'),
        ],
        createdAt: '2026-08-12T00:00:00.000Z',
      }),
    ];
    const shortShell = [
      set({
        id: 's1',
        name: 'Set',
        items: [item(1, 'a', '2026-08-12T00:00:00.000Z')],
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T02:00:00.000Z',
      }),
    ];
    const maxKnown = new Map<string, number>([['s1', 2]]);
    expect(quizSetsSoftTrashExplainsShrink(painted, shortShell)).toBe(false);
    expect(isQuizSetsLocalWriteSafe(shortShell, maxKnown, painted)).toBe(false);
  });
});
