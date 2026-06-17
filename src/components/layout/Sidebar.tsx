import { useState } from 'react';
import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Logo } from '../common/Logo';

export function Sidebar({
  page,
  setPage,
  onOpenSetPassword,
  mobileOpen = false,
  onMobileClose,
}: {
  page: Page;
  setPage: (p: Page) => void;
  onOpenSetPassword: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
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
    { page: 'files', icon: '📎', label: t.navFiles },
    { page: 'quiz', icon: '🧠', label: 'Quiz' },
  ];
  const items2: { page: Page; icon: string; label: string; badge?: number; badgeClass?: string }[] = [
    { page: 'archive', icon: '🗄', label: t.navArchive, badge: counts.archive, badgeClass: 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-400' },
    { page: 'trash', icon: '🗑', label: t.navTrash, badge: counts.trash, badgeClass: 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' },
  ];

  const NavBtn = ({ it }: { it: (typeof items)[number] }) => (
    <button
      onClick={() => {
        setPage(it.page);
        onMobileClose?.();
      }}
      className={
        'group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-all ' +
        (page === it.page ? 'bg-primary/10 text-primary' : 'text-app-text-secondary hover:bg-white hover:text-app-text dark:hover:bg-white/5 dark:hover:text-gray-100')
      }
    >
      <span className="text-base opacity-90">{it.icon}</span>
      {(!collapsed || mobileOpen) && <span className="overflow-hidden whitespace-nowrap">{it.label}</span>}
      {(!collapsed || mobileOpen) && !!it.badge && (
        <span className={'mr-0 ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold ' + it.badgeClass}>{it.badge}</span>
      )}
    </button>
  );

  const name = user?.displayName || user?.email?.split('@')[0] || t.userName;

  return (
    <aside className={
      'fixed inset-y-0 left-0 z-40 flex w-[286px] min-w-[286px] flex-col border-r border-app-border bg-app-bg/95 shadow-2xl backdrop-blur-xl transition-transform duration-300 dark:border-white/10 dark:bg-gray-950/95 md:static md:z-auto md:border-l md:border-r-0 md:shadow-none ' +
      (mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 ') +
      (collapsed ? 'md:w-[64px] md:min-w-[64px]' : 'md:w-[256px] md:min-w-[256px]')
    }>
      <div className="flex min-h-[68px] items-center justify-between border-b border-app-border px-3.5 dark:border-white/10">
        {(!collapsed || mobileOpen) && (
          <div className="flex items-center gap-2.5">
            <Logo size={38} />
            <span className="brand-wordmark brand-wordmark-sidebar">{t.appName}</span>
          </div>
        )}
        <button
          onClick={() => {
            if (mobileOpen) onMobileClose?.();
            else setCollapsed((c) => !c);
          }}
          title={collapsed ? 'Show menu' : 'Hide menu'}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-app-border bg-white text-app-text-secondary shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
        >
          {mobileOpen ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-300" style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <path d="M15 6l-6 6 6 6" />
              <path d="M20 4v16" />
            </svg>
          )}
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
          {(!collapsed || mobileOpen) && <span>{dark ? 'Light mode' : 'Dark mode'}</span>}
        </button>
        {(!collapsed || mobileOpen) && (
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
        {(!collapsed || mobileOpen) && !hasPassword && (
          <button onClick={onOpenSetPassword} className="mb-1.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-primary transition-all hover:bg-primary/10">
            🔑 <span>{t.setPassLbl}</span>
          </button>
        )}
        <button onClick={signOut} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium text-red-600 transition-all hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10">
          ⏻ {(!collapsed || mobileOpen) && <span>{t.signOut}</span>}
        </button>
      </div>
    </aside>
  );
}
