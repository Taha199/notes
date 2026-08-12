/**
 * Quiz-set merge helpers — aligned with notes ById union semantics.
 *
 * CRITICAL: never let a shorter items[] win just because the parent set has a
 * newer updatedAt. Intentional removes are soft-trash / permanent-delete
 * tombstones on the item itself (same pattern as notes).
 */
import type { QuizItem, QuizSet } from '../types';

export function quizItemSyncTime(item: QuizItem) {
  return Date.parse(item.updatedAt || item.createdAt || '') || 0;
}

export function quizSetSyncTime(set: { updatedAt?: string; createdAt?: string; savedAt?: string }) {
  return Date.parse(set.updatedAt || set.savedAt || set.createdAt || '') || 0;
}

export function quizSetOrderTime(set: QuizSet) {
  return Date.parse(set.orderUpdatedAt || '') || 0;
}

export function quizSetListOrderTime(set: QuizSet) {
  return Date.parse(set.listOrderUpdatedAt || '') || 0;
}

/** Item ids in Manual order — from itemsOrder stamp or live items[]. */
export function quizSetItemsOrderIds(set: QuizSet): number[] {
  if (set.itemsOrder?.length) return set.itemsOrder.slice();
  return (set.items ?? []).map((item) => item.id);
}

/** Re-sequence items by an id list; unknown ids append in prior relative order. */
export function applyQuizItemsOrder(items: QuizItem[], orderIds?: number[] | null): QuizItem[] {
  if (!orderIds?.length || !items.length) return items;
  const map = new Map(items.map((item) => [item.id, item]));
  const ordered: QuizItem[] = [];
  const seen = new Set<number>();
  for (const id of orderIds) {
    const item = map.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }
  for (const item of items) {
    if (seen.has(item.id)) continue;
    ordered.push(item);
    seen.add(item.id);
  }
  return ordered;
}

function setHasItemSequence(set: QuizSet): boolean {
  return (set.itemsOrder?.length ?? 0) > 0 || (set.items?.length ?? 0) > 0;
}

/** Prefer real Q/A bodies over empty shells when order stamps tie. */
function itemSequenceAuthorityScore(set: QuizSet): number {
  const items = set.items ?? [];
  const withContent = items.filter(
    (item) => String(item.question || '').trim() || String(item.answer || '').trim(),
  ).length;
  const orderLen = Math.max(items.length, set.itemsOrder?.length ?? 0);
  return withContent * 1_000_000 + orderLen;
}

/**
 * Reorder a membership-unioned set list using the source with the newest
 * max(listOrderUpdatedAt). Ties keep the earliest source (callers pass primary first).
 * Never falls back to createdAt/id — unstamped sources leave `membership` order as-is.
 */
export function orderQuizSetsByListAuthority(
  membership: QuizSet[],
  ...sources: QuizSet[][]
): QuizSet[] {
  if (!membership.length) return membership;
  const map = new Map(membership.map((set) => [set.id, set]));
  let bestSource: QuizSet[] | null = null;
  let bestTime = 0;
  for (const src of sources) {
    if (!src?.length) continue;
    const t = Math.max(0, ...src.map((set) => quizSetListOrderTime(set)));
    if (t > bestTime) {
      bestTime = t;
      bestSource = src;
    }
  }
  if (!bestSource || bestTime <= 0) return membership;
  const ordered: QuizSet[] = [];
  const seen = new Set<string>();
  for (const set of bestSource) {
    const merged = map.get(set.id);
    if (!merged || seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  for (const merged of membership) {
    if (seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  return ordered;
}

export function pickNewerQuizItem(a: QuizItem, b: QuizItem): QuizItem {
  if (!!a.trashed !== !!b.trashed) {
    const trashed = a.trashed ? a : b;
    const live = a.trashed ? b : a;
    // Soft-delete wins unless a restore/edit is strictly newer.
    return quizItemSyncTime(live) > quizItemSyncTime(trashed) ? live : trashed;
  }
  return quizItemSyncTime(b) >= quizItemSyncTime(a) ? b : a;
}

/**
 * Force `trashed: true` onto quiz items with an active soft-delete tombstone.
 * Mirrors set/folder quizTrash markers so union-keep / richer ById shells cannot
 * resurrect a question the user already deleted.
 * Tombstone timestamps are ms; a strictly newer live updatedAt (restore/edit) wins.
 */
export function applyQuizItemTrashTombstones(
  items: QuizItem[],
  tombstones: Record<string, number>,
  opts?: { emptiedAt?: number; deletedAt?: string },
): QuizItem[] {
  if (!items.length || !tombstones || !Object.keys(tombstones).length) return items;
  const emptiedAt = opts?.emptiedAt ?? 0;
  let changed = false;
  const next = items.map((item) => {
    const at = tombstones[String(item.id)];
    if (at === undefined || item.trashed) return item;
    if (emptiedAt && at <= emptiedAt) return item;
    if (at < quizItemSyncTime(item)) return item;
    changed = true;
    if (item.deletedAt || !opts?.deletedAt) return { ...item, trashed: true };
    return { ...item, trashed: true, deletedAt: opts.deletedAt };
  });
  return changed ? next : items;
}

/** Apply item soft-trash tombstones inside every set's items[]. */
export function applyQuizItemTrashTombstonesToSets(
  sets: QuizSet[],
  tombstones: Record<string, number>,
  opts?: { emptiedAt?: number; deletedAt?: string },
): QuizSet[] {
  if (!sets.length || !tombstones || !Object.keys(tombstones).length) return sets;
  let changed = false;
  const next = sets.map((set) => {
    const items = applyQuizItemTrashTombstones(set.items ?? [], tombstones, opts);
    if (items === (set.items ?? [])) return set;
    changed = true;
    return { ...set, items };
  });
  return changed ? next : sets;
}

/**
 * Union quiz items by id (notes-style). Order comes from the authority side;
 * missing ids from the other side are appended — never dropped.
 */
export function mergeQuizItemsUnion(
  local: QuizItem[],
  remote: QuizItem[],
  opts?: {
    permanentlyDeletedIds?: Iterable<number>;
    /** Soft-trash markers — keep local-only trashed rows so merge cannot drop the tombstone. */
    softTrashTombstoneIds?: Iterable<number | string>;
    orderFrom?: 'local' | 'remote';
  },
): QuizItem[] {
  const dead = new Set(opts?.permanentlyDeletedIds ?? []);
  const softTrash = new Set(
    [...(opts?.softTrashTombstoneIds ?? [])].map((id) => Number(id)).filter((id) => Number.isFinite(id)),
  );
  const remoteIds = new Set(remote.map((item) => item.id));
  const map = new Map<number, QuizItem>();
  for (const item of local) {
    if (dead.has(item.id)) continue;
    // Local-only trashed row omitted from remote: drop (ghost after Empty Trash
    // style cleanup is handled by callers). Keep pending soft-deletes that still
    // need to sync — and always keep rows with an active soft-trash tombstone.
    if (!remoteIds.has(item.id) && item.trashed && !softTrash.has(item.id)) continue;
    map.set(item.id, item);
  }
  for (const item of remote) {
    if (dead.has(item.id)) continue;
    const existing = map.get(item.id);
    let merged = existing ? pickNewerQuizItem(existing, item) : item;
    // Soft-trash tombstone always beats a stale live copy from a richer shell.
    if (softTrash.has(merged.id) && !merged.trashed) {
      const trashedSide = existing?.trashed ? existing : (item.trashed ? item : null);
      merged = trashedSide
        ? pickNewerQuizItem(trashedSide, { ...merged, trashed: true })
        : { ...merged, trashed: true };
    }
    map.set(item.id, merged);
  }
  const localMax = Math.max(0, ...local.map((item) => quizItemSyncTime(item)));
  const remoteMax = Math.max(0, ...remote.map((item) => quizItemSyncTime(item)));
  const resolvedOrder = opts?.orderFrom ?? (remoteMax >= localMax ? 'remote' : 'local');
  const orderSource = resolvedOrder === 'remote' ? remote : local;
  const ordered: QuizItem[] = [];
  const seen = new Set<number>();
  for (const item of orderSource) {
    const merged = map.get(item.id);
    if (!merged || seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  for (const merged of map.values()) {
    if (seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  return ordered;
}

export type QuizSetMergeTombstones = {
  quizzes?: Iterable<number>;
  quizSets?: Iterable<string>;
  /** Soft-trash item ids (quizTrash/items) — must not reappear as live. */
  softTrashQuizItems?: Iterable<number | string>;
};

/**
 * Pick the better of two quiz-set rows.
 * Metadata (name/folder/color/trash) is LWW on set.updatedAt.
 * Items are always unioned by id — a stale/partial shorter items[] must never
 * clobber a fuller side just because the parent stamp is newer.
 */
export function pickBetterQuizSet(
  local: QuizSet,
  remote: QuizSet,
  tombstones: QuizSetMergeTombstones = {},
): QuizSet {
  if (!!local.trashed !== !!remote.trashed) {
    if (remote.trashed && !String(remote.name || '').trim() && String(local.name || '').trim() && !local.trashed) {
      return local;
    }
    if (local.trashed && !String(local.name || '').trim() && String(remote.name || '').trim() && !remote.trashed) {
      return remote;
    }
    const trashedSide = local.trashed ? local : remote;
    const liveSide = local.trashed ? remote : local;
    return quizSetSyncTime(liveSide) > quizSetSyncTime(trashedSide) ? liveSide : trashedSide;
  }

  // Metadata LWW — Manual in-set order uses orderUpdatedAt; list order uses
  // listOrderUpdatedAt. Neither may decide item membership.
  const remoteMetaNewer = quizSetSyncTime(remote) >= quizSetSyncTime(local);
  const base = remoteMetaNewer ? remote : local;
  const localOrderTime = quizSetOrderTime(local);
  const remoteOrderTime = quizSetOrderTime(remote);
  let preferRemoteOrder = remoteOrderTime > localOrderTime;
  // Structure / IDB shells often keep a stamp but have items:[] (or only
  // itemsOrder). Never let an empty sequence clobber a side that still has one.
  if (preferRemoteOrder && !setHasItemSequence(remote) && setHasItemSequence(local)) {
    preferRemoteOrder = false;
  } else if (!preferRemoteOrder && !setHasItemSequence(local) && setHasItemSequence(remote)) {
    preferRemoteOrder = true;
  } else if (localOrderTime === remoteOrderTime && localOrderTime > 0) {
    // Equal Manual stamps: an explicit itemsOrder beats a scrambled items[]
    // rebuilt from durable Object.values / IDB (classic refresh reshuffle).
    const localExplicit = (local.itemsOrder?.length ?? 0) > 0;
    const remoteExplicit = (remote.itemsOrder?.length ?? 0) > 0;
    if (localExplicit !== remoteExplicit) {
      preferRemoteOrder = remoteExplicit;
    } else {
      // Both or neither explicit — prefer content-bearing sequences.
      preferRemoteOrder = itemSequenceAuthorityScore(remote) > itemSequenceAuthorityScore(local);
    }
  }
  const orderIds = preferRemoteOrder ? quizSetItemsOrderIds(remote) : quizSetItemsOrderIds(local);
  const items = applyQuizItemsOrder(
    mergeQuizItemsUnion(
      local.items ?? [],
      remote.items ?? [],
      {
        permanentlyDeletedIds: tombstones.quizzes,
        softTrashTombstoneIds: tombstones.softTrashQuizItems,
        orderFrom: preferRemoteOrder ? 'remote' : 'local',
      },
    ),
    orderIds,
  );
  const orderUpdatedAt = preferRemoteOrder
    ? (remote.orderUpdatedAt ?? local.orderUpdatedAt)
    : (local.orderUpdatedAt ?? remote.orderUpdatedAt);
  const preferRemoteListOrder = quizSetListOrderTime(remote) > quizSetListOrderTime(local);
  const listOrderUpdatedAt = preferRemoteListOrder
    ? (remote.listOrderUpdatedAt ?? local.listOrderUpdatedAt)
    : (local.listOrderUpdatedAt ?? remote.listOrderUpdatedAt);
  const itemsOrder = orderIds.length
    ? orderIds
    : (preferRemoteOrder
      ? (remote.itemsOrder ?? local.itemsOrder)
      : (local.itemsOrder ?? remote.itemsOrder));
  const withItems = orderUpdatedAt ? { ...base, items, orderUpdatedAt } : { ...base, items };
  const withList = listOrderUpdatedAt ? { ...withItems, listOrderUpdatedAt } : withItems;
  return itemsOrder?.length ? { ...withList, itemsOrder } : withList;
}

/** Live (non-trashed) item count for one set. */
export function countLiveItemsInSet(set: QuizSet | undefined | null): number {
  if (!set) return 0;
  return (set.items ?? []).filter((item) => item && !item.trashed).length;
}

/** Live (non-trashed) item count — used to detect incomplete cloud snapshots. */
export function countLiveQuizItems(sets: QuizSet[]): number {
  return sets.reduce((sum, set) => sum + countLiveItemsInSet(set), 0);
}

function liveItemIds(set: QuizSet | undefined | null): Set<number> {
  return new Set(
    (set?.items ?? []).filter((item) => item && !item.trashed).map((item) => item.id),
  );
}

/** Live (non-trashed, non-system) set ids — set-list growth, not just items. */
export function liveUserQuizSetIds(sets: QuizSet[]): Set<string> {
  return new Set(sets.filter((set) => set?.id && !set.trashed && !set.system).map((set) => set.id));
}

/** True when `next` gained any live set id or live item id vs `prev`. */
export function quizSetsMembershipGrew(prev: QuizSet[], next: QuizSet[]): boolean {
  if (countLiveQuizItems(next) > countLiveQuizItems(prev)) return true;
  const prevSetIds = liveUserQuizSetIds(prev);
  for (const id of liveUserQuizSetIds(next)) {
    if (!prevSetIds.has(id)) return true;
  }
  const prevById = new Map(prev.map((set) => [set.id, set]));
  for (const set of next) {
    const prior = prevById.get(set.id);
    const nextLive = liveItemIds(set);
    if (!prior) {
      if (nextLive.size > 0) return true;
      continue;
    }
    const prevLive = liveItemIds(prior);
    for (const id of nextLive) {
      if (!prevLive.has(id)) return true;
    }
  }
  return false;
}

/**
 * Order, membership, trash, or set metadata changed — not question/answer HTML alone.
 * Used so post-ById hydrates can still land Manual order / soft-deletes without
 * allowing classic same-id old→new body FOUC from weaker array echoes.
 */
export function quizListsStructuralUiChanged(prev: QuizSet[], next: QuizSet[]): boolean {
  if (quizSetsMembershipGrew(prev, next) || quizSetsMembershipShrunk(prev, next)) return true;
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i += 1) {
    const a = prev[i];
    const b = next[i];
    if (!a || !b) return true;
    if (a.id !== b.id) return true;
    if (a.name !== b.name) return true;
    if (a.folderId !== b.folderId) return true;
    if (!!a.trashed !== !!b.trashed) return true;
    if (a.color !== b.color) return true;
    const aItems = a.items ?? [];
    const bItems = b.items ?? [];
    if (aItems.length !== bItems.length) return true;
    for (let j = 0; j < aItems.length; j += 1) {
      if (aItems[j]?.id !== bItems[j]?.id) return true;
      if (!!aItems[j]?.trashed !== !!bItems[j]?.trashed) return true;
    }
  }
  return false;
}

/** True when any shared item id has a strictly newer updatedAt on `next`. */
export function quizListsHaveStrictlyNewerItems(prev: QuizSet[], next: QuizSet[]): boolean {
  const prevTimes = new Map<number, number>();
  for (const set of prev) {
    for (const item of set.items ?? []) {
      prevTimes.set(item.id, quizItemSyncTime(item));
    }
  }
  for (const set of next) {
    for (const item of set.items ?? []) {
      const prevT = prevTimes.get(item.id);
      if (prevT !== undefined && quizItemSyncTime(item) > prevT) return true;
    }
  }
  return false;
}

/** True when any shared set has a newer Manual / list-order stamp on `next`. */
export function quizListsHaveNewerOrderStamps(prev: QuizSet[], next: QuizSet[]): boolean {
  const prevById = new Map(prev.map((set) => [set.id, set]));
  for (const set of next) {
    const prior = prevById.get(set.id);
    if (!prior) continue;
    if (quizSetOrderTime(set) > quizSetOrderTime(prior)) return true;
    if (quizSetListOrderTime(set) > quizSetListOrderTime(prior)) return true;
  }
  return false;
}

/**
 * Decide whether merged quiz lists must reach React after a hydrate step.
 *
 * Membership growth (9→11) always paints. Same-id HTML flips are allowed on the
 * first authoritative ById catch-up after a timeout reveal, but skipped once an
 * authoritative body snapshot was already shown — without blocking later adds,
 * soft-deletes, Manual order, or strictly-newer item bodies / order stamps.
 */
export function decideQuizListsUiPaint(opts: {
  contentReady: boolean;
  revealedViaTimeout: boolean;
  seenAuthoritativeById: boolean;
  isAuthoritativeByIdMerge: boolean;
  /** Last lists actually passed to setQuizSets / setQuizzes (not just refs). */
  paintedSets: QuizSet[];
  nextSets: QuizSet[];
  paintedQuizzes: QuizItem[];
  nextQuizzes: QuizItem[];
  setsEqualForUI: (a: QuizSet[], b: QuizSet[]) => boolean;
  quizzesEqualForUI: (a: QuizItem[], b: QuizItem[]) => boolean;
}): { paint: boolean; reason: 'first-reveal' | 'byid-catchup' | 'membership-grew' | 'content-changed' | 'skip' } {
  const membershipGrew = quizSetsMembershipGrew(opts.paintedSets, opts.nextSets)
    || opts.nextQuizzes.length > opts.paintedQuizzes.length;
  const contentChanged = !opts.setsEqualForUI(opts.paintedSets, opts.nextSets)
    || !opts.quizzesEqualForUI(opts.paintedQuizzes, opts.nextQuizzes);

  if (!opts.contentReady) {
    return { paint: true, reason: 'first-reveal' };
  }
  // Timeout showed incomplete local (classic 9) — first ById must still land.
  if (opts.revealedViaTimeout && !opts.seenAuthoritativeById && opts.isAuthoritativeByIdMerge) {
    return { paint: true, reason: 'byid-catchup' };
  }
  if (membershipGrew) {
    return { paint: true, reason: 'membership-grew' };
  }
  // After an authoritative / last-good body reveal, skip same-id older HTML echoes
  // but still allow order / trash / strictly-newer bodies / order stamps.
  if (opts.seenAuthoritativeById) {
    if (quizListsStructuralUiChanged(opts.paintedSets, opts.nextSets)) {
      return { paint: true, reason: 'content-changed' };
    }
    if (quizListsHaveStrictlyNewerItems(opts.paintedSets, opts.nextSets)) {
      return { paint: true, reason: 'content-changed' };
    }
    if (quizListsHaveNewerOrderStamps(opts.paintedSets, opts.nextSets)) {
      return { paint: true, reason: 'content-changed' };
    }
    return { paint: false, reason: 'skip' };
  }
  if (contentChanged) {
    return { paint: true, reason: 'content-changed' };
  }
  return { paint: false, reason: 'skip' };
}

/**
 * True when any shared set id in `next` lost live item ids present in `prev`
 * (classic incomplete array/IDB shell overwriting richer ById).
 */
export function quizSetsMembershipShrunk(prev: QuizSet[], next: QuizSet[]): boolean {
  const nextById = new Map(next.map((set) => [set.id, set]));
  for (const set of prev) {
    const later = nextById.get(set.id);
    if (!later) continue;
    const prevLive = liveItemIds(set);
    const nextLive = liveItemIds(later);
    if (nextLive.size < prevLive.size) return true;
    for (const id of prevLive) {
      if (!nextLive.has(id)) return true;
    }
  }
  return false;
}

/**
 * Union item membership across sources for every set id.
 * Per-set metadata/items come from pickBetterQuizSet; the array sequence is
 * then re-ordered by max(listOrderUpdatedAt) across sources so ById
 * Object.values / structure-first shells cannot permanently lock Manual order.
 */
export function preferRicherQuizSetsMembership(
  primary: QuizSet[],
  ...richerSources: QuizSet[][]
): QuizSet[] {
  const byId = new Map<string, QuizSet>();
  for (const set of primary) {
    if (!set?.id) continue;
    byId.set(set.id, { ...set, items: set.items ?? [] });
  }
  for (const source of richerSources) {
    for (const set of source) {
      if (!set?.id) continue;
      const existing = byId.get(set.id);
      byId.set(
        set.id,
        existing
          ? pickBetterQuizSet(existing, { ...set, items: set.items ?? [] })
          : { ...set, items: set.items ?? [] },
      );
    }
  }
  const ordered: QuizSet[] = [];
  const seen = new Set<string>();
  for (const set of primary) {
    const merged = byId.get(set.id);
    if (!merged || seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  for (const merged of byId.values()) {
    if (seen.has(merged.id)) continue;
    ordered.push(merged);
    seen.add(merged.id);
  }
  return orderQuizSetsByListAuthority(ordered, primary, ...richerSources);
}

/**
 * When giant `quizSets[]` has fewer live items than ById for the same id,
 * ignore array membership for that set (keep array meta/order authority via
 * pickBetterQuizSet base) — notes-style ById authority for bodies+membership.
 */
export function adoptByIdMembershipWhenRicher(
  arraySets: QuizSet[],
  byIdSets: QuizSet[],
): QuizSet[] {
  if (!byIdSets.length) return arraySets;
  const byIdMap = new Map(byIdSets.map((set) => [set.id, set]));
  return arraySets.map((set) => {
    const byId = byIdMap.get(set.id);
    if (!byId) return set;
    if (countLiveItemsInSet(byId) <= countLiveItemsInSet(set)) {
      // Still union in case ById holds different ids at equal count.
      return pickBetterQuizSet(set, byId);
    }
    // Prefer ById membership; keep array meta when newer via pickBetterQuizSet.
    return pickBetterQuizSet(byId, set);
  });
}

/**
 * Monotonic high-water mark of live items per set id. Only grows.
 * Survives short shells arriving later in the same session.
 */
export function bumpMaxKnownLiveBySet(
  maxKnown: Map<string, number>,
  sets: QuizSet[],
): void {
  for (const set of sets) {
    if (!set?.id) continue;
    const live = countLiveItemsInSet(set);
    const prev = maxKnown.get(set.id) ?? 0;
    if (live > prev) maxKnown.set(set.id, live);
  }
}

/**
 * If any set fell below its max-known live count, restore membership from
 * recovery sources (painted / ById / ref / IDB). Never invents items — only
 * reattaches ones still present on a durable source.
 */
export function enforceMaxKnownLiveMembership(
  sets: QuizSet[],
  maxKnown: Map<string, number>,
  ...recoverySources: QuizSet[][]
): QuizSet[] {
  return sets.map((set) => {
    const known = maxKnown.get(set.id) ?? 0;
    if (countLiveItemsInSet(set) >= known) return set;
    const recoveries = recoverySources.map((src) => {
      const row = src.find((s) => s.id === set.id);
      return row ? [row] : [];
    });
    return preferRicherQuizSetsMembership([set], ...recoveries)[0] ?? set;
  });
}

/**
 * True when every live id lost from `prev` → `next` still exists on `next` as
 * `trashed` (intentional soft-delete). Incomplete shells that omit ids fail.
 */
export function quizSetsSoftTrashExplainsShrink(prev: QuizSet[], next: QuizSet[]): boolean {
  const nextById = new Map(next.map((set) => [set.id, set]));
  let sawShrink = false;
  for (const set of prev) {
    const later = nextById.get(set.id);
    if (!later) continue;
    const prevLive = liveItemIds(set);
    const nextLive = liveItemIds(later);
    for (const id of prevLive) {
      if (nextLive.has(id)) continue;
      sawShrink = true;
      const row = (later.items ?? []).find((item) => item.id === id);
      if (!row?.trashed) return false;
    }
  }
  return sawShrink;
}

/** True when writing `sets` would not poison LS / cloud below max-known or last painted. */
export function isQuizSetsLocalWriteSafe(
  sets: QuizSet[],
  maxKnown: Map<string, number>,
  lastPainted: QuizSet[] = [],
): boolean {
  for (const [id, maxLive] of maxKnown.entries()) {
    const row = sets.find((s) => s.id === id);
    if (row && countLiveItemsInSet(row) < maxLive) {
      // Soft-delete inside the set is allowed to land below a stale max-known
      // floor when the lost live ids are present as trashed tombstones.
      if (!lastPainted.length || !quizSetsSoftTrashExplainsShrink(lastPainted, sets)) {
        return false;
      }
      continue;
    }
  }
  if (
    lastPainted.length
    && quizSetsMembershipShrunk(lastPainted, sets)
    && !quizSetsMembershipGrew(lastPainted, sets)
  ) {
    return quizSetsSoftTrashExplainsShrink(lastPainted, sets);
  }
  return true;
}

/**
 * Whether React must receive `next` for the set list.
 *
 * CRITICAL: compare against last *painted UI*, never against refs. Boot paths
 * often pre-update quizSetsRef before commit; comparing equal-to-refs then
 * skips setQuizSets and leaves the UI stuck at [] while folders still render
 * (classic "0 set" emergency). Empty painted UI must always accept non-empty
 * cloud/ById/IDB — empty local is zero membership, not authority.
 */
export function shouldHydrateQuizSetsUi(
  painted: QuizSet[],
  next: QuizSet[],
): boolean {
  if (!next.length) return false;
  // Empty painted UI must always accept non-empty cloud/ById/IDB.
  if (!painted.length) return true;
  if (quizSetsMembershipGrew(painted, next)) return true;
  const paintedLiveSets = liveUserQuizSetIds(painted).size;
  const nextLiveSets = liveUserQuizSetIds(next).size;
  // Losing live set ids (or live items on a shared id) without any growth = no paint.
  if (
    (nextLiveSets < paintedLiveSets || quizSetsMembershipShrunk(painted, next))
    && !quizSetsMembershipGrew(painted, next)
  ) {
    return false;
  }
  // Same or reordered membership — caller may still equalForUI-gate setState.
  return true;
}

/**
 * Notes-like commit helper: union incoming with known richer sources.
 * Membership = max across all sides; short shells cannot hide richer ById/local.
 * Empty incoming never suppresses non-empty richer sources (set-list or items).
 */
export function unionQuizSetsForCommit(
  incoming: QuizSet[],
  ...richerSources: QuizSet[][]
): QuizSet[] {
  const allSources = [incoming, ...richerSources].filter((src) => src.length > 0);
  if (!allSources.length) return incoming;
  // Empty local/incoming is not authority — membership seed from the richest
  // non-empty source so cloud/ById set-list membership always lands when LS is [].
  // Final array order still comes from max(listOrderUpdatedAt) across sources.
  const primary = incoming.length > 0
    ? incoming
    : (allSources.reduce((best, src) => (
      liveUserQuizSetIds(src).size > liveUserQuizSetIds(best).size ? src : best
    ), allSources[0]));
  const unioned = preferRicherQuizSetsMembership(primary, ...allSources);
  // Adopt the richest membership among ALL sources (array + ById + local + IDB).
  // Critical: do not treat only "secondary" args as ById — a short incoming
  // array must still yield to a richer secondary, and vice versa.
  const richest = preferRicherQuizSetsMembership([], ...allSources);
  const adopted = adoptByIdMembershipWhenRicher(unioned, richest);
  return orderQuizSetsByListAuthority(adopted, incoming, ...richerSources, unioned, richest);
}
