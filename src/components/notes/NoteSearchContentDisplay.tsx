import type { Note } from '../../types';
import { StableNoteHtml } from './StableNoteHtml';
import { getNoteSearchPlainText, highlightHtmlContent, type SearchHitCounter } from '../../lib/noteSearch';

const CONTENT_CLASS =
  'note-content block w-full max-w-full min-w-0 break-words whitespace-normal text-[14px] leading-relaxed text-app-text-secondary [overflow-wrap:anywhere] dark:text-gray-300 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal [&_.note-img-frame]:mx-auto [&_.note-img-frame]:cursor-zoom-in [&_.note-search-hit]:rounded-sm [&_.note-search-hit]:bg-amber-200 [&_.note-search-hit]:px-0.5 [&_.note-search-hit]:font-semibold [&_.note-search-hit]:text-amber-950 dark:[&_.note-search-hit]:bg-amber-400/35 dark:[&_.note-search-hit]:text-amber-100 [&_img]:mx-auto [&_img]:my-2 [&_img]:block [&_img]:h-auto [&_img]:max-h-64 [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-lg [&_img]:object-contain [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:mb-2 [&_h2]:mb-2 [&_h3]:mb-2 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-app-border [&_blockquote]:pl-3';

export function NoteSearchContentDisplay({
  note,
  search = '',
  hitCounter,
  activeSearchHitIndex = null,
}: {
  note: Note;
  search?: string;
  hitCounter?: SearchHitCounter;
  activeSearchHitIndex?: number | null;
}) {
  const bodyText = getNoteSearchPlainText(note);
  const previewHtml = note.html || `<p>${bodyText}</p>`;
  const html =
    search.trim() && hitCounter
      ? highlightHtmlContent(previewHtml, search, hitCounter, activeSearchHitIndex)
      : previewHtml;

  return (
    <div className="overflow-hidden rounded-xl border border-app-border bg-white dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="min-w-0 overflow-x-hidden px-4 py-3.5 sm:px-5 sm:py-4">
        <StableNoteHtml html={html} className={CONTENT_CLASS} />
      </div>
    </div>
  );
}
