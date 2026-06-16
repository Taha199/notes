import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import type { Lang } from '../../types';

const OPTIONS: { code: Lang; flag: string; label: string }[] = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'sv', flag: '🇸🇪', label: 'Svenska' },
];

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className={className}>
      <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-xl border border-app-border/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-app-text-secondary backdrop-blur-md transition-all hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-300"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z" />
        </svg>
        {t.label}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={'transition-transform ' + (open ? 'rotate-180' : '')}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-2 min-w-[150px] rounded-xl border border-app-border bg-white p-1.5 shadow-xl animate-fade-in dark:border-white/10 dark:bg-gray-800">
          {OPTIONS.map((o) => (
            <button
              key={o.code}
              onClick={() => {
                setLang(o.code);
                setOpen(false);
              }}
              className={
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-app-bg dark:hover:bg-white/10 ' +
                (lang === o.code ? 'bg-primary/10 font-semibold text-primary' : 'text-app-text dark:text-gray-200')
              }
            >
              <span className="text-base">{o.flag}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
