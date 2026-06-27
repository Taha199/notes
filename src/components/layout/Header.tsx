import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { CloudSaveIndicator } from '../common/CloudSaveIndicator';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

const ICONS: Record<Page, string> = {
  home: '🏠', fav: '★', unread: '📖', read: '✓', library: '📚', files: '📎', archive: '🗄', trash: '🗑', quiz: '🧠', chat: '💬', settings: '⚙️', admin: '👑',
};

export function Header({
  page,
  search,
  setSearch,
  onNewNote,
  onOpenMenu,
}: {
  page: Page;
  search: string;
  setSearch: (s: string) => void;
  onNewNote: () => void;
  onOpenMenu: () => void;
}) {
  const { t } = useLanguage();
  const titles: Record<Page, string> = {
    home: t.pageHome, fav: t.pageFav, unread: t.pageUnread, read: t.pageRead, library: t.pageLib, files: t.pageFiles, archive: t.pageArch, trash: t.pageTrash, quiz: 'Quiz', chat: 'AI Chat', settings: t.settingsTitle, admin: t.adminTitle,
  };

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
        <CloudSaveIndicator className="hidden sm:inline-flex" />
      </div>
      <div className="flex w-full min-w-0 items-center gap-2 md:w-auto">
        <div className="relative min-w-0 flex-1 md:flex-none">
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-app-text-secondary" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPh}
            className="w-full rounded-xl border border-app-border bg-app-bg py-2 pl-3 pr-9 text-[13.5px] outline-none transition-all focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 md:w-[180px] md:focus:w-[220px]"
          />
        </div>
        <LanguageSwitcher />
        <button onClick={onNewNote} className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-3 py-2 text-[13px] font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark sm:px-4">
          + <span className="hidden sm:inline">{t.newNote}</span>
        </button>
      </div>
    </div>
  );
}
