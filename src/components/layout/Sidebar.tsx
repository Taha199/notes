import { useState } from 'react';
import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Logo } from '../common/Logo';

export function Sidebar({ page, setPage, onOpenSetPassword }: { page: Page; setPage: (p: Page) => void; onOpenSetPassword: () => void }) {
  const { t } = useLanguage();
  const { notes } = useNotes();
  const { user, hasPassword, signOut } = useAuth();
  const { dark, toggleDark } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  const counts = {
    home: notes.filter((n) => !n.archived && !n.trashed).length,
    unread: notes.filter((n) => !n.read && !n.archived && !n.trashed).length,
    read: notes.filter((n) => n.read && !n.archived && !n.trashed).length,
    fav: notes.filter((n) => n.fav && !n.trashed).length,
    archive: notes.filter((n) => n.archived && !n.trashed).length,
    trash: notes.filter((n) => n.trashed).length,
  };

  const items: { page: Page; icon: string; label: string; badge?: number; badgeClass?: string }[] = [
    { page: 'home', icon: '🏠', label: t.navHome },
    { page: 'fav', icon: '★', label: t.navFav, badge: counts.fav, badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300' },
    { page: 'unread', icon: '📖', label: t.navUnread, badge: counts.unread, badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
    { page: 'read', icon: '✓', label: t.navRead, badge: counts.read, badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' },
    { page: 'library', icon: '📚', label: t.navLibrary, badge: counts.home, badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' },
  ];
  const items2: { page: Page; icon: string; label: string; badge?: number; badgeClass?: string }[] = [
    { page: 'archive', icon: '🗄', label: t.navArchive, badge: counts.archive, badgeClass: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400' },
    { page: 'trash', icon: '🗑', label: t.navTrash, badge: counts.trash, badgeClass: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' },
  ];

  const NavBtn = ({ it }: { it: (typeof items)[number] }) => (
    <button
      onClick={() => setPage(it.page)}
      className={
        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all ' +
        (page === it.page ? 'bg-primary/10 text-primary' : 'text-app-text-secondary hover:bg-white hover:text-app-text dark:hover:bg-white/5 dark:hover:text-gray-100')
      }
    >
      <span className="text-base opacity-90">{it.icon}</span>
      {!collapsed && <span className="overflow-hidden whitespace-nowrap">{it.label}</span>}
      {!collapsed && !!it.badge && (
        <span className={'mr-0 ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold ' + it.badgeClass}>{it.badge}</span>
      )}
    </button>
  );

  const name = user?.displayName || user?.email?.split('@')[0] || t.userName;

  return (
    <aside className={'flex flex-col border-l border-app-border bg-app-bg/60 backdrop-blur-md transition-all duration-300 dark:border-white/10 dark:bg-white/5 ' + (collapsed ? 'w-[64px] min-w-[64px]' : 'w-[256px] min-w-[256px]')}>
      <div className="flex min-h-[62px] items-center justify-between border-b border-app-border px-3.5 dark:border-white/10">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <Logo size={30} />
            <span className="text-[15px] font-bold tracking-tight text-app-text dark:text-gray-100">{t.appName}</span>
          </div>
        )}
        <button onClick={() => setCollapsed((c) => !c)} className="flex flex-shrink-0 rounded-lg p-1.5 text-app-text-secondary hover:bg-white dark:hover:bg-white/10">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></svg>
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {items.map((it) => (
          <NavBtn key={it.page} it={it} />
        ))}
        <div className="my-1.5 border-t border-app-border dark:border-white/10" />
        {items2.map((it) => (
          <NavBtn key={it.page} it={it} />
        ))}
      </nav>

      <div className="border-t border-app-border p-2 dark:border-white/10">
        <button
          onClick={toggleDark}
          className="mb-1.5 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium text-app-text-secondary transition-all hover:bg-white dark:hover:bg-white/10"
        >
          <span>{dark ? '☀️' : '🌙'}</span>
          {!collapsed && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        {!collapsed && (
          <div className="mb-1.5 flex items-center gap-2.5 rounded-xl border border-app-border bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#8A82FF] text-xs font-bold text-white shadow-md shadow-primary/30">
              {name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 overflow-hidden">
              <div className="truncate text-[13px] font-semibold text-app-text dark:text-gray-100">{name}</div>
              <div className="truncate text-[11px] text-app-text-secondary/80 dark:text-gray-500">{user?.email}</div>
            </div>
          </div>
        )}
        {!collapsed && !hasPassword && (
          <button onClick={onOpenSetPassword} className="mb-1.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-primary transition-all hover:bg-primary/10">
            🔑 <span>{t.setPassLbl}</span>
          </button>
        )}
        <button onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-red-600 transition-all hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
          ⏻ {!collapsed && <span>{t.signOut}</span>}
        </button>
      </div>
    </aside>
  );
}
