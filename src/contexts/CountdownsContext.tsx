import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ref as dbRef, remove, set } from 'firebase/database';
import type { CountdownBackground, CountdownFormat, CountdownItem, CountdownRepeat } from '../types';
import { useAuth } from './AuthContext';
import { database } from '../lib/firebase';
import { rtdbFetch } from '../lib/rtdb';
import {
  COUNTDOWNS_DELETED_LS_KEY,
  COUNTDOWNS_LS_KEY,
  COUNTDOWNS_UID_KEY,
  DEFAULT_COUNTDOWN_FORMAT,
  HEADER_COUNTDOWN_LS_KEY,
  mergeCountdowns,
  normalizeCountdown,
  readCountdownsLocal,
  readDeletedCountdownIds,
  readHeaderCountdownId,
  writeCountdownsLocal,
  writeDeletedCountdownIds,
  writeHeaderCountdownId,
} from '../lib/countdownStore';

interface CountdownDraft {
  title: string;
  targetAt: string;
  repeat: CountdownRepeat;
  format: CountdownFormat;
  textShadow: boolean;
  background: CountdownBackground;
}

interface CountdownsContextValue {
  countdowns: CountdownItem[];
  headerCountdownId: string | null;
  setHeaderCountdownId: (id: string | null) => void;
  addCountdown: (draft: CountdownDraft) => CountdownItem;
  updateCountdown: (id: string, draft: Partial<CountdownDraft>) => void;
  deleteCountdown: (id: string) => void;
}

const CountdownsContext = createContext<CountdownsContextValue | null>(null);

function newId() {
  return `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloudPath(uid: string, id?: string) {
  return id ? `users/${uid}/countdowns/${id}` : `users/${uid}/countdowns`;
}

async function fetchCloudCountdowns(uid: string): Promise<CountdownItem[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/countdowns`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, unknown>)
      .map(normalizeCountdown)
      .filter((row): row is CountdownItem => !!row);
  } catch {
    return [];
  }
}

async function fetchHeaderCountdownId(uid: string): Promise<string | null> {
  try {
    const res = await rtdbFetch(`/users/${uid}/profile`);
    if (!res.ok) return null;
    const data = (await res.json()) as { headerCountdownId?: unknown } | null;
    const id = typeof data?.headerCountdownId === 'string' ? data.headerCountdownId.trim() : '';
    return id || null;
  } catch {
    return null;
  }
}

function persistCountdownCloud(uid: string | null | undefined, item: CountdownItem) {
  if (!uid) return;
  void set(dbRef(database, cloudPath(uid, item.id)), item).catch(() => {
    void rtdbFetch(`/users/${uid}/countdowns/${item.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    }).catch(() => {});
  });
}

function removeCountdownCloud(uid: string | null | undefined, id: string) {
  if (!uid) return;
  void remove(dbRef(database, cloudPath(uid, id))).catch(() => {
    void rtdbFetch(`/users/${uid}/countdowns/${id}`, { method: 'DELETE' }).catch(() => {});
  });
}

function persistHeaderCountdownId(uid: string | null | undefined, id: string | null) {
  if (!uid) return;
  void rtdbFetch(`/users/${uid}/profile`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headerCountdownId: id }),
  }).catch(() => {});
}

export function CountdownsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [countdowns, setCountdowns] = useState<CountdownItem[]>(() => readCountdownsLocal());
  const [headerCountdownId, setHeaderCountdownIdState] = useState<string | null>(() => readHeaderCountdownId());
  const countdownsRef = useRef(countdowns);
  countdownsRef.current = countdowns;
  const headerCountdownIdRef = useRef(headerCountdownId);
  headerCountdownIdRef.current = headerCountdownId;
  const deletedRef = useRef<string[]>(readDeletedCountdownIds());

  const commitHeaderCountdownId = useCallback((id: string | null, uid?: string | null) => {
    headerCountdownIdRef.current = id;
    setHeaderCountdownIdState(id);
    writeHeaderCountdownId(id);
    persistHeaderCountdownId(uid ?? user?.uid, id);
  }, [user?.uid]);

  const setHeaderCountdownId = useCallback((id: string | null) => {
    commitHeaderCountdownId(id);
  }, [commitHeaderCountdownId]);

  const commit = useCallback((next: CountdownItem[]) => {
    const sorted = mergeCountdowns(next, [], deletedRef.current);
    countdownsRef.current = sorted;
    setCountdowns(sorted);
    writeCountdownsLocal(sorted);
    if (headerCountdownIdRef.current && !sorted.some((row) => row.id === headerCountdownIdRef.current)) {
      commitHeaderCountdownId(null);
    }
    return sorted;
  }, [commitHeaderCountdownId]);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const prev = localStorage.getItem(COUNTDOWNS_UID_KEY);
    if (prev && prev !== uid) {
      try {
        localStorage.removeItem(COUNTDOWNS_LS_KEY);
        localStorage.removeItem(COUNTDOWNS_DELETED_LS_KEY);
        localStorage.removeItem(HEADER_COUNTDOWN_LS_KEY);
      } catch { /* ignore */ }
      deletedRef.current = [];
      commit([]);
      commitHeaderCountdownId(null, uid);
    }
    try {
      localStorage.setItem(COUNTDOWNS_UID_KEY, uid);
    } catch { /* ignore */ }

    let cancelled = false;
    void Promise.all([fetchCloudCountdowns(uid), fetchHeaderCountdownId(uid)]).then(([remote, cloudHeaderId]) => {
      if (cancelled) return;
      const merged = mergeCountdowns(readCountdownsLocal(), remote, deletedRef.current);
      commit(merged);
      for (const id of deletedRef.current) removeCountdownCloud(uid, id);
      const remoteIds = new Set(remote.map((row) => row.id));
      for (const item of merged) {
        if (!remoteIds.has(item.id)) persistCountdownCloud(uid, item);
      }
      const localHeaderId = readHeaderCountdownId();
      const nextHeaderId = cloudHeaderId ?? localHeaderId;
      if (nextHeaderId && merged.some((row) => row.id === nextHeaderId)) {
        commitHeaderCountdownId(nextHeaderId, uid);
      } else if (nextHeaderId) {
        commitHeaderCountdownId(null, uid);
      }
    });
    return () => { cancelled = true; };
  }, [user?.uid, commit, commitHeaderCountdownId]);

  const addCountdown = useCallback((draft: CountdownDraft) => {
    const now = new Date().toISOString();
    const item: CountdownItem = {
      id: newId(),
      title: draft.title.trim() || 'Countdown',
      targetAt: draft.targetAt,
      repeat: draft.repeat,
      format: { ...draft.format },
      textShadow: draft.textShadow,
      background: draft.background,
      createdAt: now,
      updatedAt: now,
    };
    commit([item, ...countdownsRef.current]);
    persistCountdownCloud(user?.uid, item);
    return item;
  }, [commit, user?.uid]);

  const updateCountdown = useCallback((id: string, draft: Partial<CountdownDraft>) => {
    const next = countdownsRef.current.map((row) => {
      if (row.id !== id) return row;
      return {
        ...row,
        title: draft.title !== undefined ? (draft.title.trim() || row.title) : row.title,
        targetAt: draft.targetAt ?? row.targetAt,
        repeat: draft.repeat ?? row.repeat,
        format: draft.format ? { ...draft.format } : row.format,
        textShadow: draft.textShadow ?? row.textShadow,
        background: draft.background ?? row.background,
        updatedAt: new Date().toISOString(),
      };
    });
    const updated = next.find((row) => row.id === id);
    commit(next);
    if (updated) persistCountdownCloud(user?.uid, updated);
  }, [commit, user?.uid]);

  const deleteCountdown = useCallback((id: string) => {
    deletedRef.current = [...new Set([...deletedRef.current, id])];
    writeDeletedCountdownIds(deletedRef.current);
    if (headerCountdownIdRef.current === id) commitHeaderCountdownId(null);
    commit(countdownsRef.current.filter((row) => row.id !== id));
    removeCountdownCloud(user?.uid, id);
  }, [commit, commitHeaderCountdownId, user?.uid]);

  const value = useMemo(() => ({
    countdowns,
    headerCountdownId,
    setHeaderCountdownId,
    addCountdown,
    updateCountdown,
    deleteCountdown,
  }), [countdowns, headerCountdownId, setHeaderCountdownId, addCountdown, updateCountdown, deleteCountdown]);

  return (
    <CountdownsContext.Provider value={value}>
      {children}
    </CountdownsContext.Provider>
  );
}

export function useCountdowns() {
  const ctx = useContext(CountdownsContext);
  if (!ctx) throw new Error('useCountdowns must be used within CountdownsProvider');
  return ctx;
}

export function createDefaultCountdownDraft(): CountdownDraft {
  const target = new Date();
  target.setMonth(target.getMonth() + 3);
  target.setHours(23, 0, 0, 0);
  return {
    title: '',
    targetAt: target.toISOString(),
    repeat: 'none',
    format: { ...DEFAULT_COUNTDOWN_FORMAT },
    textShadow: true,
    background: 'sunset',
  };
}

export type { CountdownDraft };
