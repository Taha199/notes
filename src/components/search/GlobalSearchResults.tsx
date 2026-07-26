import type { NoteViewMode, Page } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { HighlightedText } from '../common/HighlightedText';
import { NoteCard } from '../notes/NoteCard';
import { QuizItemQaDisplay } from '../quiz/QuizItemQaDisplay';
import type { GlobalSearchResult } from '../../lib/globalSearch';

function CategoryBadge({
  label,
  favorite,
  onClick,
}: {
  label: string;
  favorite?: boolean;
  onClick?: () => void;
}) {
  const className =
    'inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
    (favorite
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
      : 'bg-app-bg text-app-text-secondary dark:bg-white/10 dark:text-gray-400') +
    (onClick
      ? ' cursor-pointer transition-colors hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/15 dark:hover:text-primary'
      : '');

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={className}
      >
        {label}
      </button>
    );
  }

  return <span className={className}>{label}</span>;
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
  noteViewMode = 'expanded',
  onOpenNote,
  onOpenQuiz,
}: {
  results: GlobalSearchResult[];
  search: string;
  searchHitStarts: Record<string, number>;
  activeSearchHitIndex: number | null;
  emptyText: string;
  noteViewMode?: NoteViewMode;
  onOpenNote: (noteId: number, page: Page) => void;
  onOpenQuiz: (itemId: number, setId?: string | null, folderId?: string | null) => void;
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
            <div key={key} className="animate-slide-up flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2 px-1">
                <CategoryBadge label={result.categoryLabel} favorite={result.isFavorite} />
                <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-500">📝 {t.searchResultNote}</span>
              </div>
              <NoteCard
                note={result.note}
                search={search}
                searchHitStart={hitStart}
                activeSearchHitIndex={activeSearchHitIndex}
                onOpen={(id) => onOpenNote(id, result.targetPage ?? 'home')}
                viewMode={noteViewMode}
              />
            </div>
          );
        }

        const openQuiz = () => onOpenQuiz(result.id, result.quizSetId, result.quizFolderId);

        return (
          <div
            key={key}
            role="button"
            tabIndex={0}
            onClick={openQuiz}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openQuiz();
              }
            }}
            className={
              'animate-slide-up flex w-full cursor-pointer flex-col gap-2.5 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-800/60 ' +
              (result.isFavorite
                ? 'border-amber-300 dark:border-amber-500/40'
                : 'border-app-border dark:border-white/10')
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge
                label={result.categoryLabel}
                favorite={result.isFavorite}
                onClick={openQuiz}
              />
              <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-500">🧠 {t.searchResultQuiz}</span>
            </div>
            {(result.quizFolderName || result.quizSetName) && (
              <p className="px-0.5 text-[11px] text-app-text-secondary/70 dark:text-gray-500">
                {result.quizFolderName && (
                  <span>
                    <HighlightedText text={result.quizFolderName} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
                  </span>
                )}
                {result.quizFolderName && result.quizSetName && (
                  <span className="mx-1.5 text-app-text-secondary/35 dark:text-gray-600">·</span>
                )}
                {result.quizSetName && (
                  result.quizSetId ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openQuiz();
                      }}
                      className="font-semibold text-primary/90 transition-colors hover:text-primary hover:underline dark:text-primary/80"
                    >
                      <HighlightedText text={result.quizSetName} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
                    </button>
                  ) : (
                    <span className="font-semibold">
                      <HighlightedText text={result.quizSetName} search={search} counter={counter} activeHitIndex={activeSearchHitIndex} />
                    </span>
                  )
                )}
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
            {result.quizCreatedAt && (
              <div className="flex items-center border-t border-app-border/70 px-0.5 pt-2 dark:border-white/10">
                <span className="text-[10px] text-app-text-secondary/70 dark:text-gray-500">
                  {t.noteCreatedLabel}: {result.quizCreatedAt}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
