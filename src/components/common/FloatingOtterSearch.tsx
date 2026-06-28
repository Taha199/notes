import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';

const PANEL_WIDTH = 'min(100vw, 540px)';
const GOOGLE_HOME = 'https://www.google.com/webhp?igu=1';
const googleSearchUrl = (q: string) =>
  q.trim()
    ? `https://www.google.com/search?igu=1&q=${encodeURIComponent(q.trim())}`
    : GOOGLE_HOME;

export function FloatingOtterSearch() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [iframeSrc, setIframeSrc] = useState(GOOGLE_HOME);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  const runSearch = (term?: string) => {
    const q = (term ?? query).trim();
    setIframeSrc(googleSearchUrl(q));
    if (q) setQuery(q);
  };

  const openExternal = () => {
    window.open(iframeSrc, '_blank', 'noopener,noreferrer');
  };

  return createPortal(
    <>
      {open && (
        <>
          <button
            type="button"
            aria-label={t.otterSearchClose}
            className="fixed inset-0 z-[100000] bg-black/25 backdrop-blur-[1px] transition-opacity dark:bg-black/45"
            onClick={() => setOpen(false)}
          />

          <aside
            role="dialog"
            aria-modal="true"
            aria-label={t.otterSearchTitle}
            className="fixed inset-y-0 right-0 z-[100001] flex flex-col border-l border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-950"
            style={{ width: PANEL_WIDTH, animation: 'slideInRight 0.22s cubic-bezier(.2,.8,.2,1)' }}
          >
            <div className="shrink-0 border-b border-app-border bg-white px-4 py-3 dark:border-white/10 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold tracking-tight">
                    <span className="text-[#4285F4]">G</span>
                    <span className="text-[#EA4335]">o</span>
                    <span className="text-[#FBBC05]">o</span>
                    <span className="text-[#4285F4]">g</span>
                    <span className="text-[#34A853]">l</span>
                    <span className="text-[#EA4335]">e</span>
                  </span>
                  <span className="text-xs text-app-text-secondary dark:text-gray-400">{t.otterSearchTitle}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={openExternal}
                    title={t.otterSearchExternal}
                    className="rounded-lg px-2 py-1 text-xs font-medium text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/10"
                  >
                    ↗
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={t.otterSearchClose}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-bg dark:text-gray-400 dark:hover:bg-white/10"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  runSearch();
                }}
              >
                <input
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.otterSearchPlaceholder}
                  className="min-w-0 flex-1 rounded-full border border-app-border bg-app-bg px-4 py-2.5 text-sm text-app-text outline-none focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition hover:bg-primary-dark"
                >
                  {t.otterSearchGo}
                </button>
              </form>
            </div>

            <div className="relative min-h-0 flex-1 bg-white dark:bg-gray-950">
              <iframe
                key={iframeSrc}
                title={t.otterSearchTitle}
                src={iframeSrc}
                className="h-full w-full border-0 bg-white"
                referrerPolicy="no-referrer-when-downgrade"
                allow="fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
              />
            </div>
          </aside>
        </>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.otterSearchToggle}
        aria-expanded={open}
        className={
          'fixed bottom-5 right-5 z-[100002] flex h-14 w-14 items-center justify-center rounded-full border border-white/60 bg-white text-3xl shadow-xl shadow-primary/25 transition-all hover:scale-105 hover:shadow-2xl active:scale-95 dark:border-white/10 dark:bg-gray-900 sm:bottom-6 ' +
          (open ? 'sm:right-[556px] ring-2 ring-primary ring-offset-2 ring-offset-app-bg dark:ring-offset-[#0F0F17]' : '')
        }
        style={undefined}
      >
        🦦
      </button>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0.6; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </>,
    document.body,
  );
}
