import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ref as dbRef, remove, set } from 'firebase/database';
import type { TodoItem } from '../types';
import { useAuth } from './AuthContext';
import { database } from '../lib/firebase';
import { rtdbFetch } from '../lib/rtdb';
import {
  incompleteTodoCount,
  mergeTodos,
  normalizeTodo,
  readDeletedTodoIds,
  readTodosLocal,
  TODOS_DELETED_LS_KEY,
  TODOS_LS_KEY,
  TODOS_UID_KEY,
  writeDeletedTodoIds,
  writeTodosLocal,
} from '../lib/todosStore';

interface TodosContextValue {
  todos: TodoItem[];
  incompleteCount: number;
  addTodo: (title: string, date: string) => void;
  toggleTodo: (id: string) => void;
  renameTodo: (id: string, title: string) => void;
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

  const addTodo = useCallback((title: string, date: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const now = Date.now();
    const todo: TodoItem = {
      id: `todo-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: trimmed,
      done: false,
      date,
      createdAt: now,
      updatedAt: now,
    };
    commit([...todosRef.current, todo]);
    persistTodoCloud(user?.uid, todo);
  }, [commit, user?.uid]);

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

  const deleteTodo = useCallback((id: string) => {
    deletedRef.current = [...new Set([...deletedRef.current, id])];
    writeDeletedTodoIds(deletedRef.current);
    commit(todosRef.current.filter((todo) => todo.id !== id));
    removeTodoCloud(user?.uid, id);
  }, [commit, user?.uid]);

  const value = useMemo<TodosContextValue>(() => ({
    todos,
    incompleteCount: incompleteTodoCount(todos),
    addTodo,
    toggleTodo,
    renameTodo,
    deleteTodo,
  }), [todos, addTodo, toggleTodo, renameTodo, deleteTodo]);

  return <TodosContext.Provider value={value}>{children}</TodosContext.Provider>;
}

export function useTodos() {
  const ctx = useContext(TodosContext);
  if (!ctx) throw new Error('useTodos must be used within TodosProvider');
  return ctx;
}
