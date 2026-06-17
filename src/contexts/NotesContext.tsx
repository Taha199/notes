import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Note } from '../types';
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
  cloudStatus: CloudStatus;
  loaded: boolean;
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

  const persist = (nextNotes: Note[], nextDrafts?: Draft[]) => {
    localStorage.setItem('malacadhati', JSON.stringify(nextNotes));
    if (!user) return;
    setCloudStatus('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    clearTimeout(hideTimer.current ?? undefined);
    saveTimer.current = setTimeout(() => {
      const dList = nextDrafts ?? drafts;
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

  const toggleRead = (id: number) => updateNote(id, { read: true });
  const toggleUnread = (id: number) => updateNote(id, { read: false });
  const toggleFav = (id: number) =>
    mutateNotes((prev) => prev.map((n) => (n.id === id ? { ...n, fav: !n.fav } : n)));
  const archive = (id: number) => updateNote(id, { archived: true });
  const unarchive = (id: number) => updateNote(id, { archived: false, read: false });
  const trash = (id: number) => updateNote(id, { trashed: true });
  const restore = (id: number) => updateNote(id, { trashed: false });
  const permDelete = (id: number) => mutateNotes((prev) => prev.filter((n) => n.id !== id));
  const emptyTrash = () => mutateNotes((prev) => prev.filter((n) => !n.trashed));
  const deleteMany = (ids: number[]) => {
    const idSet = new Set(ids);
    mutateNotes((prev) => prev.filter((n) => !idSet.has(n.id)));
  };

  return (
    <NotesContext.Provider
      value={{
        notes,
        drafts,
        cloudStatus,
        loaded,
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
