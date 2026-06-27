import { useEffect, useState } from 'react';
import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { useNotes } from '../../contexts/NotesContext';
import { Logo } from '../common/Logo';

interface SidebarProps {
  page: Page;
  setPage: (p: Page) => void;
  unread: number;
  read: number;
  fav: number;
  arch: number;
  trash: number;
  files: number;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  onOpenSetPassword?: () => void;
}

const navIcon: Record<Page, string> = {
  home: '🏠', fav: '★', unread: '📖', read: '✓', library: '📚', files: '📎', archive: '🗄', trash: '🗑', settings: '⚙️', admin: '👑', chat: '💬', quiz: '🧠'
};

export function Sidebar({
  page, setPage, unread, read, fav, arch, trash, files, mobileOpen, setMobileOpen, collapsed, setCollapsed, onOpenSetPassword,
}: SidebarProps) {
  const { t } = useLanguage();
  const { user, signOut, hasPassword } = useAuth();
  const { notes } = useNotes();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const widthClass = isMobile ? 'w-[86vw] max-w-[300px]' : collapsed ? 'w-[72px]' : 'w-[250px]';
  const name = user?.displayName || user?.email?.split('@')[0] || t.userName;
  const totalNotes = notes.filter((n) => !n.trashed).length;
  const isAdmin = user?.email === 'abdomar200@gmail.com';
  const items = [
    { key: 'home' as Page, label: t.navHome, count: null },
    { key: 'fav' as Page, label: t.navFav, count: fav },
    { key: 'quiz' as Page, label: 'Quiz', count: null },
    { key: 'unread' as Page, label: t.navUnread, count: unread },
    { key: 'read' as Page, label: t.navRead, count: read },
    { key: 'library' as Page, label: t.navLibrary, count: totalNotes },
    { key: 'files' as Page, label: t.navFiles, count: files || null },
    { key: 'chat' as Page, label: 'AI Chat', count: null },
    { key: 'archive' as Page, label: t.navArchive, count: arch },
    { key: 'trash' as Page, label: t.navTrash, count: trash },
    { key: 'settings' as Page, label: t.settingsTitle, count: null },
    ...(isAdmin ? [{ key: 'admin' as Page, label: t.adminTitle, count: null }] : []),
  ];

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex ${widthClass} flex-col border-r border-app-border bg-white/90 backdrop-blur-xl transition-all duration-300 dark:border-white/10 dark:bg-gray-950/90 md:sticky md:top-0 md:h-screen ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
    >
      <div className="flex h-16 items-center gap-3 border-b border-app-border px-4 dark:border-white/10">
        <Logo size={collapsed && !mobileOpen ? 34 : 42} />
        {(!collapsed || mobileOpen) && <h1 className="whitespace-nowrap text-xl font-extrabold text-app-text dark:text-gray-100">{t.appName}</h1>}
        <button
          onClick={() => (isMobile ? setMobileOpen(false) : setCollapsed(!collapsed))}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-full border border-app-border bg-white text-xl font-black text-app-text-secondary shadow-md shadow-black/10 transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:text-primary hover:shadow-primary/20 dark:border-white/10 dark:bg-white/8 dark:text-gray-300"
          title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
        >
          {isMobile ? '×' : collapsed ? '›' : '‹'}
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {items.map((it, idx) => {
          const sep = idx === 8;
          return (
            <div key={it.key}>
              {sep && <div className="my-3 h-px bg-app-border dark:bg-white/10" />}
              <button
                onClick={() => { setPage(it.key); setMobileOpen(false); }}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-all ${page === it.key ? 'bg-primary/12 text-primary shadow-sm dark:bg-primary/20' : 'text-app-text-secondary hover:bg-app-bg hover:text-app-text dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200'}`}
              >
                <span className="w-6 text-xl">{navIcon[it.key]}</span>
                {(!collapsed || mobileOpen) && <span className="flex-1 truncate">{it.label}</span>}
                {(!collapsed || mobileOpen) && it.count !== null && it.count > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${it.key === 'trash' ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300' : it.key === 'read' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300' : it.key === 'fav' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300'}`}>{it.count}</span>
                )}
              </button>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-app-border p-2 dark:border-white/10">
        <button className="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/5">
          🌙 {(!collapsed || mobileOpen) && 'Dark mode'}
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
        {(!collapsed || mobileOpen) && (
          <p className="mt-1 select-none bg-gradient-to-r from-primary/70 via-[#A78BFA]/80 to-primary/70 bg-clip-text text-center text-[9.5px] font-semibold tracking-[0.14em] text-transparent dark:from-[#C4B5FD]/50 dark:via-[#8B5CF6]/70 dark:to-[#DDD6FE]/50">
            {t.designedBy}
          </p>
        )}
      </div>
    </aside>
  );
}
