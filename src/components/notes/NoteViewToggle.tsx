import type { NoteViewMode } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

export function NoteViewToggle({
  mode,
  onChange,
  showLabel = true,
}: {
  mode: NoteViewMode;
  onChange: (mode: NoteViewMode) => void;
  showLabel?: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      {showLabel && (
        <span className="text-[11px] font-semibold uppercase tracking-wide text-app-text-secondary dark:text-gray-400">
          {t.notesViewLabel}
        </span>
      )}
      <div className="flex items-center rounded-xl border border-primary/25 bg-primary/5 p-0.5 shadow-sm dark:border-primary/35 dark:bg-primary/10">
        <button
          type="button"
          onClick={() => onChange('grid')}
          title={t.notesViewGridTitle}
          aria-pressed={mode === 'grid'}
          className={
            'flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition ' +
            (mode === 'grid'
              ? 'bg-primary text-white shadow-sm'
              : 'text-app-text-secondary hover:text-app-text dark:text-gray-300 dark:hover:text-white')
          }
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>{t.notesViewGrid}</span>
        </button>
        <button
          type="button"
          onClick={() => onChange('expanded')}
          title={t.notesViewExpandedTitle}
          aria-pressed={mode === 'expanded'}
          className={
            'flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition ' +
            (mode === 'expanded'
              ? 'bg-primary text-white shadow-sm'
              : 'text-app-text-secondary hover:text-app-text dark:text-gray-300 dark:hover:text-white')
          }
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h10" />
          </svg>
          <span>{t.notesViewExpanded}</span>
        </button>
      </div>
    </div>
  );
}
