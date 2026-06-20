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
import { FilesPage } from './files/FilesPage';
import { QuizPage } from './quiz/QuizPage';
import { ChatPage } from './chat/ChatPage';
import { ConfirmDialog } from './common/ConfirmDialog';

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
    <div className="grid grid-cols-1 gap-3.5 px-3 pb-6 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 xl:grid-cols-4">
      {filtered.map((n) => (
        <NoteCard key={n.id} note={n} onOpen={onOpen} selectMode={selectMode} selected={selected?.has(n.id)} onToggleSelect={onToggleSelect} />
      ))}
    </div>
  );
}

function DeletedQuizCard({ icon, name, color, detail, createdAt, deletedAt, createdLabel, deletedLabel, restoreLabel, deleteLabel, restoreTo, onRestore, onDelete }: {
  icon: string;
  name: string;
  color?: string;
  detail: string;
  createdAt: string;
  deletedAt?: string;
  createdLabel: string;
  deletedLabel: string;
  restoreLabel: string;
  deleteLabel: string;
  restoreTo?: string;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-800/60">
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color || '#9ca3af' }} />
      <div className="flex items-start gap-3">
        <span className="text-xl">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-app-text dark:text-gray-100">{name}</p>
          <p className="mt-0.5 text-[11px] text-app-text-secondary dark:text-gray-400">{detail}</p>
          <div className="mt-2 space-y-0.5 text-[10px] text-app-text-secondary/60">
            <p>{createdLabel}: {createdAt}</p>
            {deletedAt && <p>{deletedLabel}: {deletedAt}</p>}
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2 border-t border-app-border/70 pt-3 dark:border-white/10">
        <button onClick={onRestore} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10">↩ {restoreLabel}</button>
        <button onClick={onDelete} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">🗑 {deleteLabel}</button>
      </div>
      {restoreTo && (
        <p className="mt-2 text-[10px] text-emerald-600/70 dark:text-emerald-400/60">{restoreTo}</p>
      )}
    </div>
  );
}

export function Dashboard() {
  const { t, lang } = useLanguage();
  const { notes, drafts, trashedQuizzes, quizSets, quizFolders, addDraft, emptyTrash, deleteMany, restoreQuiz, permDeleteQuiz, restoreQuizSet, permDeleteQuizSet, restoreQuizFolder, permDeleteQuizFolder } = useNotes();
  const { show } = useToast();
  const [page, setPage] = useState<Page>('home');
  const [search, setSearch] = useState('');
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmDelSel, setConfirmDelSel] = useState(false);
  const [confirmQuizTrash, setConfirmQuizTrash] = useState<{ type: 'set' | 'folder' | 'question'; id: string | number } | null>(null);
  const hasSearch = normalizeSearch(search).length > 0;

  const active = useMemo(() => notes.filter((n) => !n.archived && !n.trashed), [notes]);
  const unread = useMemo(() => active.filter((n) => !n.read), [active]);
  const fav = useMemo(() => active.filter((n) => n.fav), [active]);
  const favArch = useMemo(() => notes.filter((n) => n.fav && n.archived && !n.trashed), [notes]);
  const read = useMemo(() => notes.filter((n) => n.read && !n.archived && !n.trashed), [notes]);
  const archived = useMemo(() => notes.filter((n) => n.archived && !n.trashed), [notes]);
  const trashed = useMemo(() => notes.filter((n) => n.trashed), [notes]);
  const trashedQuizQuestions = trashedQuizzes;
  const trashedQuizSets = useMemo(() => quizSets.filter((set) => set.trashed), [quizSets]);
  const trashedQuizFolders = useMemo(() => quizFolders.filter((folder) => folder.trashed), [quizFolders]);
  const visibleTrashedNotes = useMemo(() => trashed.filter((note) => noteMatchesSearch(note, search)), [search, trashed]);
  const visibleTrashedSets = useMemo(() => {
    const query = normalizeSearch(search);
    return query ? trashedQuizSets.filter((set) => normalizeSearch(set.name).includes(query)) : trashedQuizSets;
  }, [search, trashedQuizSets]);
  const visibleTrashedFolders = useMemo(() => trashedQuizFolders.filter((folder) => normalizeSearch(folder.name).includes(normalizeSearch(search))), [search, trashedQuizFolders]);
  const trashTotal = trashed.length + trashedQuizQuestions.length + trashedQuizSets.length + trashedQuizFolders.length;
  const trashCopy = lang === 'sv'
    ? { notes: 'Anteckningar', sets: 'Sets', folders: 'Mappar', questions: 'Frågor', restore: 'Återställ', delete: 'Radera permanent', questionsUnit: 'frågor', folderSets: 'sets', created: 'Skapad', deletedAt: 'Raderad', deleted: 'Radera permanent?', empty: 'Papperskorgen är tom', emptyConfirm: 'Radera allt i papperskorgen permanent?' }
    : { notes: 'Notes', sets: 'Sets', folders: 'Folders', questions: 'Questions', restore: 'Restore', delete: 'Delete permanently', questionsUnit: 'questions', folderSets: 'sets', created: 'Created', deletedAt: 'Deleted', deleted: 'Delete permanently?', empty: 'Trash is empty', emptyConfirm: 'Permanently delete everything in trash?' };
  const navigableNotes = useMemo(() => {
    const source = page === 'unread' ? unread
      : page === 'read' ? read
        : page === 'archive' ? archived
          : page === 'fav' ? [...fav, ...favArch]
            : active;
    return hasSearch ? source.filter((note) => noteMatchesSearch(note, search)) : source;
  }, [active, archived, fav, favArch, hasSearch, page, read, search, unread]);
  const openNoteIndex = openNoteId === null ? -1 : navigableNotes.findIndex((note) => note.id === openNoteId);
  const previousNoteId = openNoteIndex > 0 ? navigableNotes[openNoteIndex - 1]?.id : undefined;
  const nextNoteId = openNoteIndex >= 0 && openNoteIndex < navigableNotes.length - 1 ? navigableNotes[openNoteIndex + 1]?.id : undefined;

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
    <div className="flex h-[100dvh] overflow-hidden bg-white dark:bg-gray-950">
      {mobileMenuOpen && <button aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 z-30 bg-gray-950/35 backdrop-blur-sm md:hidden" />}
      <Sidebar page={page} setPage={setPage} onOpenSetPassword={() => setShowSetPassword(true)} mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header page={page} search={search} setSearch={setSearch} onNewNote={handleNewNote} onOpenMenu={() => setMobileMenuOpen(true)} />

        <div className={`flex-1 ${page === 'chat' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {page === 'home' && hasSearch && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🔎 {t.secAll}</div>
              <NoteList notes={active} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'home' && !hasSearch && (
            <div className="flex min-h-full flex-col gap-3.5 bg-app-bg p-3 dark:bg-white/5 sm:p-5">
              {drafts.map((d, i) => (
                <DraftEditor key={d.id} draft={d} index={i} total={drafts.length} />
              ))}
              <div className="-mx-3 -mb-3 px-3 pb-3 pt-2 dark:bg-gray-950 sm:-mx-5 sm:px-5">
                <button
                  onClick={addDraft}
                  aria-label={t.tAddNote}
                  title={t.tAddNote}
                  className="flex w-full items-center justify-center rounded-2xl border-2 border-dashed border-app-border py-4 text-xl text-app-text-secondary/50 transition-all hover:border-primary hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:hover:border-primary/50 dark:hover:bg-primary/10"
                >
                  +
                </button>
              </div>
            </div>
          )}

          {page === 'library' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

          {page === 'files' && <FilesPage search={search} />}
          {page === 'quiz' && <QuizPage />}
          {page === 'chat' && <ChatPage />}

          {page === 'unread' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">📖 {t.secUnread}</div>
              <NoteList notes={unread} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'read' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">✓ {t.secRead}</div>
              <NoteList notes={read} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'archive' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🗄 {t.secArch}</div>
              <NoteList notes={archived} search={search} emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} />
            </div>
          )}

          {page === 'fav' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
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
              <div className="flex flex-col items-stretch justify-between gap-2 border-b border-app-border bg-white px-3 py-3 dark:border-white/10 dark:bg-gray-900 sm:flex-row sm:items-center sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-app-text dark:text-gray-100">🗑 {t.pageTrash}</span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-[11px] font-semibold text-app-text-secondary dark:bg-white/10">{trashTotal}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trashed.length > 0 && (
                    <button
                      onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}
                      className="rounded-lg border border-app-border px-3.5 py-1.5 text-[13px] font-medium text-app-text hover:bg-app-bg dark:border-white/10 dark:text-gray-200"
                    >
                      {selectMode ? t.cancelSel : t.selDel}
                    </button>
                  )}
                  {selectMode && selected.size > 0 && (
                    <button
                      onClick={() => setConfirmDelSel(true)}
                      className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700"
                    >
                      🗑 {t.delSelected} ({selected.size})
                    </button>
                  )}
                  {trashTotal > 0 && (
                    <button
                      onClick={() => setConfirmEmptyTrash(true)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-1.5 text-[13px] font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10"
                    >
                      🗑✕ {t.emptyTrashBtn}
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-7 px-3 py-4 sm:px-5 sm:py-5">
                {visibleTrashedNotes.length > 0 && (
                  <section>
                    <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">📝 {trashCopy.notes} · {visibleTrashedNotes.length}</div>
                    <NoteList notes={visibleTrashedNotes} search="" emptySearchText={t.emptySearch} emptyText={t.emptyTrash} onOpen={() => {}} selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect} />
                  </section>
                )}

                {visibleTrashedSets.length > 0 && (
                  <section>
                    <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">🧠 {trashCopy.sets} · {visibleTrashedSets.length}</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {visibleTrashedSets.map((set) => (
                        <DeletedQuizCard
                          key={set.id}
                          icon="🧠"
                          name={set.name}
                          color={set.color}
                          detail={`${set.items?.length ?? 0} ${trashCopy.questions}`}
                          createdAt={set.createdAt}
                          deletedAt={set.deletedAt}
                          createdLabel={trashCopy.created}
                          deletedLabel={trashCopy.deletedAt}
                          restoreLabel={trashCopy.restore}
                          deleteLabel={trashCopy.delete}
                          restoreTo={lang === 'sv' ? '↩ Återställs till Quiz → Sets' : '↩ Restores to Quiz → Sets'}
                          onRestore={() => { restoreQuizSet(set.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Sets' : '↩ Restored to Quiz → Sets'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'set', id: set.id })}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {visibleTrashedFolders.length > 0 && (
                  <section>
                    <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">📁 {trashCopy.folders} · {visibleTrashedFolders.length}</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {visibleTrashedFolders.map((folder) => (
                        <DeletedQuizCard
                          key={folder.id}
                          icon="📁"
                          name={folder.name}
                          color={folder.color}
                          detail={`${quizSets.filter((set) => set.folderId === folder.id && !set.trashed).length} ${trashCopy.folderSets}`}
                          createdAt={folder.createdAt}
                          deletedAt={folder.deletedAt}
                          createdLabel={trashCopy.created}
                          deletedLabel={trashCopy.deletedAt}
                          restoreLabel={trashCopy.restore}
                          deleteLabel={trashCopy.delete}
                          restoreTo={lang === 'sv' ? '↩ Återställs till Quiz → Mappar' : '↩ Restores to Quiz → Folders'}
                          onRestore={() => { restoreQuizFolder(folder.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Mappar' : '↩ Restored to Quiz → Folders'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'folder', id: folder.id })}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {trashedQuizQuestions.length > 0 && (
                  <section>
                    <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">❓ {trashCopy.questions} · {trashedQuizQuestions.length}</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {trashedQuizQuestions.map((q) => (
                        <DeletedQuizCard
                          key={q.id}
                          icon="❓"
                          name={q.question.replace(/<[^>]*>/g, '').slice(0, 80)}
                          detail={q.noteTitle}
                          createdAt={q.date}
                          deletedAt={q.deletedAt}
                          createdLabel={trashCopy.created}
                          deletedLabel={trashCopy.deletedAt}
                          restoreLabel={trashCopy.restore}
                          deleteLabel={trashCopy.delete}
                          restoreTo={lang === 'sv' ? '↩ Återställs till Quiz → Frågor från anteckningar' : '↩ Restores to Quiz → Questions from Notes'}
                          onRestore={() => { restoreQuiz(q.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Frågor från anteckningar' : '↩ Restored to Quiz → Questions from Notes'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'question', id: q.id })}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {visibleTrashedNotes.length === 0 && trashedQuizQuestions.length === 0 && visibleTrashedSets.length === 0 && visibleTrashedFolders.length === 0 && (
                  <EmptyState text={hasSearch ? t.emptySearch : trashCopy.empty} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {openNoteId !== null && (
        <NoteEditorModal
          noteId={openNoteId}
          previousNoteId={previousNoteId}
          nextNoteId={nextNoteId}
          onChangeNote={setOpenNoteId}
          onClose={() => setOpenNoteId(null)}
          onNavigate={(p) => { setPage(p); setOpenNoteId(null); }}
        />
      )}
      {showSetPassword && <SetPasswordModal onClose={() => setShowSetPassword(false)} />}
      {confirmEmptyTrash && (
        <ConfirmDialog
          message={trashCopy.emptyConfirm}
          count={trashTotal}
          countLabel={lang === 'sv' ? 'objekt' : 'items'}
          confirmLabel={t.emptyTrashBtn}
          cancelLabel="Cancel"
          onConfirm={() => { setConfirmEmptyTrash(false); emptyTrash(); show(t.tTrashEmpty); }}
          onCancel={() => setConfirmEmptyTrash(false)}
        />
      )}
      {confirmQuizTrash && (
        <ConfirmDialog
          message={trashCopy.deleted}
          confirmLabel={trashCopy.delete}
          cancelLabel={lang === 'sv' ? 'Avbryt' : 'Cancel'}
          onConfirm={() => {
            if (confirmQuizTrash.type === 'set') permDeleteQuizSet(confirmQuizTrash.id as string);
            else if (confirmQuizTrash.type === 'folder') permDeleteQuizFolder(confirmQuizTrash.id as string);
            else permDeleteQuiz(confirmQuizTrash.id as number);
            setConfirmQuizTrash(null);
            show(t.tPermDel);
          }}
          onCancel={() => setConfirmQuizTrash(null)}
        />
      )}
      {confirmDelSel && (
        <ConfirmDialog
          message={t.cDelSel}
          count={selected.size}
          confirmLabel={t.delSelected}
          cancelLabel="Cancel"
          onConfirm={() => { setConfirmDelSel(false); deleteMany([...selected]); setSelected(new Set()); setSelectMode(false); show(t.tDelSel); }}
          onCancel={() => setConfirmDelSel(false)}
        />
      )}
    </div>
  );
}
