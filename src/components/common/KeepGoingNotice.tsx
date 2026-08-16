import { useEffect, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

/** Visible for ~24h from ship (until end of Mon 17 Aug 2026 local). */
const KEEP_GOING_NOTICE_UNTIL = Date.parse('2026-08-17T23:59:59+02:00');

export function KeepGoingNotice() {
  const { lang } = useLanguage();
  // Session-only dismiss — every refresh shows the banner again.
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(() => Date.now() <= KEEP_GOING_NOTICE_UNTIL);

  useEffect(() => {
    if (Date.now() > KEEP_GOING_NOTICE_UNTIL) {
      setActive(false);
      return;
    }
    const ms = KEEP_GOING_NOTICE_UNTIL - Date.now();
    const timer = window.setTimeout(() => setActive(false), ms);
    return () => window.clearTimeout(timer);
  }, []);

  if (!active || dismissed) return null;

  const dismissLabel = lang === 'sv' ? 'Stäng' : 'Dismiss';

  return (
    <div
      role="status"
      dir="rtl"
      lang="ar"
      className="flex items-center gap-3 border-b border-amber-200/80 bg-gradient-to-l from-amber-50 via-orange-50/80 to-amber-50/90 px-3 py-3 text-[15px] font-semibold leading-relaxed text-amber-950 dark:border-amber-500/25 dark:from-amber-500/15 dark:via-orange-500/10 dark:to-amber-500/10 dark:text-amber-100 sm:px-5"
    >
      <p className="min-w-0 flex-1 text-center tracking-wide">
        ضلك ماشي بتوصل 💪
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={dismissLabel}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-amber-800/70 transition hover:bg-amber-200/60 hover:text-amber-950 dark:text-amber-200/70 dark:hover:bg-amber-500/20 dark:hover:text-amber-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
