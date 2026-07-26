import { useState } from 'react';
import type { Note, NoteViewMode } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { HighlightedText } from '../common/HighlightedText';
import { getNoteSearchPlainText, highlightHtmlContent, type SearchHitCounter } from '../../lib/noteSearch';

interface Props {
  note: Note;
  search?: string;
  searchHitStart?: number;
  activeSearchHitIndex?: number | null;
  onOpen: (id: number) => void;
  viewMode?: NoteViewMode;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
}

function favBtnClass(active: boolean) {
  return active
    ? '!border-amber-400 !bg-amber-100 !text-amber-500 shadow-sm shadow-amber-300/50 ring-1 ring-amber-300/50 dark:!border-amber-500/60 dark:!bg-amber-500/25 dark:!text-amber-300 dark:shadow-amber-500/20 dark:ring-amber-500/30'
    : 'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-500 dark:hover:border-amber-500/40 dark:hover:bg-amber-500/10 dark:hover:text-amber-300';
}

function ActionBtn({ onClick, title, children, className = '' }: { onClick: (e: React.MouseEvent) => void; title?: string; children: React.ReactNode; className?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title={title}
      className={
        'inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-app-border bg-white text-[13px] text-app-text-secondary transition-all hover:scale-110 dark:border-white/10 dark:bg-gray-800 dark:text-gray-400 ' +
        className
      }
    >
      {children}
    </button>
  );
}

export function NoteCard({ note, search = '', searchHitStart = 0, activeSearchHitIndex = null, onOpen, viewMode = 'grid', selectMode, selected, onToggleSelect }: Props) {
  const { t, lang } = useLanguage();
  const { toggleRead, toggleUnread, toggleFav, archive, unarchive, trash, restore, permDelete } = useNotes();
  const { show } = useToast();
  const [confirmPermDel, setConfirmPermDel] = useState(false);
  const expanded = viewMode === 'expanded';

  const handleClick = () => {
    if (selectMode && onToggleSelect) onToggleSelect(note.id);
    else onOpen(note.id);
  };

  const isTrash = !!note.trashed;
  const hasSearch = search.trim().length > 0;
  const bodyText = getNoteSearchPlainText(note);
  const hitCounter: SearchHitCounter = { value: searchHitStart };
  const previewHtml = note.html || `<p>${bodyText}</p>`;
  const bodyPreview = hasSearch ? bodyText : bodyText.slice(0, 220);
  const favSearchHit =
    ' [&_.note-search-hit]:!rounded-sm [&_.note-search-hit]:!bg-orange-500 [&_.note-search-hit]:!px-0.5 [&_.note-search-hit]:!font-semibold [&_.note-search-hit]:!text-white [&_.note-search-hit]:shadow-sm dark:[&_.note-search-hit]:!bg-orange-400 dark:[&_.note-search-hit]:!text-white [&_.note-search-hit--active]:!bg-orange-600 [&_.note-search-hit--active]:!text-white [&_.note-search-hit--active]:!shadow-md dark:[&_.note-search-hit--active]:!bg-orange-300 dark:[&_.note-search-hit--active]:!text-gray-900';

  return (
    <div
      onClick={handleClick}
      className={
        'animate-slide-up flex cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all dark:bg-gray-800/60 ' +
        (expanded ? 'hover:shadow-md' : 'h-full hover:-translate-y-0.5 hover:shadow-lg') +
        (note.fav && !isTrash
          ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/40 dark:from-amber-500/10'
          : 'border-app-border dark:border-white/10') +
        (note.fav && !isTrash && hasSearch ? favSearchHit : '') +
        (selected ? ' ring-2 ring-primary border-primary' : '')
      }
    >
      <div className={'flex flex-1 items-start gap-2.5 ' + (expanded ? 'p-5 pb-3' : 'p-4 pb-2')}>
        {selectMode && (
          <input
            type="checkbox"
            checked={!!selected}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect?.(note.id)}
            className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
          />
        )}
        <div className="min-w-0 flex-1">
          {note.title && (
            <p className={'text-sm font-semibold ' + (expanded ? 'mb-2' : hasSearch ? '' : 'truncate') + ' ' + (note.fav ? 'text-amber-900 dark:text-amber-300' : 'text-app-text dark:text-gray-100')}>
              <HighlightedText text={note.title} search={search} counter={hitCounter} activeHitIndex={activeSearchHitIndex} />
            </p>
          )}
          {expanded ? (
            <div
              className="note-content text-[14px] leading-relaxed text-app-text-secondary dark:text-gray-300 [&_.note-img-frame]:cursor-zoom-in [&_.note-img-frame]:max-w-full [&_.note-search-hit]:rounded-sm [&_.note-search-hit]:bg-amber-200 [&_.note-search-hit]:px-0.5 [&_.note-search-hit]:font-semibold [&_.note-search-hit]:text-amber-950 dark:[&_.note-search-hit]:bg-amber-400/35 dark:[&_.note-search-hit]:text-amber-100 [&_.note-img-frame_img]:block [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:max-h-none [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:cursor-zoom-in [&_.note-img-frame_img]:object-contain [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{
                __html: hasSearch
                  ? highlightHtmlContent(previewHtml, search, hitCounter, activeSearchHitIndex)
                  : previewHtml,
              }}
            />
          ) : (
            <p className={'mt-0.5 text-[13px] leading-relaxed ' + (hasSearch ? '' : 'line-clamp-3 ') + (note.fav ? 'text-amber-700 dark:text-amber-400/80' : 'text-app-text-secondary dark:text-gray-400')}>
              <HighlightedText text={bodyPreview} search={search} counter={hitCounter} activeHitIndex={activeSearchHitIndex} />
            </p>
          )}
          {!isTrash && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {note.fav && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{t.tagFav}</span>}
              {note.archived ? (
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/10 dark:text-gray-400">{t.tagArch}</span>
              ) : note.read ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{t.tagRead}</span>
              ) : (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">{t.tagUnread}</span>
              )}
              {note.html?.includes('<img') && (
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:bg-purple-500/20 dark:text-purple-300">🖼 Image</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-app-border/70 px-4 py-2.5 dark:border-white/10">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-app-text-secondary/70 dark:text-gray-500">{lang === 'sv' ? 'Skapad' : 'Created'}: {note.date}</span>
          {isTrash && note.deletedAt && (
            <span className="text-[10px] text-app-text-secondary/70 dark:text-gray-500">{lang === 'sv' ? 'Raderad' : 'Deleted'}: {note.deletedAt}</span>
          )}
          {isTrash && (
            <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/60">
              {lang === 'sv'
                ? note.archived ? 'Återställs till Arkiv' : note.read ? 'Återställs till Lästa anteckningar' : 'Återställs till Olästa anteckningar'
                : note.archived ? 'Restores to Archive' : note.read ? 'Restores to Read Notes' : 'Restores to Unstudied Notes'}
            </span>
          )}
          {note.lastEdited && (
            <span className="text-[10px] text-app-text-secondary/60 dark:text-gray-600">Edited: {note.lastEdited}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isTrash ? (
            <>
              <ActionBtn
                title={t.titleRestore}
                onClick={() => {
                  restore(note.id);
                  show(t.tRestored2);
                }}
              >
                ↩
              </ActionBtn>
              <ActionBtn
                title={t.titlePermDel}
                className="hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                onClick={() => setConfirmPermDel(true)}
              >
                ✕
              </ActionBtn>
            </>
          ) : note.archived ? (
            <>
              <ActionBtn
                title={t.titleUnarch}
                className="hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                onClick={() => {
                  unarchive(note.id);
                  show(t.tRestored);
                }}
              >
                ⤴
              </ActionBtn>
              <ActionBtn
                title={note.fav ? t.titleFavRem : t.titleFavAdd}
                className={favBtnClass(note.fav)}
                onClick={() => {
                  toggleFav(note.id);
                  show(note.fav ? t.tFavRem : t.tFavAdd);
                }}
              >
                <span className={note.fav ? 'text-[15px] leading-none' : ''}>★</span>
              </ActionBtn>
              <ActionBtn
                title={t.titleDel}
                className="hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                onClick={() => {
                  trash(note.id);
                  show(t.tMoved);
                }}
              >
                🗑️
              </ActionBtn>
            </>
          ) : (
            <>
              {note.read ? (
                <ActionBtn
                  title={t.titleUnread}
                  className="border-emerald-300 bg-emerald-50 text-emerald-600"
                  onClick={() => {
                    toggleUnread(note.id);
                    show(t.tUnread);
                  }}
                >
                  ↺
                </ActionBtn>
              ) : (
                <ActionBtn
                  title={t.titleDone}
                  onClick={() => {
                    toggleRead(note.id);
                    show(t.tRead);
                  }}
                >
                  ✓
                </ActionBtn>
              )}
              <ActionBtn
                title={note.fav ? t.titleFavRem : t.titleFavAdd}
                className={favBtnClass(note.fav)}
                onClick={() => {
                  toggleFav(note.id);
                  show(note.fav ? t.tFavRem : t.tFavAdd);
                }}
              >
                <span className={note.fav ? 'text-[15px] leading-none' : ''}>★</span>
              </ActionBtn>
              <ActionBtn
                title={t.titleArch}
                className="hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                onClick={() => {
                  archive(note.id);
                  show(t.tArched);
                }}
              >
                🗄
              </ActionBtn>
              <ActionBtn
                title={t.titleDel}
                className="hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                onClick={() => {
                  trash(note.id);
                  show(t.tMoved);
                }}
              >
                🗑️
              </ActionBtn>
            </>
          )}
        </div>
      </div>
      {confirmPermDel && (
        <ConfirmDialog
          message={t.cPermDel}
          count={1}
          confirmLabel={t.titlePermDel}
          cancelLabel="Avbryt"
          onConfirm={() => { setConfirmPermDel(false); permDelete(note.id); show(t.tPermDel); }}
          onCancel={() => setConfirmPermDel(false)}
        />
      )}
    </div>
  );
}
