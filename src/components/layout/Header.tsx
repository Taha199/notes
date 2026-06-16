import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { LanguageSwitcher } from '../common/LanguageSwitcher';

const ICONS: Record<Page, string> = {
  home: '🏠', fav: '★', unread: '📖', read: '✓', library: '📚', archive: '🗄', trash: '🗑',
};

export function Header({ page, search, setSearch, onNewNote }: { page: Page; search: string; setSearch: (s: string) => void; onNewNote: () => void }) {
  const { t } = useLanguage();
  const titles: Record<Page, string> = {
    home: t.pageHome, fav: t.pageFav, unread: t.pageUnread, read: t.pageRead, library: t.pageLib, archive: t.pageArch, trash: t.pageTrash,
  };

  return (
    <div className="flex min-h-[62px] flex-shrink-0 items-center justify-between gap-3 border-b border-app-border bg-white px-5 py-3 dark:border-white/10 dark:bg-gray-900">
      <div className="flex items-center gap-2.5">
        <span className="text-lg text-primary">{ICONS[page]}</span>
        <h2 className="text-[15px] font-bold tracking-tight text-app-text dark:text-gray-100">{titles[page]}</h2>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-app-text-secondary" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPh}
            className="w-[180px] rounded-xl border border-app-border bg-app-bg py-2 pl-3 pr-9 text-[13.5px] outline-none transition-all focus:w-[220px] focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
          />
        </div>
        <LanguageSwitcher />
        <button onClick={onNewNote} className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-md shadow-primary/30 transition-all hover:-translate-y-0.5 hover:bg-primary-dark">
          + <span className="hidden sm:inline">{t.newNote}</span>
        </button>
      </div>
    </div>
  );
}
