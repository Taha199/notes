import type { NoteViewMode } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

export function NoteViewToggle({
  mode,
  onChange,
}: {
  mode: NoteViewMode;
  onChange: (mode: NoteViewMode) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-shrink-0 items-center rounded-xl border border-app-border bg-app-bg p-0.5 dark:border-white/10 dark:bg-white/5">
      <button
        type="button"
        onClick={() => onChange('grid')}
        title={t.notesViewGridTitle}
        aria-pressed={mode === 'grid'}
        className={
          'flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition ' +
          (mode === 'grid'
            ? 'bg-white text-primary shadow-sm dark:bg-gray-800'
            : 'text-app-text-secondary hover:text-app-text dark:text-gray-400 dark:hover:text-gray-200')
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        <span className="hidden sm:inline">{t.notesViewGrid}</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('expanded')}
        title={t.notesViewExpandedTitle}
        aria-pressed={mode === 'expanded'}
        className={
          'flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-semibold transition ' +
          (mode === 'expanded'
            ? 'bg-white text-primary shadow-sm dark:bg-gray-800'
            : 'text-app-text-secondary hover:text-app-text dark:text-gray-400 dark:hover:text-gray-200')
        }
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M4 6h16" />
          <path d="M4 12h16" />
          <path d="M4 18h10" />
        </svg>
        <span className="hidden sm:inline">{t.notesViewExpanded}</span>
      </button>
    </div>
  );
}
