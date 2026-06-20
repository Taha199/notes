import { useState } from 'react';
import type { Note } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import { useToast } from '../../contexts/ToastContext';
import { ConfirmDialog } from '../common/ConfirmDialog';

interface Props {
  note: Note;
  onOpen: (id: number) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
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

export function NoteCard({ note, onOpen, selectMode, selected, onToggleSelect }: Props) {
  const { t, lang } = useLanguage();
  const { toggleRead, toggleUnread, toggleFav, archive, unarchive, trash, restore, permDelete } = useNotes();
  const { show } = useToast();
  const [confirmPermDel, setConfirmPermDel] = useState(false);

  const handleClick = () => {
    if (selectMode && onToggleSelect) onToggleSelect(note.id);
    else onOpen(note.id);
  };

  const isTrash = !!note.trashed;

  return (
    <div
      onClick={handleClick}
      className={
        'animate-slide-up flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg dark:bg-gray-800/60 ' +
        (note.fav && !isTrash
          ? 'border-amber-300 bg-gradient-to-br from-amber-50 to-white dark:border-amber-500/40 dark:from-amber-500/10'
          : 'border-app-border dark:border-white/10') +
        (selected ? ' ring-2 ring-primary border-primary' : '')
      }
    >
      <div className="flex flex-1 items-start gap-2.5 p-4 pb-2">
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
            <p className={'truncate text-sm font-semibold ' + (note.fav ? 'text-amber-900 dark:text-amber-300' : 'text-app-text dark:text-gray-100')}>
              {note.title}
            </p>
          )}
          <p className={'mt-0.5 line-clamp-3 text-[13px] leading-relaxed ' + (note.fav ? 'text-amber-700 dark:text-amber-400/80' : 'text-app-text-secondary dark:text-gray-400')}>
            {note.text?.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 220)}
          </p>
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
                ? note.archived ? 'Återställs till Arkiv' : note.read ? 'Återställs till Lästa' : 'Återställs till Olästa'
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
                className={note.fav ? 'border-amber-300 bg-amber-50 text-amber-600' : 'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'}
                onClick={() => {
                  toggleFav(note.id);
                  show(note.fav ? t.tFavRem : t.tFavAdd);
                }}
              >
                ★
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
                className={note.fav ? 'border-amber-300 bg-amber-50 text-amber-600' : 'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'}
                onClick={() => {
                  toggleFav(note.id);
                  show(note.fav ? t.tFavRem : t.tFavAdd);
                }}
              >
                ★
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
