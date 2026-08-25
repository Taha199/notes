import { useEffect, useState } from 'react';
import type { QuizSection } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

export function QuizSectionHeading({
  section,
  onSave,
  onDelete,
}: {
  section: QuizSection;
  onSave: (title: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.title);

  useEffect(() => {
    if (!editing) setDraft(section.title);
  }, [section.title, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onDelete();
      return;
    }
    onSave(trimmed);
    setEditing(false);
  };

  return (
    <div className="group rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 dark:border-primary/30 dark:bg-primary/10">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setEditing(false); setDraft(section.title); }
            }}
            autoFocus
            className="min-w-0 flex-1 rounded-xl border border-app-border bg-white px-3 py-2 text-sm font-semibold text-app-text outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-900 dark:text-gray-100"
            placeholder={t.quizSectionTitlePh}
          />
          <button
            type="button"
            onClick={commit}
            className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
          >
            {t.quizSectionSave}
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setDraft(section.title); }}
            className="rounded-xl border border-app-border px-3 py-2 text-xs font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10"
          >
            {t.quizSectionCancel}
          </button>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70">{t.quizSectionLabel}</p>
            <h3 className="mt-1 text-base font-bold leading-snug text-app-text dark:text-gray-100">{section.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-lg px-2 py-1 text-[11px] text-app-text-secondary hover:bg-white/80 hover:text-primary dark:hover:bg-white/10"
              title={t.quizSectionEdit}
            >
              ✏️
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg px-2 py-1 text-[11px] text-app-text-secondary hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title={t.quizSectionDelete}
            >
              🗑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function QuizSectionDraft({
  onSave,
  onCancel,
}: {
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');

  return (
    <div className="rounded-2xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3 dark:border-primary/40 dark:bg-primary/10">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary/70">{t.quizSectionLabel}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const trimmed = draft.trim();
              if (trimmed) onSave(trimmed);
            }
            if (e.key === 'Escape') onCancel();
          }}
          autoFocus
          className="min-w-0 flex-1 rounded-xl border border-app-border bg-white px-3 py-2 text-sm font-semibold text-app-text outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-900 dark:text-gray-100"
          placeholder={t.quizSectionTitlePh}
        />
        <button
          type="button"
          onClick={() => { const trimmed = draft.trim(); if (trimmed) onSave(trimmed); }}
          disabled={!draft.trim()}
          className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
        >
          {t.quizSectionSave}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-app-border px-3 py-2 text-xs font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10"
        >
          {t.quizSectionCancel}
        </button>
      </div>
    </div>
  );
}
