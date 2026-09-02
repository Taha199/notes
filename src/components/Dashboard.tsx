import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type { Page, Note, NoteViewMode } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { useNotes, FAVORITES_SET_ID } from '../contexts/NotesContext';
import { useToast } from '../contexts/ToastContext';
import { pageFromPath, pathFromPage } from '../lib/pageRoute';
import { SHOW_ADMIN_PANEL } from '../lib/firebase';
import { sortNotesByCreatedDesc } from '../lib/noteSort';
import { Sidebar } from './layout/Sidebar';
import { Header } from './layout/Header';
import { NoteCard } from './notes/NoteCard';
import { NoteViewToggle } from './notes/NoteViewToggle';
import { DraftEditor } from './notes/DraftEditor';
import { NoteEditorModal } from './notes/NoteEditorModal';
import { SetPasswordModal } from './auth/SetPasswordModal';
import { SeoHead } from './common/SeoHead';
import { FilesPage } from './files/FilesPage';
import { ArabicKeyboardPage } from './keyboard/ArabicKeyboardPage';
import { CountdownPage } from './countdown/CountdownPage';
import { QuizPage } from './quiz/QuizPage';
import { ErrorBoundary } from './common/ErrorBoundary';
import { safeLocalStorageSet } from '../lib/safeStorage';
import { TodoCalendarPage } from './todo/TodoCalendarPage';
import { SettingsPage } from './settings/SettingsPage';
import { DownloadPage } from './download/DownloadPage';
import { AdminPanel } from './admin/AdminPanel';
import { ConfirmDialog } from './common/ConfirmDialog';
import { filterNotesBySearch, normalizeSearch, noteMatchesSearch, nextSearchHitIndex } from '../lib/noteSearch';
import { MIN_GLOBAL_SEARCH_CHARS } from '../lib/globalSearch';
import { GlobalSearchResults } from './search/GlobalSearchResults';
import { useGlobalSearchResults } from '../hooks/useGlobalSearchResults';
import { AiBackNotice } from './common/AiBackNotice';
import { KeepGoingNotice } from './common/KeepGoingNotice';

const QUIZ_SELECTION_KEY = 'malacadhati_quiz_selection';

function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
      <span className="mb-3 text-5xl opacity-30">🗒️</span>
      <p className="text-sm">{text}</p>
      {hint && <p className="mt-3 max-w-sm text-xs leading-relaxed text-app-text-secondary/60 dark:text-gray-500">{hint}</p>}
    </div>
  );
}

function NoteSectionBar({
  label,
  noteViewMode,
  onNoteViewModeChange,
  showViewToggle = true,
}: {
  label: string;
  noteViewMode: NoteViewMode;
  onNoteViewModeChange: (mode: NoteViewMode) => void;
  showViewToggle?: boolean;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">{label}</div>
      {showViewToggle && <NoteViewToggle mode={noteViewMode} onChange={onNoteViewModeChange} />}
    </div>
  );
}

function NoteList({ notes, search, searchHitStarts, activeSearchHitIndex, emptySearchText, emptyText, emptyHint, onOpen, viewMode = 'grid', selectMode, selected, onToggleSelect }: {
  notes: Note[];
  search: string;
  searchHitStarts?: Record<number, number>;
  activeSearchHitIndex?: number | null;
  emptySearchText: string;
  emptyText: string;
  emptyHint?: string;
  onOpen: (id: number) => void;
  viewMode?: NoteViewMode;
  selectMode?: boolean;
  selected?: Set<number>;
  onToggleSelect?: (id: number) => void;
}) {
  const hasSearch = normalizeSearch(search).length > 0;
  const filtered = hasSearch ? notes.filter((n) => noteMatchesSearch(n, search)) : notes;
  const sorted = sortNotesByCreatedDesc(filtered);
  if (!sorted.length) return <EmptyState text={hasSearch ? emptySearchText : emptyText} hint={hasSearch ? undefined : emptyHint} />;
  const expanded = viewMode === 'expanded';
  return (
    <div className={
      expanded
        ? 'mx-auto flex max-w-3xl flex-col gap-4 px-3 pb-6 sm:px-5'
        : 'grid grid-cols-1 gap-3.5 px-3 pb-6 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 xl:grid-cols-4'
    }>
      {sorted.map((n, i) => (
        <NoteCard
          key={n.id}
          note={n}
          search={hasSearch ? search : ''}
          searchHitStart={searchHitStarts?.[n.id] ?? 0}
          activeSearchHitIndex={hasSearch ? activeSearchHitIndex ?? null : null}
          onOpen={onOpen}
          viewMode={viewMode}
          selectMode={selectMode}
          selected={selected?.has(n.id)}
          onToggleSelect={onToggleSelect}
          seq={i + 1}
        />
      ))}
    </div>
  );
}

const NOTE_VIEW_KEY = 'malacadhati_notes_view';

function readNoteViewMode(): NoteViewMode {
  try {
    const raw = localStorage.getItem(NOTE_VIEW_KEY);
    return raw === 'expanded' ? 'expanded' : 'grid';
  } catch {
    return 'grid';
  }
}

function DeletedQuizCard({ icon, name, color, detail, createdAt, deletedAt, createdLabel, deletedLabel, restoreLabel, deleteLabel, restoreTo, onRestore, onDelete, selectMode, selected, onToggleSelect }: {
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
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  return (
    <div
      className={'relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-all dark:bg-gray-800/60 ' + (selected ? 'border-primary ring-2 ring-primary/30' : 'border-app-border dark:border-white/10')}
      onClick={() => selectMode && onToggleSelect?.()}
      style={{ cursor: selectMode ? 'pointer' : 'default' }}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color || '#9ca3af' }} />
      {selectMode && (
        <input
          type="checkbox"
          checked={!!selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-3 top-3 h-4 w-4 accent-primary"
        />
      )}
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
      {!selectMode && (
        <>
          <div className="mt-3 flex justify-end gap-2 border-t border-app-border/70 pt-3 dark:border-white/10">
            <button onClick={(e) => { e.stopPropagation(); onRestore(); }} className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-medium text-app-text-secondary hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10">↩ {restoreLabel}</button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">🗑 {deleteLabel}</button>
          </div>
          {restoreTo && (
            <p className="mt-2 text-[10px] text-emerald-600/70 dark:text-emerald-400/60">{restoreTo}</p>
          )}
        </>
      )}
    </div>
  );
}

export function Dashboard() {
  const { t, lang } = useLanguage();
  const { notes, drafts, trashedQuizzes, quizzes, quizSets, quizFolders, addDraft, emptyTrash, deleteMany, restoreQuiz, permDeleteQuiz, restoreQuizSet, permDeleteQuizSet, restoreQuizFolder, permDeleteQuizFolder } = useNotes();
  const { show } = useToast();
  const [page, setPageState] = useState<Page>(() => pageFromPath(window.location.pathname));
  const setPage = useCallback((next: Page) => {
    const resolved = next === 'admin' && !SHOW_ADMIN_PANEL ? 'home' : next;
    setPageState(resolved);
    const nextPath = pathFromPage(resolved);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({ page: resolved }, '', `${nextPath}${window.location.search}`);
    }
  }, []);

  // /admin disabled: rewrite URL to home if someone bookmarks or types the path.
  useEffect(() => {
    if (SHOW_ADMIN_PANEL) return;
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/admin') {
      window.history.replaceState({ page: 'home' }, '', `/${window.location.search}`);
      setPageState('home');
    }
  }, []);

  const navigateToPage = useCallback((next: Page) => {
    setSearch('');
    setActiveSearchHit(0);
    setOpenNoteId(null);
    setQuizFocusItemId(null);
    setPage(next);
  }, [setPage]);
  const [search, setSearch] = useState('');
  const handleSearchChange = useCallback((value: string) => {
    startTransition(() => setSearch(value));
  }, []);
  const [activeSearchHit, setActiveSearchHit] = useState(0);
  const [openNoteId, setOpenNoteId] = useState<number | null>(null);
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedSets, setSelectedSets] = useState<Set<string>>(new Set());
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
  const [selectedQuestions, setSelectedQuestions] = useState<Set<number>>(new Set());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmDelSel, setConfirmDelSel] = useState(false);
  const [confirmQuizTrash, setConfirmQuizTrash] = useState<{ type: 'set' | 'folder' | 'question'; id: string | number } | null>(null);
  const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>(() => readNoteViewMode());
  const [quizFocusItemId, setQuizFocusItemId] = useState<number | null>(null);
  const favQuizIds = useMemo(() => {
    const raw = quizSets.find((s) => s.id === FAVORITES_SET_ID)?.items;
    const favItems = Array.isArray(raw)
      ? raw
      : raw && typeof raw === 'object'
        ? Object.values(raw as Record<string, { favOf?: number; trashed?: boolean }>)
        : [];
    return new Set(
      favItems
        .filter((i) => i && !i.trashed)
        .map((i) => i.favOf)
        .filter((x): x is number => x != null),
    );
  }, [quizSets]);
  const searchQueryLen = normalizeSearch(search).length;
  const hasSearch = searchQueryLen > 0;
  const searchReady = searchQueryLen >= MIN_GLOBAL_SEARCH_CHARS;
  // Global search overlays any tab (files, settings, todo, …) so the header
  // search always works regardless of the open page.
  const showGlobalSearch = searchReady;
  const showSearchHint = hasSearch && !searchReady;
  const { results: globalSearchResults, hitMeta: searchHitMeta } = useGlobalSearchResults(
    showGlobalSearch,
    search,
    notes,
    quizzes,
    quizSets,
    quizFolders,
    t,
    favQuizIds,
  );

  const handleNoteViewMode = useCallback((mode: NoteViewMode) => {
    setNoteViewMode(mode);
    try {
      localStorage.setItem(NOTE_VIEW_KEY, mode);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setPageState(pageFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const active = useMemo(() => notes.filter((n) => !n.archived && !n.trashed), [notes]);
  const unread = useMemo(() => active.filter((n) => !n.read), [active]);
  const fav = useMemo(() => active.filter((n) => n.fav), [active]);
  const favArch = useMemo(() => notes.filter((n) => n.fav && n.archived && !n.trashed), [notes]);
  const allFav = useMemo(() => [...fav, ...favArch], [fav, favArch]);
  const read = useMemo(() => notes.filter((n) => n.read && !n.archived && !n.trashed), [notes]);
  const archived = useMemo(() => notes.filter((n) => n.archived && !n.trashed), [notes]);
  const trashed = useMemo(() => notes.filter((n) => n.trashed), [notes]);

  useEffect(() => {
    setActiveSearchHit(0);
  }, [search, page]);

  useEffect(() => {
    if (!hasSearch || searchHitMeta.total === 0) return;
    const safeIndex = Math.min(activeSearchHit, searchHitMeta.total - 1);
    if (safeIndex !== activeSearchHit) {
      setActiveSearchHit(safeIndex);
      return;
    }
    requestAnimationFrame(() => {
      document.querySelector(`[data-search-hit="${safeIndex}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [activeSearchHit, hasSearch, searchHitMeta.total, noteViewMode]);

  const moveSearchHit = useCallback((direction: 1 | -1) => {
    if (!searchHitMeta.total) return;
    setActiveSearchHit((current) => nextSearchHitIndex(current, searchHitMeta.total, direction));
  }, [searchHitMeta.total]);

  const handleOpenNoteFromSearch = useCallback((noteId: number, targetPage: Page) => {
    setPage(targetPage);
    setOpenNoteId(noteId);
  }, [setPage]);

  const handleOpenQuizFromSearch = useCallback((itemId: number, setId?: string | null, folderId?: string | null) => {
    safeLocalStorageSet(
      QUIZ_SELECTION_KEY,
      JSON.stringify({ folderId: setId ? (folderId ?? null) : null, setId: setId ?? null }),
    );
    // Leave global search so QuizPage mounts and can scroll to the question.
    setSearch('');
    setActiveSearchHit(0);
    setQuizFocusItemId(itemId);
    setPage('quiz');
  }, [setPage]);

  const handleQuizFocusHandled = useCallback(() => setQuizFocusItemId(null), []);

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
    if (showGlobalSearch) {
      return globalSearchResults.filter((r) => r.type === 'note' && r.note).map((r) => r.note!);
    }
    const source = page === 'unread' ? unread
      : page === 'read' ? read
        : page === 'archive' ? archived
          : page === 'fav' ? allFav
            : active;
    return sortNotesByCreatedDesc(hasSearch ? filterNotesBySearch(source, search) : source);
  }, [active, allFav, archived, globalSearchResults, hasSearch, page, read, search, showGlobalSearch, unread]);
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
    if (page !== 'home' || hasSearch) navigateToPage('home');
    addDraft();
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-white dark:bg-gray-950">
      <SeoHead page={page} />
      {mobileMenuOpen && <button aria-label="Close menu" onClick={() => setMobileMenuOpen(false)} className="fixed inset-0 z-30 bg-gray-950/35 backdrop-blur-sm md:hidden" />}
      <Sidebar page={page} setPage={navigateToPage} onOpenSetPassword={() => setShowSetPassword(true)} mobileOpen={mobileMenuOpen} onMobileClose={() => setMobileMenuOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          page={page}
          search={search}
          onSearchChange={handleSearchChange}
          searchHitTotal={searchHitMeta.total}
          searchHitCurrent={searchHitMeta.total > 0 ? activeSearchHit + 1 : 0}
          onSearchHitPrev={() => moveSearchHit(-1)}
          onSearchHitNext={() => moveSearchHit(1)}
          onNewNote={handleNewNote}
          onOpenMenu={() => setMobileMenuOpen(true)}
        />
        <KeepGoingNotice />
        <AiBackNotice />

        <div className="flex-1 overflow-y-auto">
          {showSearchHint && (
            <div className="px-3 py-8 text-center text-sm text-app-text-secondary dark:text-gray-400 sm:px-5">
              {t.searchMinCharsHint}
            </div>
          )}

          {showGlobalSearch && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <div className="mb-3 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
                🔎 {t.searchResultsTitle} · {globalSearchResults.length}
              </div>
              <GlobalSearchResults
                results={globalSearchResults}
                search={search}
                searchHitStarts={searchHitMeta.starts}
                activeSearchHitIndex={activeSearchHit}
                emptyText={t.emptySearch}
                noteViewMode="grid"
                onOpenNote={handleOpenNoteFromSearch}
                onOpenQuiz={handleOpenQuizFromSearch}
              />
            </div>
          )}

          {!showGlobalSearch && page === 'home' && (
            <div className="flex min-h-full flex-col gap-3.5 bg-app-bg p-3 dark:bg-white/5 sm:p-5">
              {active.length > 0 && (
                <div className="rounded-xl border border-blue-200/80 bg-blue-50/80 px-4 py-3 text-[13px] leading-relaxed text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                  📚 {t.homeSavedNotesHint}
                </div>
              )}
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

          {!showGlobalSearch && page === 'library' && (
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
              <NoteSectionBar label={`📚 ${t.secAll}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
              <NoteList notes={active} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} viewMode={noteViewMode} />
            </div>
          )}

          {!showGlobalSearch && page === 'files' && <FilesPage search={search} />}
          {!showGlobalSearch && page === 'arabicKb' && <ArabicKeyboardPage />}
          {!showGlobalSearch && page === 'countdown' && <CountdownPage />}
          {!showGlobalSearch && page === 'todo' && <TodoCalendarPage search={search} />}
          {!showGlobalSearch && page === 'quiz' && (
            <ErrorBoundary label="quiz">
              <QuizPage
                focusItemId={quizFocusItemId}
                onFocusHandled={handleQuizFocusHandled}
              />
            </ErrorBoundary>
          )}
          {!showGlobalSearch && page === 'download' && <DownloadPage />}
          {!showGlobalSearch && page === 'settings' && <SettingsPage />}
          {!showGlobalSearch && page === 'admin' && SHOW_ADMIN_PANEL && <AdminPanel />}

          {!showGlobalSearch && page === 'unread' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <NoteSectionBar label={`📖 ${t.secUnread}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
              <NoteList notes={unread} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} viewMode={noteViewMode} />
            </div>
          )}

          {!showGlobalSearch && page === 'read' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <NoteSectionBar label={`✓ ${t.secRead}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
              <NoteList notes={read} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} emptyHint={t.emptyReadHint} onOpen={setOpenNoteId} viewMode={noteViewMode} />
            </div>
          )}

          {!showGlobalSearch && page === 'archive' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <NoteSectionBar label={`🗄 ${t.secArch}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
              <NoteList notes={archived} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} viewMode={noteViewMode} />
            </div>
          )}

          {!showGlobalSearch && page === 'fav' && (
            <div className="px-3 py-4 sm:px-5 sm:py-5">
              <NoteSectionBar label={`★ ${t.secFav}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
              <NoteList notes={fav} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} viewMode={noteViewMode} />
              {favArch.length > 0 && (
                <>
                  <NoteSectionBar label={`🗄 ${t.secFavArch}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} showViewToggle={false} />
                  <NoteList notes={favArch} search="" emptySearchText={t.emptySearch} emptyText={t.emptyNotes} onOpen={setOpenNoteId} viewMode={noteViewMode} />
                </>
              )}
            </div>
          )}

          {!showGlobalSearch && page === 'trash' && (
            <>
              <div className="flex flex-col items-stretch justify-between gap-2 border-b border-app-border bg-white px-3 py-3 dark:border-white/10 dark:bg-gray-900 sm:flex-row sm:items-center sm:px-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-app-text dark:text-gray-100">🗑 {t.pageTrash}</span>
                  <span className="rounded-full bg-app-bg px-2 py-0.5 text-[11px] font-semibold text-app-text-secondary dark:bg-white/10">{trashTotal}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {trashTotal > 0 && (
                    <button
                      onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); setSelectedSets(new Set()); setSelectedFolders(new Set()); setSelectedQuestions(new Set()); }}
                      className="rounded-lg border border-app-border px-3.5 py-1.5 text-[13px] font-medium text-app-text hover:bg-app-bg dark:border-white/10 dark:text-gray-200"
                    >
                      {selectMode ? t.cancelSel : t.selDel}
                    </button>
                  )}
                  {selectMode && (selected.size + selectedSets.size + selectedFolders.size + selectedQuestions.size) > 0 && (
                    <button
                      onClick={() => setConfirmDelSel(true)}
                      className="rounded-lg bg-red-600 px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-red-700"
                    >
                      🗑 {t.delSelected} ({selected.size + selectedSets.size + selectedFolders.size + selectedQuestions.size})
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
                    <NoteSectionBar label={`📝 ${trashCopy.notes} · ${visibleTrashedNotes.length}`} noteViewMode={noteViewMode} onNoteViewModeChange={handleNoteViewMode} />
                    <NoteList notes={visibleTrashedNotes} search="" emptySearchText={t.emptySearch} emptyText={t.emptyTrash} onOpen={() => {}} viewMode={noteViewMode} selectMode={selectMode} selected={selected} onToggleSelect={toggleSelect} />
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
                          restoreTo={lang === 'sv' ? 'Återställs till Quiz → Restored Sets' : 'Restores to Quiz → Restored Sets'}
                          onRestore={() => { restoreQuizSet(set.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Restored Sets' : '↩ Restored to Quiz → Restored Sets'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'set', id: set.id })}
                          selectMode={selectMode}
                          selected={selectedSets.has(set.id)}
                          onToggleSelect={() => setSelectedSets((prev) => { const n = new Set(prev); n.has(set.id) ? n.delete(set.id) : n.add(set.id); return n; })}
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
                          restoreTo={lang === 'sv' ? 'Återställs till Quiz → Mappar' : 'Restores to Quiz → Folders'}
                          onRestore={() => { restoreQuizFolder(folder.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Mappar' : '↩ Restored to Quiz → Folders'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'folder', id: folder.id })}
                          selectMode={selectMode}
                          selected={selectedFolders.has(folder.id)}
                          onToggleSelect={() => setSelectedFolders((prev) => { const n = new Set(prev); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}
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
                          restoreTo={lang === 'sv' ? 'Återställs till Quiz → Restored' : 'Restores to Quiz → Restored'}
                          onRestore={() => { restoreQuiz(q.id); show(lang === 'sv' ? '↩ Återställd till Quiz → Restored' : '↩ Restored to Quiz → Restored'); }}
                          onDelete={() => setConfirmQuizTrash({ type: 'question', id: q.id })}
                          selectMode={selectMode}
                          selected={selectedQuestions.has(q.id)}
                          onToggleSelect={() => setSelectedQuestions((prev) => { const n = new Set(prev); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; })}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {visibleTrashedNotes.length === 0 && trashedQuizQuestions.length === 0 && visibleTrashedSets.length === 0 && visibleTrashedFolders.length === 0 && (
                  <EmptyState text={trashCopy.empty} />
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
          onNavigate={navigateToPage}
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
          count={selected.size + selectedSets.size + selectedFolders.size + selectedQuestions.size}
          confirmLabel={t.delSelected}
          cancelLabel="Cancel"
          onConfirm={() => {
            setConfirmDelSel(false);
            if (selected.size > 0) deleteMany([...selected]);
            selectedSets.forEach((id) => permDeleteQuizSet(id));
            selectedFolders.forEach((id) => permDeleteQuizFolder(id));
            selectedQuestions.forEach((id) => permDeleteQuiz(id));
            setSelected(new Set()); setSelectedSets(new Set()); setSelectedFolders(new Set()); setSelectedQuestions(new Set());
            setSelectMode(false);
            show(t.tDelSel);
          }}
          onCancel={() => setConfirmDelSel(false)}
        />
      )}
    </div>
  );
}
