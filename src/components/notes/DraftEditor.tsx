import type { Draft } from '../../contexts/NotesContext';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { RichTextEditor } from './RichTextEditor';

export function DraftEditor({ draft, index, total }: { draft: Draft; index: number; total: number }) {
  const { t } = useLanguage();
  const { updateDraft, removeDraft, submitDraft } = useNotes();

  const plainText = draft.html.replace(/<[^>]*>/g, '').trim();

  const onHtmlChange = (html: string) => {
    updateDraft(draft.id, { html });
  };

  return (
    <div className="animate-fade-in relative">
      <div className="flex flex-col rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-800/60">
      <div className="flex items-center rounded-t-2xl border-b border-app-border bg-app-bg px-4 py-2 dark:border-white/10 dark:bg-white/5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-app-text-secondary dark:text-gray-400">
          ✏️ {t.draft}
          {total > 1 ? ' ' + (index + 1) : ''}
        </span>
      </div>
      <input
        value={draft.title}
        onChange={(e) => updateDraft(draft.id, { title: e.target.value })}
        placeholder={t.draftTiPh}
        maxLength={80}
        className="border-b border-app-border bg-transparent px-4 py-2.5 text-sm font-semibold text-app-text outline-none placeholder:font-normal placeholder:text-gray-400 dark:border-white/10 dark:text-gray-100"
      />
      <RichTextEditor html={draft.html} onChange={onHtmlChange} placeholder={t.draftEdPh} minHeight="180px" resizable />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-app-border px-3 py-2.5 dark:border-white/10 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            disabled={!plainText}
            onClick={() => submitDraft(draft.id)}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-primary/30 transition-all hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-35 sm:px-4"
          >
            ✓ {t.saveDraft}
          </button>
        </div>
        <button onClick={() => removeDraft(draft.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10">
          🗑
        </button>
      </div>
      </div>
      <button
        type="button"
        onClick={() => removeDraft(draft.id)}
        aria-label="Close draft"
        title="Close draft"
        className="absolute -right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-app-border bg-white text-sm text-app-text-secondary shadow-md transition-all hover:scale-105 hover:border-red-300 hover:text-red-500 dark:border-white/15 dark:bg-gray-800 dark:text-gray-300"
      >
        ✕
      </button>
    </div>
  );
}
