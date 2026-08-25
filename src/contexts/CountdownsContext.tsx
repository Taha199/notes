import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CountdownBackground, CountdownFormat, CountdownItem, CountdownRepeat } from '../types';
import {
  DEFAULT_COUNTDOWN_FORMAT,
  readCountdownsLocal,
  writeCountdownsLocal,
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
  addCountdown: (draft: CountdownDraft) => CountdownItem;
  updateCountdown: (id: string, draft: Partial<CountdownDraft>) => void;
  deleteCountdown: (id: string) => void;
}

const CountdownsContext = createContext<CountdownsContextValue | null>(null);

function newId() {
  return `cd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function CountdownsProvider({ children }: { children: ReactNode }) {
  const [countdowns, setCountdowns] = useState<CountdownItem[]>(() => readCountdownsLocal());
  const countdownsRef = useRef(countdowns);
  countdownsRef.current = countdowns;

  const commit = useCallback((next: CountdownItem[]) => {
    const sorted = [...next].sort((a, b) => a.targetAt.localeCompare(b.targetAt));
    countdownsRef.current = sorted;
    setCountdowns(sorted);
    writeCountdownsLocal(sorted);
  }, []);

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
    return item;
  }, [commit]);

  const updateCountdown = useCallback((id: string, draft: Partial<CountdownDraft>) => {
    commit(countdownsRef.current.map((row) => {
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
    }));
  }, [commit]);

  const deleteCountdown = useCallback((id: string) => {
    commit(countdownsRef.current.filter((row) => row.id !== id));
  }, [commit]);

  const value = useMemo(() => ({
    countdowns,
    addCountdown,
    updateCountdown,
    deleteCountdown,
  }), [countdowns, addCountdown, updateCountdown, deleteCountdown]);

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
