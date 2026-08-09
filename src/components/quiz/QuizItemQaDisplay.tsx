import type { QuizItem } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { StableNoteHtml } from '../notes/StableNoteHtml';
import { mdToHtml } from '../../lib/quizHtml';
import { highlightHtmlContent, type SearchHitCounter } from '../../lib/noteSearch';

const QUESTION_CLASS =
  'note-content block w-full max-w-full min-w-0 break-words whitespace-normal text-center text-[14px] font-semibold leading-relaxed text-app-text [overflow-wrap:anywhere] dark:text-gray-100 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal';

const ANSWER_CLASS =
  'note-content block w-full max-w-full min-w-0 break-words whitespace-normal text-[14px] leading-[1.7] text-app-text [overflow-wrap:anywhere] dark:text-gray-100 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal [&_.note-img-frame]:my-3 [&_.note-img-frame]:cursor-zoom-in [&_.note-img-frame]:max-w-full [&_.note-yt-frame]:mx-auto [&>ul:first-child]:mt-0 [&>ol:first-child]:mt-0 [&_.note-img-frame_img]:my-0 [&_.note-img-frame_img]:block [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:max-h-none [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:cursor-zoom-in [&_.note-img-frame_img]:rounded-none [&_.note-img-frame_img]:border-0 [&_.note-img-frame_img]:bg-transparent [&_.note-img-frame_img]:object-contain [&_.note-img-frame_img]:p-0 [&_.note-img-frame_img]:shadow-none';

const HIGHLIGHT_CLASS =
  ' [&_.note-search-hit]:rounded-sm [&_.note-search-hit]:bg-amber-200 [&_.note-search-hit]:px-0.5 [&_.note-search-hit]:font-semibold [&_.note-search-hit]:text-amber-950 dark:[&_.note-search-hit]:bg-amber-400/35 dark:[&_.note-search-hit]:text-amber-100';

function renderHtml(
  content: string,
  search: string,
  counter?: SearchHitCounter,
  activeSearchHitIndex?: number | null,
) {
  const html = mdToHtml(content);
  if (!search.trim() || !counter) return html;
  return highlightHtmlContent(html, search, counter, activeSearchHitIndex ?? null);
}

export function QuizItemQaDisplay({
  item,
  search = '',
  hitCounter,
  activeSearchHitIndex = null,
}: {
  item: QuizItem;
  search?: string;
  hitCounter?: SearchHitCounter;
  activeSearchHitIndex?: number | null;
}) {
  const { t } = useLanguage();

  return (
    <div className="overflow-hidden rounded-xl border border-app-border bg-white dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 flex-col items-start overflow-x-hidden px-4 py-3.5 sm:px-5 sm:py-4">
          <span className="mb-2 text-[9px] font-bold uppercase text-app-text-secondary/45">{t.quizQuestionLabel}</span>
          <StableNoteHtml
            html={renderHtml(item.question, search, hitCounter, activeSearchHitIndex)}
            className={QUESTION_CLASS + HIGHLIGHT_CLASS}
          />
        </div>
        <div className="flex min-w-0 flex-col items-start overflow-x-hidden border-t border-app-border bg-app-bg/55 px-4 py-3.5 dark:border-white/10 dark:bg-white/[0.035] sm:px-6 sm:py-4 sm:pr-5">
          <span className="mb-2 text-[9px] font-bold uppercase text-primary/70">{t.quizAnswerLabel}</span>
          <StableNoteHtml
            html={renderHtml(item.answer, search, hitCounter, activeSearchHitIndex)}
            className={ANSWER_CLASS + HIGHLIGHT_CLASS}
          />
          {item.explanation && (
            <div className="mt-3 w-full max-w-full overflow-x-hidden rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-400/70">{t.quizExplanationLabel}</p>
              <div
                dir="auto"
                className="note-content break-words text-[13px] leading-relaxed text-amber-900 [overflow-wrap:anywhere] dark:text-amber-200"
                dangerouslySetInnerHTML={{ __html: mdToHtml(item.explanation) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
