import type { Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { HighlightedText } from '../common/HighlightedText';
import { QuizItemQaDisplay } from '../quiz/QuizItemQaDisplay';
import type { GlobalSearchResult } from '../../lib/globalSearch';

function CategoryBadge({ label, favorite }: { label: string; favorite?: boolean }) {
  return (
    <span
      className={
        'inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
        (favorite
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
          : 'bg-app-bg text-app-text-secondary dark:bg-white/10 dark:text-gray-400')
      }
    >
      {label}
    </span>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
      <span className="mb-3 text-5xl opacity-30">🔎</span>
      <p className="text-sm">{text}</p>
    </div>
  );
}

export function GlobalSearchResults({
  results,
  search,
  searchHitStarts,
  activeSearchHitIndex,
  emptyText,
  onOpenNote,
  onOpenQuiz,
}: {
  results: GlobalSearchResult[];
  search: string;
  searchHitStarts: Record<string, number>;
  activeSearchHitIndex: number | null;
  emptyText: string;
  onOpenNote: (noteId: number, page: Page) => void;
  onOpenQuiz: (itemId: number) => void;
}) {
  const { t } = useLanguage();

  if (!results.length) return <EmptyState text={emptyText} />;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2.5 pb-6">
      {results.map((result) => {
        const key = `${result.type}-${result.id}`;
        const hitStart = searchHitStarts[key] ?? 0;
        const counter = { value: hitStart };

        if (result.type === 'note' && result.note) {
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenNote(result.note!.id, result.targetPage ?? 'home')}
              className={
                'animate-slide-up flex w-full flex-col gap-2 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-800/60 ' +
                (result.isFavorite
                  ? 'border-amber-300 dark:border-amber-500/40'
                  : 'border-app-border dark:border-white/10')
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <CategoryBadge label={result.categoryLabel} favorite={result.isFavorite} />
                <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-500">📝 {t.searchResultNote}</span>
              </div>
              {result.title && (
                <p className="text-sm font-semibold text-app-text dark:text-gray-100">
                  <HighlightedText text={result.title} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
                </p>
              )}
              {result.snippet && (
                <p className="text-[13px] leading-relaxed text-app-text-secondary dark:text-gray-400">
                  <HighlightedText text={result.snippet} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
                </p>
              )}
            </button>
          );
        }

        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpenQuiz(result.id)}
            className={
              'animate-slide-up flex w-full flex-col gap-2.5 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-800/60 ' +
              (result.isFavorite
                ? 'border-amber-300 dark:border-amber-500/40'
                : 'border-app-border dark:border-white/10')
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge label={result.categoryLabel} favorite={result.isFavorite} />
              <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-500">🧠 {t.searchResultQuiz}</span>
            </div>
            {result.quizItem?.noteTitle && (
              <p className="text-[11px] text-app-text-secondary/70 dark:text-gray-500">
                <HighlightedText text={result.quizItem.noteTitle} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
              </p>
            )}
            {result.quizItem && (
              <QuizItemQaDisplay
                item={result.quizItem}
                search={search}
                hitCounter={counter}
                activeSearchHitIndex={activeSearchHitIndex}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
