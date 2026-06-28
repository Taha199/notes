import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';

export function FloatingOtterSearch() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const openGoogle = (q?: string) => {
    const term = (q ?? query).trim();
    const url = term
      ? `https://www.google.com/search?q=${encodeURIComponent(term)}`
      : 'https://www.google.com';
    window.open(url, '_blank', 'noopener,noreferrer');
    if (term) setQuery('');
  };

  return createPortal(
    <div ref={rootRef} className="fixed bottom-5 right-5 z-[100001] flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div
          role="dialog"
          aria-label={t.otterSearchTitle}
          className="w-[min(92vw,380px)] origin-bottom-right animate-fade-in overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-gray-900"
          style={{ animation: 'fadeIn 0.18s ease-out' }}
        >
          <div className="border-b border-app-border px-4 py-3 dark:border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight">
                <span className="text-[#4285F4]">G</span>
                <span className="text-[#EA4335]">o</span>
                <span className="text-[#FBBC05]">o</span>
                <span className="text-[#4285F4]">g</span>
                <span className="text-[#34A853]">l</span>
                <span className="text-[#EA4335]">e</span>
              </span>
              <span className="text-xs text-app-text-secondary dark:text-gray-400">{t.otterSearchTitle}</span>
            </div>
          </div>
          <form
            className="flex items-center gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              openGoogle();
            }}
          >
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.otterSearchPlaceholder}
              className="min-w-0 flex-1 rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm text-app-text outline-none focus:border-primary dark:border-white/15 dark:bg-white/5 dark:text-gray-100"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition hover:bg-primary-dark"
            >
              {t.otterSearchGo}
            </button>
          </form>
          <div className="border-t border-app-border px-3 py-2 dark:border-white/10">
            <button
              type="button"
              onClick={() => openGoogle('')}
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-app-text-secondary transition hover:bg-app-bg hover:text-app-text dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
            >
              google.com ↗
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.otterSearchToggle}
        aria-expanded={open}
        className={
          'flex h-14 w-14 items-center justify-center rounded-full border border-white/60 bg-white text-3xl shadow-xl shadow-primary/25 transition-all hover:scale-105 hover:shadow-2xl active:scale-95 dark:border-white/10 dark:bg-gray-900 ' +
          (open ? 'ring-2 ring-primary ring-offset-2 ring-offset-app-bg dark:ring-offset-[#0F0F17]' : '')
        }
      >
        🦦
      </button>
    </div>,
    document.body,
  );
}
