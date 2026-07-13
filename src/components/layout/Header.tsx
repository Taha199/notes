import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { CloudSavedAtLabel } from '../common/CloudSavedAtLabel';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { normalizeSearch } from '../../lib/noteSearch';

const ICONS: Record<Page, string> = {
  home: '🏠', fav: '★', unread: '📖', read: '✓', library: '📚', files: '📎', archive: '🗄', trash: '🗑', quiz: '🧠', download: '💻', settings: '⚙️', admin: '👑',
};

const navBtn = 'flex h-7 w-7 items-center justify-center rounded-lg border border-app-border text-app-text-secondary transition-colors hover:bg-app-bg hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100';

export function Header({
  page,
  search,
  setSearch,
  searchHitTotal = 0,
  searchHitCurrent = 0,
  onSearchHitPrev,
  onSearchHitNext,
  onNewNote,
  onOpenMenu,
}: {
  page: Page;
  search: string;
  setSearch: (s: string) => void;
  searchHitTotal?: number;
  searchHitCurrent?: number;
  onSearchHitPrev?: () => void;
  onSearchHitNext?: () => void;
  onNewNote: () => void;
  onOpenMenu: () => void;
}) {
  const { t } = useLanguage();
  const hasSearch = normalizeSearch(search).length > 0;
  const titles: Record<Page, string> = {
    home: t.pageHome, fav: t.pageFav, unread: t.pageUnread, read: t.pageRead, library: t.pageLib, files: t.pageFiles, archive: t.pageArch, trash: t.pageTrash, quiz: 'Quiz', download: t.pageDownload, settings: t.settingsTitle, admin: t.adminTitle,
  };
  const hitLabel = searchHitTotal > 0
    ? t.searchHitsLabel.replace('{current}', String(searchHitCurrent)).replace('{total}', String(searchHitTotal))
    : t.searchNoHits;

  return (
    <div className="flex min-h-[62px] flex-shrink-0 flex-col gap-3 border-b border-app-border bg-white px-3 py-3 dark:border-white/10 dark:bg-gray-900 sm:px-5 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          onClick={onOpenMenu}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-app-border bg-app-bg text-app-text-secondary shadow-sm md:hidden dark:border-white/10 dark:bg-white/5"
          title="Show menu"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
            <path d="M4 7h16" />
            <path d="M4 12h16" />
            <path d="M4 17h16" />
          </svg>
        </button>
        <span className="text-lg text-primary">{ICONS[page]}</span>
        <h2 className="truncate text-[15px] font-bold tracking-tight text-app-text dark:text-gray-100">{titles[page]}</h2>
        <CloudSavedAtLabel className="hidden sm:inline-flex" showWhenEmpty />
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 md:flex-none">
          <div className="relative min-w-0 flex-1 md:w-[180px] md:focus-within:w-[220px]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.searchPh}
              className={'w-full rounded-xl border border-app-border bg-app-bg py-2 pl-3 text-[13.5px] text-app-text outline-none transition-all placeholder:text-app-text-secondary/60 focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/15 dark:bg-gray-800/90 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-primary/50 dark:focus:bg-gray-800 dark:focus:ring-primary/20 ' + (search ? 'pr-16' : 'pr-9')}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t.clearSearch}
                title={t.clearSearch}
                className="absolute right-9 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-app-text-secondary transition-colors hover:bg-app-border/40 hover:text-app-text dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            )}
            <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-app-text-secondary dark:text-gray-400" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          </div>
          {hasSearch && (
            <div className="flex flex-shrink-0 items-center gap-1 rounded-xl border border-app-border bg-app-bg px-1.5 py-1 dark:border-white/10 dark:bg-gray-800/80">
              <span className="min-w-[3.25rem] px-1 text-center text-[11px] font-semibold tabular-nums text-app-text-secondary dark:text-gray-300">{hitLabel}</span>
              <button type="button" className={navBtn} onClick={onSearchHitPrev} disabled={searchHitTotal === 0} aria-label={t.searchHitPrevious} title={t.searchHitPrevious}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 19V5" /><path d="m7 10 5-5 5 5" /></svg>
              </button>
              <button type="button" className={navBtn} onClick={onSearchHitNext} disabled={searchHitTotal === 0} aria-label={t.searchHitNext} title={t.searchHitNext}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14" /><path d="m7 14 5 5 5-5" /></svg>
              </button>
            </div>
          )}
        </div>
        <LanguageSwitcher />
        <button onClick={onNewNote} className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3 py-2 text-[13px] font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark sm:px-4">
          + <span className="hidden sm:inline">{t.newNote}</span>
        </button>
      </div>
    </div>
  );
}
