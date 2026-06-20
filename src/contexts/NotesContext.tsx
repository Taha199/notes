import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Note, QuizItem, QuizSet, QuizFolder, ChatConversation } from '../types';
import { FB_DB_URL } from '../lib/firebase';
import { useAuth } from './AuthContext';
import { useLanguage } from './LanguageContext';

export interface Draft {
  id: string;
  title: string;
  html: string;
}

type CloudStatus = 'idle' | 'saving' | 'saved';

interface NotesCtx {
  notes: Note[];
  drafts: Draft[];
  quizzes: QuizItem[];
  trashedQuizzes: QuizItem[];
  quizSets: QuizSet[];
  quizFolders: QuizFolder[];
  chats: ChatConversation[];
  saveChats: (chats: ChatConversation[]) => void;
  cloudStatus: CloudStatus;
  loaded: boolean;
  addQuiz: (item: Omit<QuizItem, 'id'>) => void;
  deleteQuiz: (id: number) => void;
  restoreQuiz: (id: number) => void;
  permDeleteQuiz: (id: number) => void;
  updateQuiz: (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => void;
  addQuizSet: (name: string) => QuizSet;
  deleteQuizSet: (id: string) => void;
  restoreQuizSet: (id: string) => void;
  permDeleteQuizSet: (id: string) => void;
  renameQuizSet: (id: string, name: string) => void;
  reorderQuizSets: (dragId: string, targetId: string) => void;
  setQuizSetColor: (id: string, color: string) => void;
  setQuizSetFolder: (id: string, folderId: string | undefined) => void;
  addQuizFolder: (name: string) => QuizFolder;
  renameQuizFolder: (id: string, name: string) => void;
  setQuizFolderColor: (id: string, color: string) => void;
  deleteQuizFolder: (id: string) => void;
  restoreQuizFolder: (id: string) => void;
  permDeleteQuizFolder: (id: string) => void;
  addItemToSet: (setId: string, item: Omit<QuizItem, 'id'>) => void;
  removeItemFromSet: (setId: string, itemId: number) => void;
  updateItemInSet: (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => void;
  addDraft: () => void;
  removeDraft: (id: string) => void;
  updateDraft: (id: string, patch: Partial<Draft>) => void;
  submitDraft: (id: string) => void;
  toggleRead: (id: number) => void;
  toggleUnread: (id: number) => void;
  toggleFav: (id: number) => void;
  archive: (id: number) => void;
  unarchive: (id: number) => void;
  trash: (id: number) => void;
  restore: (id: number) => void;
  permDelete: (id: number) => void;
  emptyTrash: () => void;
  deleteMany: (ids: number[]) => void;
  updateNote: (id: number, patch: Partial<Note>) => void;
  nowStr: () => string;
}

const NotesContext = createContext<NotesCtx | null>(null);

const AUTO_QUIZ_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#f97316'];
const RESTORED_FOLDER_ID = 'system-restored-sets';

function ensureRestoredFolder(folders: QuizFolder[]) {
  const restored = folders.find((folder) => folder.id === RESTORED_FOLDER_ID || folder.system === 'restored');
  if (restored) {
    return folders.map((folder) => folder.id === restored.id
      ? { ...folder, id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, trashed: false, deletedAt: undefined, color: folder.color || '#6c63ff', colorInitialized: true }
      : folder);
  }
  return [{ id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, createdAt: new Date().toISOString(), color: '#6c63ff', colorInitialized: true }, ...folders];
}

function colorDistance(a: string, b: string) {
  const channels = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

function pickSpacedColor(usedColors: string[]) {
  const used = usedColors.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  const counts = new Map(AUTO_QUIZ_COLORS.map((color) => [color, used.filter((usedColor) => usedColor.toLowerCase() === color).length]));
  const lowestUse = Math.min(...counts.values());
  const leastUsed = AUTO_QUIZ_COLORS.filter((color) => counts.get(color) === lowestUse);
  if (used.length === 0) return leastUsed[Math.floor(Math.random() * leastUsed.length)];
  const scored = leastUsed.map((color) => ({ color, score: Math.min(...used.map((usedColor) => colorDistance(color, usedColor))) }));
  const bestScore = Math.max(...scored.map(({ score }) => score));
  const best = scored.filter(({ score }) => score === bestScore);
  return best[Math.floor(Math.random() * best.length)].color;
}

function initializeQuizColors<T extends { color?: string; colorInitialized?: boolean }>(items: T[], initialColors: string[] = []) {
  const used = [...initialColors, ...items.map((item) => item.color).filter((color): color is string => !!color)];
  return items.map((item) => {
    if (item.colorInitialized || item.color) return item;
    const color = pickSpacedColor(used);
    used.push(color);
    return { ...item, color, colorInitialized: true };
  });
}

function nextId() {
  return Date.now();
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [notes, setNotes] = useState<Note[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('malacadhati') || '[]');
    } catch {
      return [];
    }
  });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [quizzes, setQuizzes] = useState<QuizItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('malacadhati_quiz') || '[]'); } catch { return []; }
  });
  const [quizSets, setQuizSets] = useState<QuizSet[]>(() => {
    try { return JSON.parse(localStorage.getItem('malacadhati_quiz_sets') || '[]'); } catch { return []; }
  });
  const [quizFolders, setQuizFolders] = useState<QuizFolder[]>(() => {
    try { return ensureRestoredFolder(JSON.parse(localStorage.getItem('malacadhati_quiz_folders') || '[]')); } catch { return ensureRestoredFolder([]); }
  });
  const [chats, setChats] = useState<ChatConversation[]>(() => {
    try { return JSON.parse(localStorage.getItem('malacadhati_chats') || '[]'); } catch { return []; }
  });
  const draftCounter = useRef(0);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nowStr = () =>
    new Date().toLocaleString(t.dateLocale, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

  // Load from cloud when user changes
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!user) {
      setNotes([]);
      setDrafts([]);
      setLoaded(true);
      return;
    }
    (async () => {
      try {
        const r = await fetch(`${FB_DB_URL}/users/${user.uid}.json`);
        const cloud = await r.json();
        if (cancelled) return;
        if (cloud && cloud.notes) {
          setNotes(cloud.notes);
          localStorage.setItem('malacadhati', JSON.stringify(cloud.notes));
          if (cloud.quizzes) {
            setQuizzes(cloud.quizzes);
            localStorage.setItem('malacadhati_quiz', JSON.stringify(cloud.quizzes));
          }
          if (cloud.chats) {
            // Firebase strips empty arrays — normalize messages on load.
            const normalizedChats = cloud.chats.map((c: ChatConversation) => ({ ...c, messages: c.messages ?? [] }));
            setChats(normalizedChats);
            localStorage.setItem('malacadhati_chats', JSON.stringify(normalizedChats));
          }
          const rawFolders: QuizFolder[] = cloud.quizFolders?.filter(Boolean) ?? [];
          const normalizedFolders = ensureRestoredFolder(initializeQuizColors(rawFolders));
          if (cloud.quizSets) {
            // Firebase strips empty arrays, so items can be missing — normalize.
            const rawSets: QuizSet[] = cloud.quizSets
              .filter(Boolean)
              .map((s: QuizSet) => ({ ...s, items: s.items ?? [] }));
            const normalizedSets = initializeQuizColors(rawSets, normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color));
            setQuizSets(normalizedSets);
            localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
            if (normalizedSets.some((set, index) => set !== rawSets[index])) {
              void fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`, {
                method: 'PUT',
                body: JSON.stringify(normalizedSets),
                headers: { 'Content-Type': 'application/json' },
              });
            }
          }
          setQuizFolders(normalizedFolders);
          localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(normalizedFolders));
          if (normalizedFolders.length !== rawFolders.length || normalizedFolders.some((folder, index) => folder !== rawFolders[index])) {
            void fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`, {
              method: 'PUT',
              body: JSON.stringify(normalizedFolders),
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (cloud.drafts && cloud.drafts.length) {
            const dc = cloud.draftContents || {};
            setDrafts(
              cloud.drafts.map((id: string) => ({
                id,
                title: dc[id]?.title || '',
                html: dc[id]?.html || '',
              }))
            );
            draftCounter.current = cloud.draftId || cloud.drafts.length;
          } else {
            draftCounter.current = 1;
            setDrafts([{ id: 'd1', title: '', html: '' }]);
          }
        } else {
          draftCounter.current = 1;
          setDrafts([{ id: 'd1', title: '', html: '' }]);
        }
      } catch {
        draftCounter.current = 1;
        setDrafts([{ id: 'd1', title: '', html: '' }]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const persistSets = (nextSets: QuizSet[]) => {
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    persist(notes, undefined, undefined, undefined, nextSets);
  };

  const persistFolders = (nextFolders: QuizFolder[]) => {
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist(notes, undefined, undefined, undefined, undefined, nextFolders);
  };

  useEffect(() => {
    if (!loaded || !user) return;
    setQuizFolders((prev) => {
      const next = ensureRestoredFolder(prev);
      persistFolders(next);
      return next;
    });
    // Run once after each account finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, user?.uid]);

  const saveChats = (nextChats: ChatConversation[]) => {
    setChats(nextChats);
    localStorage.setItem('malacadhati_chats', JSON.stringify(nextChats));
    persist(notes, undefined, undefined, nextChats);
  };

  const persist = (nextNotes: Note[], nextDrafts?: Draft[], nextQuizzes?: QuizItem[], nextChats?: ChatConversation[], nextQuizSets?: QuizSet[], nextQuizFolders?: QuizFolder[]) => {
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    const qList = nextQuizzes ?? quizzes;
    localStorage.setItem('malacadhati_quiz', JSON.stringify(qList));
    if (!user) return;
    setCloudStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    clearTimeout(hideTimer.current ?? undefined);
    saveTimer.current = setTimeout(() => {
      const dList = nextDrafts ?? drafts;
      const chatList = nextChats ?? chats;
      const qsList = nextQuizSets ?? quizSets;
      const qfList = nextQuizFolders ?? quizFolders;
      const draftContents: Record<string, { title: string; html: string }> = {};
      dList.forEach((d) => {
        draftContents[d.id] = { title: d.title, html: d.html };
      });
      fetch(`${FB_DB_URL}/users/${user.uid}.json`, {
        method: 'PUT',
        body: JSON.stringify({
          notes: nextNotes,
          drafts: dList.map((d) => d.id),
          draftId: draftCounter.current,
          draftContents,
          quizzes: qList,
          chats: chatList,
          quizSets: qsList,
          quizFolders: qfList,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
        .then(() => setCloudStatus('saved'))
        .catch(() => setCloudStatus('saved'))
        .finally(() => {
          hideTimer.current = setTimeout(() => setCloudStatus('idle'), 2500);
        });
    }, 800);
  };

  const mutateNotes = (fn: (prev: Note[]) => Note[]) => {
    setNotes((prev) => {
      const next = fn(prev);
      persist(next);
      return next;
    });
  };

  const addDraft = () => {
    const id = 'd' + ++draftCounter.current;
    setDrafts((prev) => {
      const next = [...prev, { id, title: '', html: '' }];
      persist(notes, next);
      return next;
    });
  };

  const removeDraft = (id: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.id !== id);
      persist(notes, next);
      return next;
    });
  };

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, ...patch } : d));
      persist(notes, next);
      return next;
    });
  };

  const submitDraft = (id: string) => {
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;
    const text = draft.html.replace(/<[^>]*>/g, '').trim();
    if (!text) return;
    const newNote: Note = {
      id: nextId(),
      title: draft.title.trim(),
      html: draft.html,
      text,
      fav: false,
      read: false,
      archived: false,
      date: nowStr(),
    };
    setNotes((prevNotes) => {
      const nextNotes = [newNote, ...prevNotes];
      setDrafts((prevDrafts) => {
        const nextDrafts = prevDrafts.filter((d) => d.id !== id);
        persist(nextNotes, nextDrafts);
        return nextDrafts;
      });
      return nextNotes;
    });
  };

  const updateNote = (id: number, patch: Partial<Note>) =>
    mutateNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));

  const addQuiz = (item: Omit<QuizItem, 'id'>) => {
    setQuizzes((prev) => {
      const now = new Date().toISOString();
      const next = [...prev, { ...item, id: Date.now(), createdAt: item.createdAt ?? now, updatedAt: now }];
      persist(notes, undefined, next);
      return next;
    });
  };

  const deleteQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, trashed: true, deletedAt: nowStr() } : q);
      persist(notes, undefined, next);
      return next;
    });
  };

  const restoreQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, trashed: false, deletedAt: undefined } : q);
      persist(notes, undefined, next);
      return next;
    });
  };

  const permDeleteQuiz = (id: number) => {
    setQuizzes((prev) => {
      const next = prev.filter((q) => q.id !== id);
      persist(notes, undefined, next);
      return next;
    });
  };

  const updateQuiz = (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => {
    setQuizzes((prev) => {
      const next = prev.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q));
      persist(notes, undefined, next);
      return next;
    });
  };

  const addQuizSet = (name: string): QuizSet => {
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value));
    const newSet: QuizSet = { id: Date.now().toString(), name, items: [], createdAt: nowStr(), color, colorInitialized: true };
    setQuizSets((prev) => {
      const next = [...prev, newSet];
      persistSets(next);
      return next;
    });
    return newSet;
  };

  const deleteQuizSet = (id: string) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === id ? { ...s, trashed: true, deletedAt: nowStr() } : s);
      persistSets(next);
      return next;
    });
  };

  const restoreQuizSet = (id: string) => {
    setQuizSets((prev) => {
      const set = prev.find((item) => item.id === id);
      if (!set) return prev;
      const next = [...prev.filter((item) => item.id !== id), { ...set, trashed: false, deletedAt: undefined, folderId: RESTORED_FOLDER_ID }];
      persistSets(next);
      return next;
    });
  };

  const permDeleteQuizSet = (id: string) => {
    setQuizSets((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSets(next);
      return next;
    });
  };

  const reorderQuizSets = (dragId: string, targetId: string) => {
    setQuizSets((prev) => {
      const next = [...prev];
      const from = next.findIndex((s) => s.id === dragId);
      const to = next.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      persistSets(next);
      return next;
    });
  };

  const renameQuizSet = (id: string, name: string) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, name } : s));
      persistSets(next);
      return next;
    });
  };

  const setQuizSetColor = (id: string, color: string) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, color, colorInitialized: true } : s));
      persistSets(next);
      return next;
    });
  };

  const setQuizSetFolder = (id: string, folderId: string | undefined) => {
    setQuizSets((prev) => {
      const set = prev.find((s) => s.id === id);
      if (!set || set.folderId === folderId) return prev;
      const next = [...prev.filter((s) => s.id !== id), { ...set, folderId }];
      persistSets(next);
      return next;
    });
  };

  const addQuizFolder = (name: string): QuizFolder => {
    const color = pickSpacedColor([...quizFolders, ...quizSets].map((item) => item.color).filter((value): value is string => !!value));
    const folder: QuizFolder = { id: 'f' + Date.now().toString(), name, createdAt: nowStr(), color, colorInitialized: true };
    setQuizFolders((prev) => {
      const next = [...prev, folder];
      persistFolders(next);
      return next;
    });
    return folder;
  };

  const renameQuizFolder = (id: string, name: string) => {
    if (id === RESTORED_FOLDER_ID) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name } : f));
      persistFolders(next);
      return next;
    });
  };

  const setQuizFolderColor = (id: string, color: string) => {
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, color, colorInitialized: true } : f));
      persistFolders(next);
      return next;
    });
  };

  const deleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => f.id === id ? { ...f, trashed: true, deletedAt: nowStr() } : f);
      persistFolders(next);
      return next;
    });
  };

  const restoreQuizFolder = (id: string) => {
    setQuizFolders((prev) => {
      const next = prev.map((f) => f.id === id ? { ...f, trashed: false, deletedAt: undefined } : f);
      persistFolders(next);
      return next;
    });
  };

  const permDeleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID) return;
    const nextSets = quizSets.map((s) => s.folderId === id ? { ...s, folderId: undefined } : s);
    const nextFolders = quizFolders.filter((f) => f.id !== id);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist(notes, undefined, undefined, undefined, nextSets, nextFolders);
  };

  const addItemToSet = (setId: string, item: Omit<QuizItem, 'id'>) => {
    const now = new Date().toISOString();
    const newItem: QuizItem = { ...item, id: Date.now(), createdAt: item.createdAt ?? now, updatedAt: now };
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: [...s.items, newItem] } : s);
      persistSets(next);
      return next;
    });
  };

  const removeItemFromSet = (setId: string, itemId: number) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s);
      persistSets(next);
      return next;
    });
  };

  const updateItemInSet = (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.map((i) => i.id === itemId ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i) } : s);
      persistSets(next);
      return next;
    });
  };

  const toggleRead = (id: number) => updateNote(id, { read: true });
  const toggleUnread = (id: number) => updateNote(id, { read: false });
  const toggleFav = (id: number) =>
    mutateNotes((prev) => prev.map((n) => (n.id === id ? { ...n, fav: !n.fav } : n)));
  const archive = (id: number) => updateNote(id, { archived: true });
  const unarchive = (id: number) => updateNote(id, { archived: false, read: false });
  const trash = (id: number) => updateNote(id, { trashed: true, deletedAt: nowStr() });
  const restore = (id: number) => updateNote(id, { trashed: false, deletedAt: undefined });
  const permDelete = (id: number) => mutateNotes((prev) => prev.filter((n) => n.id !== id));
  const emptyTrash = () => {
    const nextNotes = notes.filter((n) => !n.trashed);
    const nextQuizzes = quizzes.filter((q) => !q.trashed);
    const removedFolderIds = new Set(quizFolders.filter((folder) => folder.trashed).map((folder) => folder.id));
    const nextSets = quizSets
      .filter((set) => !set.trashed)
      .map((set) => set.folderId && removedFolderIds.has(set.folderId) ? { ...set, folderId: undefined } : set);
    const nextFolders = quizFolders.filter((folder) => !folder.trashed);
    setNotes(nextNotes);
    setQuizzes(nextQuizzes);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    localStorage.setItem('malacadhati_quiz', JSON.stringify(nextQuizzes));
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist(nextNotes, undefined, nextQuizzes, undefined, nextSets, nextFolders);
  };
  const deleteMany = (ids: number[]) => {
    const idSet = new Set(ids);
    mutateNotes((prev) => prev.filter((n) => !idSet.has(n.id)));
  };

  return (
    <NotesContext.Provider
      value={{
        notes,
        drafts,
        quizzes: quizzes.filter((q) => !q.trashed),
        trashedQuizzes: quizzes.filter((q) => q.trashed),
        quizSets,
        quizFolders,
        cloudStatus,
        loaded,
        addQuiz,
        deleteQuiz, restoreQuiz, permDeleteQuiz,
        updateQuiz,
        addQuizSet,
        reorderQuizSets,
        deleteQuizSet,
        restoreQuizSet,
        permDeleteQuizSet,
        renameQuizSet,
        setQuizSetColor,
        setQuizSetFolder,
        addQuizFolder,
        renameQuizFolder,
        setQuizFolderColor,
        deleteQuizFolder,
        restoreQuizFolder,
        permDeleteQuizFolder,
        addItemToSet,
        removeItemFromSet,
        updateItemInSet,
        addDraft,
        removeDraft,
        updateDraft,
        submitDraft,
        toggleRead,
        toggleUnread,
        toggleFav,
        archive,
        unarchive,
        trash,
        restore,
        permDelete,
        emptyTrash,
        deleteMany,
        updateNote,
        nowStr,
        chats,
        saveChats,
      }}
    >
      {children}
    </NotesContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes must be used within NotesProvider');
  return ctx;
}
