import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ref as dbRef, remove, set } from 'firebase/database';
import type { TodoItem, TodoRecurrenceMeta } from '../types';
import { useAuth } from './AuthContext';
import { database } from '../lib/firebase';
import { rtdbFetch } from '../lib/rtdb';
import {
  expandRecurringTodoDates,
  getTodoSeriesId,
  incompleteTodoCount,
  mergeTodos,
  normalizeTodo,
  normalizeTodoTime,
  readDeletedTodoIds,
  readTodosLocal,
  TODOS_DELETED_LS_KEY,
  TODOS_LS_KEY,
  TODOS_UID_KEY,
  todosInSeries,
  writeDeletedTodoIds,
  writeTodosLocal,
  type TodoRecurrenceMode,
} from '../lib/todosStore';

type RecurringOpts = {
  title: string;
  time?: string;
  mode: TodoRecurrenceMode;
  weekdays?: number[];
  monthDay?: number;
  startDate: string;
  endDate: string;
};

interface TodosContextValue {
  todos: TodoItem[];
  incompleteCount: number;
  addTodo: (title: string, date: string, time?: string) => void;
  addRecurringTodos: (opts: RecurringOpts) => number;
  updateRecurringSeries: (seriesId: string, opts: RecurringOpts) => number;
  deleteSeries: (seriesId: string) => number;
  toggleTodo: (id: string) => void;
  renameTodo: (id: string, title: string) => void;
  setTodoTime: (id: string, time?: string) => void;
  deleteTodo: (id: string) => void;
}

const TodosContext = createContext<TodosContextValue | null>(null);

function cloudPath(uid: string, id?: string) {
  return id ? `users/${uid}/todos/${id}` : `users/${uid}/todos`;
}

async function fetchCloudTodos(uid: string): Promise<TodoItem[]> {
  try {
    const res = await rtdbFetch(`/users/${uid}/todos`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data || typeof data !== 'object') return [];
    return Object.values(data as Record<string, unknown>)
      .map(normalizeTodo)
      .filter((row): row is TodoItem => !!row);
  } catch {
    return [];
  }
}

function persistTodoCloud(uid: string | null | undefined, todo: TodoItem) {
  if (!uid) return;
  void set(dbRef(database, cloudPath(uid, todo.id)), todo).catch(() => {
    void rtdbFetch(`/users/${uid}/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(todo),
    }).catch(() => {});
  });
}

function removeTodoCloud(uid: string | null | undefined, id: string) {
  if (!uid) return;
  void remove(dbRef(database, cloudPath(uid, id))).catch(() => {
    void rtdbFetch(`/users/${uid}/todos/${id}`, { method: 'DELETE' }).catch(() => {});
  });
}

function buildRecurrenceMeta(opts: RecurringOpts): TodoRecurrenceMeta {
  return {
    mode: opts.mode,
    startDate: opts.startDate,
    endDate: opts.endDate,
    ...(opts.mode === 'weekly' && opts.weekdays?.length ? { weekdays: [...opts.weekdays] } : {}),
    ...(opts.mode === 'monthly' && opts.monthDay != null ? { monthDay: opts.monthDay } : {}),
  };
}

function buildSeriesTodos(
  opts: RecurringOpts,
  seriesId: string,
  doneByDate?: Map<string, boolean>,
): TodoItem[] {
  const trimmed = opts.title.trim();
  if (!trimmed) return [];
  const dates = expandRecurringTodoDates(opts.startDate, opts.endDate, opts.mode, {
    weekdays: opts.weekdays,
    monthDay: opts.monthDay,
  });
  if (!dates.length) return [];
  const now = Date.now();
  const normalizedTime = normalizeTodoTime(opts.time);
  const recurrence = buildRecurrenceMeta(opts);
  const stamp = `${now}-${Math.random().toString(36).slice(2, 6)}`;
  return dates.map((date, i) => ({
    id: `todo-${seriesId}-${stamp}-${i}`,
    title: trimmed,
    done: doneByDate?.get(date) ?? false,
    date,
    ...(normalizedTime ? { time: normalizedTime } : {}),
    seriesId,
    recurrence,
    createdAt: now + i,
    updatedAt: now + i,
  }));
}

export function TodosProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [todos, setTodos] = useState<TodoItem[]>(() => readTodosLocal());
  const todosRef = useRef(todos);
  todosRef.current = todos;
  const deletedRef = useRef<string[]>(readDeletedTodoIds());

  const commit = useCallback((next: TodoItem[]) => {
    const sorted = mergeTodos(next, [], deletedRef.current);
    todosRef.current = sorted;
    setTodos(sorted);
    writeTodosLocal(sorted);
    return sorted;
  }, []);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const prev = localStorage.getItem(TODOS_UID_KEY);
    if (prev && prev !== uid) {
      try {
        localStorage.removeItem(TODOS_LS_KEY);
        localStorage.removeItem(TODOS_DELETED_LS_KEY);
      } catch { /* ignore */ }
      deletedRef.current = [];
      commit([]);
    }
    try {
      localStorage.setItem(TODOS_UID_KEY, uid);
    } catch { /* ignore */ }

    let cancelled = false;
    void fetchCloudTodos(uid).then((remote) => {
      if (cancelled) return;
      const merged = mergeTodos(readTodosLocal(), remote, deletedRef.current);
      commit(merged);
      for (const id of deletedRef.current) removeTodoCloud(uid, id);
    });
    return () => { cancelled = true; };
  }, [user?.uid, commit]);

  const markDeleted = useCallback((ids: string[]) => {
    if (!ids.length) return;
    deletedRef.current = [...new Set([...deletedRef.current, ...ids])];
    writeDeletedTodoIds(deletedRef.current);
    for (const id of ids) removeTodoCloud(user?.uid, id);
  }, [user?.uid]);

  const addTodo = useCallback((title: string, date: string, time?: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const now = Date.now();
    const normalizedTime = normalizeTodoTime(time);
    const todo: TodoItem = {
      id: `todo-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: trimmed,
      done: false,
      date,
      ...(normalizedTime ? { time: normalizedTime } : {}),
      createdAt: now,
      updatedAt: now,
    };
    commit([...todosRef.current, todo]);
    persistTodoCloud(user?.uid, todo);
  }, [commit, user?.uid]);

  const addRecurringTodos = useCallback((opts: RecurringOpts) => {
    const seriesId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const created = buildSeriesTodos(opts, seriesId);
    if (!created.length) return 0;
    commit([...todosRef.current, ...created]);
    for (const todo of created) persistTodoCloud(user?.uid, todo);
    return created.length;
  }, [commit, user?.uid]);

  const deleteSeries = useCallback((seriesId: string) => {
    const id = seriesId.trim();
    if (!id) return 0;
    const members = todosInSeries(todosRef.current, id);
    if (!members.length) return 0;
    markDeleted(members.map((todo) => todo.id));
    commit(todosRef.current.filter((todo) => getTodoSeriesId(todo) !== id));
    return members.length;
  }, [commit, markDeleted]);

  const updateRecurringSeries = useCallback((seriesId: string, opts: RecurringOpts) => {
    const id = seriesId.trim();
    if (!id) return 0;
    const existing = todosInSeries(todosRef.current, id);
    const doneByDate = new Map(existing.map((todo) => [todo.date, todo.done]));
    const created = buildSeriesTodos(opts, id, doneByDate);
    if (!created.length) return 0;
    const removeIds = existing.map((todo) => todo.id);
    markDeleted(removeIds);
    const kept = todosRef.current.filter((todo) => getTodoSeriesId(todo) !== id);
    commit([...kept, ...created]);
    for (const todo of created) persistTodoCloud(user?.uid, todo);
    return created.length;
  }, [commit, markDeleted, user?.uid]);

  const toggleTodo = useCallback((id: string) => {
    const next = todosRef.current.map((todo) => (
      todo.id === id ? { ...todo, done: !todo.done, updatedAt: Date.now() } : todo
    ));
    const updated = next.find((todo) => todo.id === id);
    commit(next);
    if (updated) persistTodoCloud(user?.uid, updated);
  }, [commit, user?.uid]);

  const renameTodo = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const next = todosRef.current.map((todo) => (
      todo.id === id ? { ...todo, title: trimmed, updatedAt: Date.now() } : todo
    ));
    const updated = next.find((todo) => todo.id === id);
    commit(next);
    if (updated) persistTodoCloud(user?.uid, updated);
  }, [commit, user?.uid]);

  const setTodoTime = useCallback((id: string, time?: string) => {
    const normalizedTime = normalizeTodoTime(time);
    const next = todosRef.current.map((todo) => {
      if (todo.id !== id) return todo;
      const { time: _prev, ...rest } = todo;
      return {
        ...rest,
        ...(normalizedTime ? { time: normalizedTime } : {}),
        updatedAt: Date.now(),
      };
    });
    const updated = next.find((todo) => todo.id === id);
    commit(next);
    if (updated) persistTodoCloud(user?.uid, updated);
  }, [commit, user?.uid]);

  const deleteTodo = useCallback((id: string) => {
    markDeleted([id]);
    commit(todosRef.current.filter((todo) => todo.id !== id));
  }, [commit, markDeleted]);

  const value = useMemo<TodosContextValue>(() => ({
    todos,
    incompleteCount: incompleteTodoCount(todos),
    addTodo,
    addRecurringTodos,
    updateRecurringSeries,
    deleteSeries,
    toggleTodo,
    renameTodo,
    setTodoTime,
    deleteTodo,
  }), [todos, addTodo, addRecurringTodos, updateRecurringSeries, deleteSeries, toggleTodo, renameTodo, setTodoTime, deleteTodo]);

  return <TodosContext.Provider value={value}>{children}</TodosContext.Provider>;
}

export function useTodos() {
  const ctx = useContext(TodosContext);
  if (!ctx) throw new Error('useTodos must be used within TodosProvider');
  return ctx;
}
