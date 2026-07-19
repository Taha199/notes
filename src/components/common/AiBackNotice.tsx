import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

/** Show until end of day Sunday 26 Jul 2026 (one week from ship). */
const AI_BACK_NOTICE_UNTIL = Date.parse('2026-07-26T23:59:59');
const DISMISS_KEY = 'malacadhati_ai_back_notice_dismissed';

export function AiBackNotice() {
  const { isPlus } = useAuth();
  const { lang } = useLanguage();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (!isPlus || dismissed || Date.now() > AI_BACK_NOTICE_UNTIL) return null;

  const message =
    lang === 'sv'
      ? 'AI-funktionerna fungerar igen för Plus-medlemmar.'
      : 'AI features are working again for Plus members.';

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-emerald-200/80 bg-emerald-50/80 px-3 py-2.5 text-[13px] leading-relaxed text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200 sm:px-5"
    >
      <p className="min-w-0 flex-1">✨ {message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label={lang === 'sv' ? 'Stäng' : 'Dismiss'}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-emerald-700/70 transition hover:bg-emerald-200/60 hover:text-emerald-900 dark:text-emerald-300/70 dark:hover:bg-emerald-500/20 dark:hover:text-emerald-100"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
}
