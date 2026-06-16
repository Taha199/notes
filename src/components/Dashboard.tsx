import { useMemo, useState } from 'react';
import type { Page, Note } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useNotes } from '../contexts/NotesContext';
import { useToast } from '../contexts/ToastContext';
import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';
import { NoteCard } from './notes/NoteCard';
import { DraftEditor } from './notes/DraftEditor';
import { NoteEditorModal } from './notes/NoteEditorModal';
import { SetPasswordModal } from './auth/SetPasswordModal';

function EmptyState({ text }: { text: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
      <span className="mb-3 text-5xl opacity-30">🗒️</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function noteMatchesSearch(note: Note, search: string) {
  const query = normalizeSearch(search);
  if (!query) return true;
  const plainHtml = note.html.replace(/<[^>]*>/g, ' ');
  const haystack = normalizeSearch([note.title, note.text, plainHtml, note.date].join(' '));
  return haystack.includes(query);
}

function NoteList({ notes, search, emptySearchText, emptyText, onOpen, selectMode, selected, onToggleSelect }: {
  notes: Note[];
  search: string;
  emptySearchText: string;
  emptyText: string;
  onOpen: (id: number) => void;
  selectMode?: boolean;
  selected?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const hasSearch = normalizeSearch(search).length > 0;
  const filtered = hasSearch ? notes.filter((n) => noteMatchesSearch(n, search)) : notes;
  if (!filtered.length) return <EmptyState text={hasSearch ? emptySearchText : emptyText} />;
  return (
    <div className="grid grid-cols-1 gap-3.5 px-5 pb-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {filtered.map((n) => (
        <NoteCard key={n.id} note={n} onOpen={onOpen} selectMode={selectMode} selected={selected?.has(n.id)} onToggleSelect={onToggleSelect} />
      ))}
    </div>
  );
}

export function Dashboard() {
  const { t } = useLanguage();
  const { notes, drafts, addDraft, emptyTrash, deleteMany } = useNotes();
  const { show } = useToast();
  const [page, setPage] = useState<Page>('home');
  const [search, setSearch] = useState('');
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const hasSearch = normalizeSearch(search).length > 0;

  const active = useMemo(() => notes.filter((n) => !n.archived && !n.trashed), [notes]);
  const unread = useMemo(() => active.filter((n) => !n.read), [active]);
  const fav = useMemo(() => active.filter((n) => n.fav), [active]);
  const favArch = useMemo(() => notes.filter((n) => n.fav && n.archived && !n.trashed), [notes]);
  const read = useMemo(() => notes.filter((n) => n.read && !n.archived && !n.trashed), [notes]);
  const archived = useMemo(() => notes.filter((n) => n.archived && !n.trashed), [notes]);
  const trashed = useMemo(() => notes.filter((n) => n.trashed), [notes]);

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleNewNote = () => {
    if (page !== 'home') setPage('home');
    addDraft();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-white dark:bg-gray-950">
      <Sidebar page={page} setPage={setPage} onOpenSetPassword={() => setShowSetPassword(true)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header page={page} search={search} setSearch={setSearch} onNewNote={handleNewNote} />

        <div className="flex-1 overflow-y-auto">
          {page === 'home' && hasSearch && (
            <div className="px-5 py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🔎 {t.secAll}</div>
              <NoteList notes={active} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'home' && !hasSearch && (
            <div className="grid grid-cols-1 gap-3.5 border-b border-app-border bg-app-bg p-5 dark:border-white/10 dark:bg-white/5 lg:grid-cols-2 xl:grid-cols-3">
              {drafts.map((d, i) => (
                <DraftEditor key={d.id} draft={d} index={i} total={drafts.length} />
              ))}
              <button
                onClick={addDraft}
                className="min-h-[120px] rounded-2xl border-2 border-dashed border-app-border text-xl text-app-text-secondary/60 transition-all hover:border-primary hover:bg-primary/5 hover:text-primary dark:border-white/10"
              >
                +
              </button>
            </div>
          )}

          {page === 'library' && (
            <div className="px-5 py-5">
              <div className="mb-4 grid grid-cols-3 gap-3">
                {[
                  { n: active.length, l: t.statActive, c: 'text-primary' },
                  { n: unread.length, l: t.statUnread, c: 'text-blue-600' },
                  { n: fav.length, l: t.statFav, c: 'text-amber-600' },
                ].map((s, i) => (
                  <div key={i} className="rounded-2xl border border-app-border bg-white p-4 text-center shadow-sm dark:border-white/10 dark:bg-white/5">
                    <div className={'text-2xl font-bold ' + s.c}>{s.n}</div>
                    <div className="mt-1 text-[11.5px] font-medium text-app-text-secondary dark:text-gray-400">{s.l}</div>
                  </div>
                ))}
              </div>
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">📚 {t.secAll}</div>
              <NoteList notes={active} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'unread' && (
            <div className="px-5 py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">📖 {t.secUnread}</div>
              <NoteList notes={unread} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'read' && (
            <div className="px-5 py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">✓ {t.secRead}</div>
              <NoteList notes={read} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'archive' && (
            <div className="px-5 py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🗄 {t.secArch}</div>
              <NoteList notes={archived} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'fav' && (
            <div className="px-5 py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">★ {t.secFav}</div>
              <NoteList notes={fav} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
              {favArch.length > 0 && (
                <>
                  <div className="mb-2.5 mt-7 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🗄 {t.secFavArch}</div>
                  <NoteList notes={favArch} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
                </>
              )}
            </div>
          )}

          {page === 'trash' && (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-app-border bg-white px-5 py-3 dark:border-white/10 dark:bg-gray-900">
                <button
                  onClick={() => {
                    setSelectMode((s) => !s);
                    setSelected(new Set());
                  }}
                  className="rounded-lg border border-app-border px-3.5 py-1.5 text-[13px] font-medium text-app-text hover:bg-app-bg dark:border-white/10 dark:text-gray-200"
                >
                  {selectMode ? t.cancelSel : t.selDel}
                </button>
                <div className="flex gap-2">
                  {selectMode && selected.size > 0 && (
                    <button
                      onClick={() => {
                        if (confirm(t.cDelSel)) {
                          deleteMany([...selected]);
                          setSelected(new Set());
                          setSelectMode(false);
                          show(t.tDelSel);
                        }
                      }}
                      className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700"
                    >
                      🗑 {t.delSelected} ({selected.size})
                    </button>
                  )}
                  {trashed.length > 0 && (
                    <button
                      onClick={() => {
                        if (confirm(t.cEmptyTrash)) {
                          emptyTrash();
                          show(t.tTrashEmpty);
                        }
                      }}
                      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-[13px] font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10"
                    >
                      🗑✕ {t.emptyTrashBtn}
                    </button>
                  )}
                </div>
              </div>
              <div className="px-5 py-5">
                <NoteList
                  notes={trashed}
                  search={search}
                  emptySearchText={t.emptySearch}
                  emptyText={t.emptyTrash}
                  onOpen={() => {}}
                  selectMode={selectMode}
                  selected={selected}
                  onToggleSelect={toggleSelect}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {openNoteId !== null && <NoteEditorModal noteId={openNoteId} onClose={() => setOpenNoteId(null)} />}
      {showSetPassword && <SetPasswordModal onClose={() => setShowSetPassword(false)} />}
    </div>
  );
}
