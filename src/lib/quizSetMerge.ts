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

/** Live (non-trashed) item count — used to detect incomplete cloud snapshots. */
export function countLiveQuizItems(sets: QuizSet[]): number {
  return sets.reduce(
    (sum, set) => sum + (set.items ?? []).filter((item) => item && !item.trashed).length,
    0,
  );
}
