import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';

const GOOGLE_HOME_TAB = 'https://www.google.com/';
const GOOGLE_HOME_PANEL = 'https://www.google.com/webhp?igu=1';
const googleTabUrl = (q: string) =>
  q.trim()
    ? `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`
    : GOOGLE_HOME_TAB;
const googlePanelUrl = (q: string) =>
  q.trim()
    ? `https://www.google.com/search?igu=1&q=${encodeURIComponent(q.trim())}`
    : GOOGLE_HOME_PANEL;

export function FloatingOtterSearch() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [iframeSrc, setIframeSrc] = useState(GOOGLE_HOME_PANEL);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.body.classList.toggle('otter-search-open', open);
    return () => document.body.classList.remove('otter-search-open');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runSearch = (term?: string) => {
    const q = (term ?? query).trim();
    if (q) setQuery(q);
    setIframeSrc(googlePanelUrl(q));
  };

  const togglePanel = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setIframeSrc(googlePanelUrl(query));
    setOpen(true);
  };

  const openInNewTab = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = googleTabUrl(query);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openExternal = () => {
    window.open(googleTabUrl(query), '_blank', 'noopener,noreferrer');
  };

  return createPortal(
    <>
      <aside
        role="complementary"
        aria-label={t.otterSearchTitle}
        aria-hidden={!open}
        className={
          'otter-search-panel fixed inset-y-0 right-0 z-40 flex flex-col border-l border-app-border bg-white shadow-xl dark:border-white/10 dark:bg-gray-950 ' +
          (open ? 'pointer-events-auto' : 'pointer-events-none')
        }
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
          />
        </div>
      </aside>

      <div className="otter-launcher-wrap fixed bottom-5 right-5 z-50 sm:bottom-6">
        <button
          type="button"
          onClick={openInNewTab}
          title={t.otterSearchNewTab}
          aria-label={t.otterSearchNewTab}
          className="otter-launcher-tab"
        >
          +
        </button>
        <button
          type="button"
          onClick={togglePanel}
          aria-label={t.otterSearchToggle}
          aria-expanded={open}
          className={
            'otter-launcher flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/60 bg-white shadow-xl shadow-primary/25 dark:border-white/10 dark:bg-gray-900 ' +
            (open ? 'otter-launcher--open ring-2 ring-primary ring-offset-2 ring-offset-app-bg dark:ring-offset-[#0F0F17]' : '')
          }
        >
          <span className="otter-launcher-icon" aria-hidden="true">
            🦦
          </span>
          <span className="otter-launcher-google" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 48 48" role="img" aria-label="Google">
              <path
                fill="#FFC107"
                d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.223 36 24 36c-5.522 0-10-4.478-10-10s4.478-10 10-10c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7 13.507 7 5 15.507 5 26s8.507 19 19 19 19-8.507 19-19c0-1.341-.138-2.65-.389-3.917z"
              />
              <path
                fill="#FF3D00"
                d="M6.306 14.691l6.571 4.819C14.655 16.108 18.961 13 24 13c2.426 0 4.652.867 6.375 2.301l5.975-5.975C33.642 9.053 29.028 7 24 7c-7.682 0-14.344 4.337-17.694 10.691z"
              />
              <path
                fill="#4CAF50"
                d="M24 45c5.097 0 9.621-1.948 13.094-5.094l-6.057-4.909C29.223 36 24.723 37 24 37c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 41.556 16.227 45 24 45z"
              />
              <path
                fill="#1976D2"
                d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.057 4.909C35.852 41.09 41 36 41 26c0-1.341-.138-2.65-.389-3.917z"
              />
            </svg>
          </span>
        </button>
      </div>
    </>,
    document.body,
  );
}
