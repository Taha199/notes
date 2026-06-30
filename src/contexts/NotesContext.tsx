import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Note, QuizItem, QuizSet, QuizFolder, ChatConversation } from '../types';
import { FB_DB_URL } from '../lib/firebase';
import { setTokenSink } from '../lib/gemini';
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
  addQuiz: (item: Omit<QuizItem, 'id'>) => number;
  deleteQuiz: (id: number) => void;
  restoreQuiz: (id: number) => void;
  permDeleteQuiz: (id: number) => void;
  updateQuiz: (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => void;
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
  reorderQuizFolders: (dragId: string, targetId: string) => void;
  setQuizFolderColor: (id: string, color: string) => void;
  deleteQuizFolder: (id: string) => void;
  restoreQuizFolder: (id: string) => void;
  permDeleteQuizFolder: (id: string) => void;
  recoverQuizFolders: () => Promise<number>;
  listQuizFolderBackups: () => Promise<{ key: string; label: string; folderCount: number }[]>;
  restoreQuizFolderBackup: (key: string) => Promise<number>;
  addItemToSet: (setId: string, item: Omit<QuizItem, 'id'>) => number;
  removeItemFromSet: (setId: string, itemId: number) => void;
  updateItemInSet: (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes'>>) => void;
  moveItemInSet: (setId: string, itemId: number, direction: 'up' | 'down') => void;
  reorderItemInSet: (setId: string, dragId: number, targetId: number) => void;
  setItemsOrderInSet: (setId: string, itemIds: number[]) => void;
  moveQuiz: (itemId: number, direction: 'up' | 'down') => void;
  reorderQuiz: (dragId: number, targetId: number) => void;
  setQuizzesOrder: (itemIds: number[]) => void;
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

function firebaseToArray<T>(data: T[] | Record<string, T> | null | undefined): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(Boolean);
  if (typeof data === 'object') return Object.values(data).filter(Boolean);
  return [];
}

function mergeById<T extends { id: string }>(...lists: T[][]): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const item of list) {
      if (item?.id) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

function readLocalJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

const LAST_UID_KEY = 'malacadhati_last_uid';

const LOCAL_DATA_KEYS = [
  'malacadhati',
  'malacadhati_quiz',
  'malacadhati_quiz_sets',
  'malacadhati_quiz_folders',
  'malacadhati_chats',
] as const;

function clearLocalNotesData() {
  for (const key of LOCAL_DATA_KEYS) localStorage.removeItem(key);
}

/** Clear cached notes when a different account signs in (keys are not uid-scoped). */
function syncAccountLocalStorage(uid: string) {
  const prev = localStorage.getItem(LAST_UID_KEY);
  if (prev && prev !== uid) clearLocalNotesData();
  localStorage.setItem(LAST_UID_KEY, uid);
}

function readLocalNotesData() {
  return {
    notes: firebaseToArray<Note>(readLocalJson<Note[]>('malacadhati') ?? []),
    quizzes: firebaseToArray<QuizItem>(readLocalJson<QuizItem[]>('malacadhati_quiz') ?? []),
    chats: firebaseToArray<ChatConversation>(readLocalJson<ChatConversation[]>('malacadhati_chats') ?? []).map((c) => ({
      ...c,
      messages: c.messages ?? [],
    })),
    folders: firebaseToArray<QuizFolder>(readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? []),
    sets: firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>('malacadhati_quiz_sets') ?? []).map((set) => ({
      ...set,
      items: set.items ?? [],
    })),
  };
}

/** Cloud wins when the field is present (even if empty); otherwise keep local fallback. */
function cloudFieldOrLocal<T>(cloud: Record<string, unknown> | null, field: string, local: T[]): T[] {
  if (cloud && field in cloud) return firebaseToArray<T>(cloud[field] as T[] | Record<string, T>);
  return local;
}

const AUTO_QUIZ_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#06b6d4', '#f97316'];
const RESTORED_FOLDER_ID = 'system-restored-sets';
export const FAVORITES_FOLDER_ID = 'system-favorites';
export const FAVORITES_SET_ID = 'system-favorites-set';
const MAX_FOLDER_HISTORY = 40;

function ensureRestoredFolder(folders: QuizFolder[]) {
  const restored = folders.find((folder) => folder.id === RESTORED_FOLDER_ID || folder.system === 'restored');
  if (restored) {
    return folders.map((folder) => folder.id === restored.id
      ? { ...folder, id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, trashed: false, deletedAt: undefined, color: folder.color || '#6c63ff', colorInitialized: true }
      : folder);
  }
  return [{ id: RESTORED_FOLDER_ID, name: 'Restored Sets', system: 'restored' as const, createdAt: new Date().toISOString(), color: '#6c63ff', colorInitialized: true }, ...folders];
}

function ensureFavoritesFolder(folders: QuizFolder[]) {
  const fav = folders.find((folder) => folder.id === FAVORITES_FOLDER_ID || folder.system === 'favorites');
  if (fav) {
    return folders.map((folder) => folder.id === fav.id
      ? { ...folder, id: FAVORITES_FOLDER_ID, name: 'Favoriter', system: 'favorites' as const, trashed: false, deletedAt: undefined, color: folder.color || '#f59e0b', colorInitialized: true }
      : folder);
  }
  const favFolder: QuizFolder = { id: FAVORITES_FOLDER_ID, name: 'Favoriter', system: 'favorites', createdAt: new Date().toISOString(), color: '#f59e0b', colorInitialized: true };
  // Place right after the restored folder (which sits first).
  const idx = folders.findIndex((f) => f.id === RESTORED_FOLDER_ID || f.system === 'restored');
  if (idx >= 0) {
    const copy = [...folders];
    copy.splice(idx + 1, 0, favFolder);
    return copy;
  }
  return [favFolder, ...folders];
}

function ensureFavoritesSet(sets: QuizSet[]) {
  const fav = sets.find((s) => s.id === FAVORITES_SET_ID || s.system === 'favorites');
  if (fav) {
    return sets.map((s) => s.id === fav.id
      ? { ...s, id: FAVORITES_SET_ID, name: 'Favorit frågor', system: 'favorites' as const, folderId: FAVORITES_FOLDER_ID, trashed: false, deletedAt: undefined, color: s.color || '#f59e0b', colorInitialized: true }
      : s);
  }
  return [...sets, { id: FAVORITES_SET_ID, name: 'Favorit frågor', system: 'favorites' as const, folderId: FAVORITES_FOLDER_ID, items: [], createdAt: new Date().toISOString(), color: '#f59e0b', colorInitialized: true }];
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

function inferRecoveredFolderName(sets: QuizSet[]): string {
  const blob = sets
    .flatMap((set) => [set.name, ...(set.items ?? []).map((item) => `${item.question} ${item.answer}`)])
    .join(' ')
    .toLowerCase();
  if (blob.includes('sepsis')) return 'sepsis';
  if (sets.length === 1 && sets[0].name.trim()) return sets[0].name.trim();
  return 'Återställd mapp';
}

function recoverMissingFoldersFromSets(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const known = new Map(folders.map((folder) => [folder.id, folder]));
  const referenced = new Set<string>();
  for (const set of sets) {
    if (!set.folderId || set.trashed) continue;
    if (set.folderId === FAVORITES_FOLDER_ID || set.folderId === RESTORED_FOLDER_ID) continue;
    referenced.add(set.folderId);
  }

  const recovered = [...folders];
  for (const folderId of referenced) {
    if (known.has(folderId)) continue;
    const setsInFolder = sets.filter((set) => set.folderId === folderId && !set.trashed);
    const usedColors = [...folders, ...sets].map((item) => item.color).filter((color): color is string => !!color);
    recovered.push({
      id: folderId,
      name: inferRecoveredFolderName(setsInFolder),
      createdAt: new Date().toISOString(),
      color: pickSpacedColor(usedColors),
      colorInitialized: true,
    });
    known.set(folderId, recovered[recovered.length - 1]);
  }
  return recovered;
}

function autoRestoreReferencedTrashedFolders(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const referenced = new Set(sets.filter((set) => set.folderId && !set.trashed).map((set) => set.folderId!));
  return folders.map((folder) => {
    if (folder.trashed && !folder.system && referenced.has(folder.id)) {
      return { ...folder, trashed: false, deletedAt: undefined };
    }
    return folder;
  });
}

function finalizeQuizFolders(folders: QuizFolder[], sets: QuizSet[]): QuizFolder[] {
  const merged = recoverMissingFoldersFromSets(folders, sets);
  const restored = autoRestoreReferencedTrashedFolders(merged, sets);
  return ensureRestoredFolder(initializeQuizColors(restored));
}

function nextId() {
  return Date.now();
}

export function NotesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [notes, setNotes] = useState<Note[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [quizSets, setQuizSets] = useState<QuizSet[]>([]);
  const [quizFolders, setQuizFolders] = useState<QuizFolder[]>(ensureRestoredFolder([]));
  const [chats, setChats] = useState<ChatConversation[]>([]);
  const [tokenUsage, setTokenUsage] = useState<number>(0);
  const draftCounter = useRef(0);
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>('idle');
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savesInFlight = useRef(0);
  const savingStartedAt = useRef(0);
  const MIN_SYNC_VISIBLE_MS = 650;

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
    syncAccountLocalStorage(user.uid);
    const local = readLocalNotesData();

    const applyLocalFallback = () => {
      if (local.notes.length) setNotes(local.notes);
      if (local.quizzes.length) setQuizzes(local.quizzes);
      if (local.chats.length) setChats(local.chats);
      if (local.folders.length) {
        setQuizFolders(ensureRestoredFolder(initializeQuizColors(local.folders)));
      }
      if (local.sets.length) setQuizSets(local.sets);
      draftCounter.current = 1;
      setDrafts([{ id: 'd1', title: '', html: '' }]);
    };

    (async () => {
      try {
        const r = await fetch(`${FB_DB_URL}/users/${user.uid}.json`);
        if (!r.ok) throw new Error('cloud-fetch-failed');
        const cloud = (await r.json()) as Record<string, unknown> | null;
        if (cancelled) return;

        if (cloud?.tokenUsage) {
          setTokenUsage(cloud.tokenUsage as number);
        }

        const notes = cloudFieldOrLocal<Note>(cloud, 'notes', local.notes);
        setNotes(notes);
        localStorage.setItem('malacadhati', JSON.stringify(notes));

        const quizzes = cloudFieldOrLocal<QuizItem>(cloud, 'quizzes', local.quizzes);
        setQuizzes(quizzes);
        localStorage.setItem('malacadhati_quiz', JSON.stringify(quizzes));

        const chats = cloudFieldOrLocal<ChatConversation>(cloud, 'chats', local.chats).map((c) => ({
          ...c,
          messages: c.messages ?? [],
        }));
        setChats(chats);
        localStorage.setItem('malacadhati_chats', JSON.stringify(chats));

        let dedicatedFolders: QuizFolder[] = [];
        let dedicatedSets: QuizSet[] = [];
        try {
          const folderRes = await fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`);
          if (folderRes.ok) dedicatedFolders = firebaseToArray<QuizFolder>(await folderRes.json());
        } catch { /* ignore */ }
        try {
          const setRes = await fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`);
          if (setRes.ok) {
            dedicatedSets = firebaseToArray<QuizSet>(await setRes.json()).map((set) => ({ ...set, items: set.items ?? [] }));
          }
        } catch { /* ignore */ }

        const rawFolders = mergeById(
          cloud ? firebaseToArray<QuizFolder>(cloud.quizFolders as QuizFolder[] | Record<string, QuizFolder>) : [],
          dedicatedFolders,
          local.folders,
        );
        const rawSets: QuizSet[] = mergeById(
          cloud
            ? firebaseToArray<QuizSet>(cloud.quizSets as QuizSet[] | Record<string, QuizSet>).map((set) => ({ ...set, items: set.items ?? [] }))
            : [],
          dedicatedSets,
          local.sets,
        );
        const normalizedFolders = finalizeQuizFolders(rawFolders, rawSets);
        const normalizedSets = initializeQuizColors(
          rawSets,
          normalizedFolders.map((folder) => folder.color).filter((color): color is string => !!color),
        );
        setQuizSets(normalizedSets);
        localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(normalizedSets));
        if (normalizedSets.some((set, index) => set !== rawSets[index])) {
          void fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`, {
            method: 'PUT',
            body: JSON.stringify(normalizedSets),
            headers: { 'Content-Type': 'application/json' },
          });
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

        const cloudDrafts = cloud?.drafts;
        if (Array.isArray(cloudDrafts) && cloudDrafts.length) {
          const dc = (cloud?.draftContents as Record<string, { title?: string; html?: string }> | undefined) || {};
          setDrafts(
            cloudDrafts.map((id) => ({
              id: String(id),
              title: dc[String(id)]?.title || '',
              html: dc[String(id)]?.html || '',
            })),
          );
          draftCounter.current = (cloud?.draftId as number | undefined) || cloudDrafts.length;
        } else {
          draftCounter.current = 1;
          setDrafts([{ id: 'd1', title: '', html: '' }]);
        }
      } catch {
        if (cancelled) return;
        applyLocalFallback();
      } finally {
        if (!cancelled) {
          setLoaded(true);
          if (user) setCloudStatus('saved');
        }
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
    if (user) {
      void fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`, {
        method: 'PUT',
        body: JSON.stringify(nextFolders),
        headers: { 'Content-Type': 'application/json' },
      });
      void appendFolderHistory(user.uid, nextFolders);
    }
  };

  const appendFolderHistory = async (uid: string, folders: QuizFolder[]) => {
    const key = String(Date.now());
    await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory/${key}.json`, {
      method: 'PUT',
      body: JSON.stringify(folders),
      headers: { 'Content-Type': 'application/json' },
    });
    try {
      const res = await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory.json?shallow=true`);
      const keys = Object.keys((await res.json()) || {}).sort();
      const overflow = keys.length - MAX_FOLDER_HISTORY;
      for (let i = 0; i < overflow; i += 1) {
        await fetch(`${FB_DB_URL}/users/${uid}/quizFoldersHistory/${keys[i]}.json`, { method: 'DELETE' });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!loaded || !user) return;
    setQuizFolders((prev) => {
      const next = ensureFavoritesFolder(ensureRestoredFolder(prev));
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        persistFolders(next);
      }
      return next;
    });
    setQuizSets((prev) => {
      const next = ensureFavoritesSet(prev);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        persistSets(next);
      }
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

  const userRef = useRef(user);
  userRef.current = user;

  const addTokens = useRef((n: number) => {
    setTokenUsage((prev) => {
      const next = prev + n;
      const u = userRef.current;
      if (u) {
        fetch(`${FB_DB_URL}/users/${u.uid}/tokenUsage.json`, {
          method: 'PUT',
          body: JSON.stringify(next),
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return next;
    });
  }).current;

  useEffect(() => {
    setTokenSink(addTokens);
    return () => setTokenSink(() => {});
  }, [addTokens]);

  const persist = (nextNotes: Note[], nextDrafts?: Draft[], nextQuizzes?: QuizItem[], nextChats?: ChatConversation[], nextQuizSets?: QuizSet[], nextQuizFolders?: QuizFolder[]) => {
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    const qList = nextQuizzes ?? quizzes;
    localStorage.setItem('malacadhati_quiz', JSON.stringify(qList));
    if (!user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savesInFlight.current += 1;
      setCloudStatus('saving');
      savingStartedAt.current = Date.now();
      const dList = nextDrafts ?? drafts;
      const chatList = nextChats ?? chats;
      const qsList = nextQuizSets ?? quizSets;
      const qfList = nextQuizFolders ?? quizFolders;
      const draftContents: Record<string, { title: string; html: string }> = {};
      dList.forEach((d) => {
        draftContents[d.id] = { title: d.title, html: d.html };
      });
      fetch(`${FB_DB_URL}/users/${user.uid}.json`, {
        method: 'PATCH',
        body: JSON.stringify({
          notes: nextNotes,
          drafts: dList.map((d) => d.id),
          draftId: draftCounter.current,
          draftContents,
          quizzes: qList,
          chats: chatList,
          quizSets: qsList,
          quizFolders: qfList,
          tokenUsage,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
        .catch(() => {})
        .finally(() => {
          savesInFlight.current = Math.max(0, savesInFlight.current - 1);
          if (savesInFlight.current === 0) {
            const elapsed = Date.now() - savingStartedAt.current;
            const delay = Math.max(0, MIN_SYNC_VISIBLE_MS - elapsed);
            const markSaved = () => setCloudStatus('saved');
            if (delay > 0) setTimeout(markSaved, delay);
            else markSaved();
          }
        });
    }, 1200);
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

  const addQuiz = (item: Omit<QuizItem, 'id'>): number => {
    const newId = Date.now();
    setQuizzes((prev) => {
      const now = new Date().toISOString();
      const next = [...prev, { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now }];
      persist(notes, undefined, next);
      return next;
    });
    return newId;
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

  const updateQuiz = (id: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => {
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
    if (id === FAVORITES_SET_ID) return;
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
    if (id === FAVORITES_SET_ID) return;
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
      if (next[from].system || next[to].system) return prev;
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
    if (id === FAVORITES_SET_ID) return;
    setQuizSets((prev) => {
      const set = prev.find((s) => s.id === id);
      if (set?.system) return prev;
      if (folderId && quizFolders.find((f) => f.id === folderId)?.system) return prev;
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
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, name } : f));
      persistFolders(next);
      return next;
    });
  };

  const setQuizFolderColor = (id: string, color: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    setQuizFolders((prev) => {
      const next = prev.map((f) => (f.id === id ? { ...f, color, colorInitialized: true } : f));
      persistFolders(next);
      return next;
    });
  };

  const reorderQuizFolders = (dragId: string, targetId: string) => {
    setQuizFolders((prev) => {
      const drag = prev.find((f) => f.id === dragId);
      const target = prev.find((f) => f.id === targetId);
      if (!drag || !target || drag.system || target.system || dragId === targetId) return prev;
      const systemFolders = prev.filter((f) => f.system);
      const normalFolders = prev.filter((f) => !f.system);
      const from = normalFolders.findIndex((f) => f.id === dragId);
      const to = normalFolders.findIndex((f) => f.id === targetId);
      if (from < 0 || to < 0) return prev;
      const [item] = normalFolders.splice(from, 1);
      normalFolders.splice(to, 0, item);
      const next = [...systemFolders, ...normalFolders];
      persistFolders(next);
      return next;
    });
  };

  const deleteQuizFolder = (id: string) => {
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
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
    if (id === RESTORED_FOLDER_ID || id === FAVORITES_FOLDER_ID) return;
    const nextSets = quizSets.map((s) => s.folderId === id ? { ...s, folderId: undefined } : s);
    const nextFolders = quizFolders.filter((f) => f.id !== id);
    setQuizSets(nextSets);
    setQuizFolders(nextFolders);
    localStorage.setItem('malacadhati_quiz_sets', JSON.stringify(nextSets));
    localStorage.setItem('malacadhati_quiz_folders', JSON.stringify(nextFolders));
    persist(notes, undefined, undefined, undefined, nextSets, nextFolders);
  };

  const recoverQuizFolders = async (): Promise<number> => {
    if (!user) return 0;
    const before = new Set(quizFolders.filter((folder) => !folder.system && !folder.trashed).map((folder) => folder.id));
    let cloudFolders: QuizFolder[] = [];
    let cloudSets: QuizSet[] = [];
    let dedicatedFolders: QuizFolder[] = [];
    let dedicatedSets: QuizSet[] = [];
    try {
      const cloud = await fetch(`${FB_DB_URL}/users/${user.uid}.json`).then((r) => r.json());
      cloudFolders = firebaseToArray<QuizFolder>(cloud?.quizFolders);
      cloudSets = firebaseToArray<QuizSet>(cloud?.quizSets).map((set) => ({ ...set, items: set.items ?? [] }));
    } catch { /* ignore */ }
    try {
      dedicatedFolders = firebaseToArray<QuizFolder>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizFolders.json`).then((r) => r.json()));
    } catch { /* ignore */ }
    try {
      dedicatedSets = firebaseToArray<QuizSet>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizSets.json`).then((r) => r.json())).map((set) => ({ ...set, items: set.items ?? [] }));
    } catch { /* ignore */ }

    const rawFolders = mergeById(
      cloudFolders,
      dedicatedFolders,
      quizFolders,
      firebaseToArray<QuizFolder>(readLocalJson<QuizFolder[]>('malacadhati_quiz_folders') ?? []),
    );
    const rawSets = mergeById(
      cloudSets,
      dedicatedSets,
      quizSets,
      firebaseToArray<QuizSet>(readLocalJson<QuizSet[]>('malacadhati_quiz_sets') ?? []).map((set) => ({ ...set, items: set.items ?? [] })),
    );
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(rawFolders, rawSets));
    const nextSets = ensureFavoritesSet(initializeQuizColors(rawSets, nextFolders.map((folder) => folder.color).filter((color): color is string => !!color)));
    setQuizFolders(nextFolders);
    setQuizSets(nextSets);
    persistFolders(nextFolders);
    persistSets(nextSets);
    const after = nextFolders.filter((folder) => !folder.system && !folder.trashed);
    return after.filter((folder) => !before.has(folder.id)).length;
  };

  const listQuizFolderBackups = async (): Promise<{ key: string; label: string; folderCount: number }[]> => {
    if (!user) return [];
    try {
      const res = await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory.json?shallow=true`);
      const keys = Object.keys((await res.json()) || {}).sort().reverse();
      const snapshots = await Promise.all(keys.map(async (key) => {
        const folders = firebaseToArray<QuizFolder>(await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory/${key}.json`).then((r) => r.json()));
        const userFolders = folders.filter((folder) => !folder.system);
        const names = userFolders.map((folder) => folder.name).slice(0, 3).join(', ');
        return {
          key,
          label: new Date(Number(key)).toLocaleString(t.dateLocale),
          folderCount: userFolders.length,
          names,
        };
      }));
      return snapshots.map(({ key, label, folderCount, names }) => ({
        key,
        label: names ? `${label} · ${names}` : label,
        folderCount,
      }));
    } catch {
      return [];
    }
  };

  const restoreQuizFolderBackup = async (key: string): Promise<number> => {
    if (!user) return 0;
    const before = new Set(quizFolders.filter((folder) => !folder.system).map((folder) => folder.id));
    const folders = firebaseToArray<QuizFolder>(
      await fetch(`${FB_DB_URL}/users/${user.uid}/quizFoldersHistory/${key}.json`).then((r) => r.json()),
    );
    const nextFolders = ensureFavoritesFolder(finalizeQuizFolders(folders, quizSets));
    setQuizFolders(nextFolders);
    persistFolders(nextFolders);
    const after = nextFolders.filter((folder) => !folder.system && !folder.trashed);
    return after.filter((folder) => !before.has(folder.id)).length;
  };

  const addItemToSet = (setId: string, item: Omit<QuizItem, 'id'>): number => {
    const now = new Date().toISOString();
    const newId = Date.now();
    const newItem: QuizItem = { ...item, id: newId, createdAt: item.createdAt ?? now, updatedAt: now };
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: [...s.items, newItem] } : s);
      persistSets(next);
      return next;
    });
    return newId;
  };

  const removeItemFromSet = (setId: string, itemId: number) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s);
      persistSets(next);
      return next;
    });
  };

  const updateItemInSet = (setId: string, itemId: number, patch: Partial<Pick<QuizItem, 'question' | 'answer' | 'options' | 'correctIndex' | 'correctIndexes' | 'explanation' | 'draft'>>) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => s.id === setId ? { ...s, items: s.items.map((i) => i.id === itemId ? { ...i, ...patch, updatedAt: new Date().toISOString() } : i) } : s);
      persistSets(next);
      return next;
    });
  };

  const moveItemInSet = (setId: string, itemId: number, direction: 'up' | 'down') => {
    setQuizSets((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const idx = items.findIndex((i) => i.id === itemId);
        if (idx < 0) return s;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= items.length) return s;
        [items[idx], items[swapIdx]] = [items[swapIdx], items[idx]];
        changed = true;
        return { ...s, items };
      });
      if (!changed) return prev;
      persistSets(next);
      return next;
    });
  };

  const moveQuiz = (itemId: number, direction: 'up' | 'down') => {
    setQuizzes((prev) => {
      const next = [...prev];
      const idx = next.findIndex((q) => q.id === itemId);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      persist(notes, undefined, next);
      return next;
    });
  };

  const reorderItemInSet = (setId: string, dragId: number, targetId: number) => {
    setQuizSets((prev) => {
      let changed = false;
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        const items = [...s.items];
        const from = items.findIndex((i) => i.id === dragId);
        const to = items.findIndex((i) => i.id === targetId);
        if (from < 0 || to < 0 || from === to) return s;
        const [item] = items.splice(from, 1);
        items.splice(to, 0, item);
        changed = true;
        return { ...s, items };
      });
      if (!changed) return prev;
      persistSets(next);
      return next;
    });
  };

  const reorderQuiz = (dragId: number, targetId: number) => {
    setQuizzes((prev) => {
      const next = [...prev];
      const from = next.findIndex((q) => q.id === dragId);
      const to = next.findIndex((q) => q.id === targetId);
      if (from < 0 || to < 0 || from === to) return prev;
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      persist(notes, undefined, next);
      return next;
    });
  };

  const orderItemsByIds = (items: QuizItem[], itemIds: number[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    const ordered = itemIds.map((id) => byId.get(id)).filter((i): i is QuizItem => !!i);
    const rest = items.filter((i) => !itemIds.includes(i.id));
    return [...ordered, ...rest];
  };

  const setItemsOrderInSet = (setId: string, itemIds: number[]) => {
    setQuizSets((prev) => {
      const next = prev.map((s) => {
        if (s.id !== setId) return s;
        return { ...s, items: orderItemsByIds(s.items, itemIds) };
      });
      persistSets(next);
      return next;
    });
  };

  const setQuizzesOrder = (itemIds: number[]) => {
    setQuizzes((prev) => {
      const next = orderItemsByIds(prev, itemIds);
      persist(notes, undefined, next);
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
        reorderQuizFolders,
        setQuizFolderColor,
        deleteQuizFolder,
        restoreQuizFolder,
        permDeleteQuizFolder,
        recoverQuizFolders,
        listQuizFolderBackups,
        restoreQuizFolderBackup,
        addItemToSet,
        removeItemFromSet,
        updateItemInSet,
        moveItemInSet,
        reorderItemInSet,
        setItemsOrderInSet,
        moveQuiz,
        reorderQuiz,
        setQuizzesOrder,
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
