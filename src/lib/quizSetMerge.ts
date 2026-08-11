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

function quizSetOrderTime(set: QuizSet) {
  return Date.parse(set.orderUpdatedAt || '') || 0;
}

function quizSetListOrderTime(set: QuizSet) {
  return Date.parse(set.listOrderUpdatedAt || '') || 0;
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
 * Union quiz items by id (notes-style). Order comes from the authority side;
 * missing ids from the other side are appended — never dropped.
 */
export function mergeQuizItemsUnion(
  local: QuizItem[],
  remote: QuizItem[],
  opts?: {
    permanentlyDeletedIds?: Iterable<number>;
    orderFrom?: 'local' | 'remote';
  },
): QuizItem[] {
  const dead = new Set(opts?.permanentlyDeletedIds ?? []);
  const remoteIds = new Set(remote.map((item) => item.id));
  const map = new Map<number, QuizItem>();
  for (const item of local) {
    if (dead.has(item.id)) continue;
    // Local-only trashed row omitted from remote: drop (ghost after Empty Trash
    // style cleanup is handled by callers). Keep pending soft-deletes that still
    // need to sync — only skip when remote already lacks a non-trashed twin and
    // this row is trashed AND we are not trying to propagate deletes... Notes
    // skip local-only trashed when missing from remote; match that.
    if (!remoteIds.has(item.id) && item.trashed) continue;
    map.set(item.id, item);
  }
  for (const item of remote) {
    if (dead.has(item.id)) continue;
    const existing = map.get(item.id);
    map.set(item.id, existing ? pickNewerQuizItem(existing, item) : item);
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
  const preferRemoteOrder = quizSetOrderTime(remote) > quizSetOrderTime(local);
  const items = mergeQuizItemsUnion(
    local.items ?? [],
    remote.items ?? [],
    {
      permanentlyDeletedIds: tombstones.quizzes,
      orderFrom: preferRemoteOrder ? 'remote' : 'local',
    },
  );
  const orderUpdatedAt = preferRemoteOrder
    ? (remote.orderUpdatedAt ?? local.orderUpdatedAt)
    : (local.orderUpdatedAt ?? remote.orderUpdatedAt);
  const preferRemoteListOrder = quizSetListOrderTime(remote) > quizSetListOrderTime(local);
  const listOrderUpdatedAt = preferRemoteListOrder
    ? (remote.listOrderUpdatedAt ?? local.listOrderUpdatedAt)
    : (local.listOrderUpdatedAt ?? remote.listOrderUpdatedAt);
  const withItems = orderUpdatedAt ? { ...base, items, orderUpdatedAt } : { ...base, items };
  return listOrderUpdatedAt ? { ...withItems, listOrderUpdatedAt } : withItems;
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
 * Metadata/order come from `primary` (array / latest merge); never drop live
 * items that only exist on a secondary source (ById / lastPainted / IDB).
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
  return ordered;
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
 * Notes-like commit helper: union incoming with known richer sources, then
 * callers always setState. Never drop live set/item ids present on either side.
 */
export function unionQuizSetsForCommit(
  incoming: QuizSet[],
  ...richerSources: QuizSet[][]
): QuizSet[] {
  const unioned = preferRicherQuizSetsMembership(incoming, ...richerSources);
  const byIdSources = richerSources.filter((src) => src.length > 0);
  if (!byIdSources.length) return unioned;
  return adoptByIdMembershipWhenRicher(unioned, preferRicherQuizSetsMembership([], ...byIdSources));
}
