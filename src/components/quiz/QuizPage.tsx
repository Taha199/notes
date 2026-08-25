import { useState, useRef, useEffect, useLayoutEffect, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import { useNotes, FAVORITES_SET_ID } from '../../contexts/NotesContext';
import { AppRichTextEditor } from '../notes/AppRichTextEditor';
import { answerQuestion } from '../../lib/gemini';
import { mdToHtml } from '../../lib/quizHtml';
import { useAuth } from '../../contexts/AuthContext';
import { AiAnswerStyleToggle, useAiAnswerStyle } from './AiAnswerStyleToggle';
import { StudyMode } from './StudyMode';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { AutoFitText } from '../common/AutoFitText';
import { BrandedAlert } from '../common/BrandedAlert';
import { useLanguage } from '../../contexts/LanguageContext';
import { SaveStatusBadge } from '../common/SaveStatusIcon';
import { useToast } from '../../contexts/ToastContext';
import type { QuizItem, QuizSet, QuizFolder } from '../../types';
import { countQuizSetQuestions, quizItemCreatedAtMs, visibleQuizItems } from '../../lib/quizSort';
import { coerceQuizItems, withCoercedQuizSetItems } from '../../lib/quizSetMerge';
import { SITE_URL } from '../../lib/seo';
import { StableNoteHtml } from '../notes/StableNoteHtml';
import { FilesLoadingIndicator } from '../files/FilesLoadingIndicator';
import { quizPatchChangesContent } from '../../lib/quizContent';
import { hasRichContent } from '../../lib/richContent';
import { safeLocalStorageSet } from '../../lib/safeStorage';
import { findQuizItemSource } from '../../lib/quizItemSource';
import { getQuizSetColorOptions } from '../../lib/quizColors';
import { QuizColorPickerGrid } from './QuizColorPickerGrid';
import { buildQuizListRows } from '../../lib/quizSections';
import { QuizSectionDraft, QuizSectionHeading } from './QuizSectionHeading';

const PROGRESS_KEY = 'malacadhati_quiz_progress';
/** Per-item "hide answer" prefs (item id → true). Local-only; does not touch quiz content. */
const HIDDEN_ANSWERS_KEY = 'malacadhati_quiz_hidden_answers';
const QUIZ_SELECTION_KEY = 'malacadhati_quiz_selection';
/** Unsaved open Q/A forms — survives QuizPage unmount (sidebar nav) within the tab. */
const OPEN_FORMS_STASH_KEY = 'malacadhati_quiz_open_forms_v1';

function loadQuizSelection(): { folderId: string | null; setId: string | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(QUIZ_SELECTION_KEY) || '{}');
    return { folderId: raw.folderId ?? null, setId: raw.setId ?? null };
  } catch {
    return { folderId: null, setId: null };
  }
}

function saveQuizSelection(folderId: string | null, setId: string | null) {
  // Tiny payload — but any setItem throws QuotaExceeded when origin storage is full.
  safeLocalStorageSet(QUIZ_SELECTION_KEY, JSON.stringify({ folderId, setId }));
}

type ItemSort = 'manual' | 'newest' | 'oldest' | 'study';

const ITEM_SORT_OPTIONS: { key: ItemSort; labelKey: 'quizSortManualFull' | 'quizSortNewest' | 'quizSortOldest' | 'quizSortStudy'; shortKey: 'quizSortManualShort' | 'quizSortNewestShort' | 'quizSortOldestShort' | 'quizSortStudyShort' }[] = [
  { key: 'manual', labelKey: 'quizSortManualFull', shortKey: 'quizSortManualShort' },
  { key: 'newest', labelKey: 'quizSortNewest', shortKey: 'quizSortNewestShort' },
  { key: 'oldest', labelKey: 'quizSortOldest', shortKey: 'quizSortOldestShort' },
  { key: 'study', labelKey: 'quizSortStudy', shortKey: 'quizSortStudyShort' },
];

function loadItemSort(forSet: boolean): ItemSort {
  const key = forSet ? 'malacadhati_quiz_itemsort_set' : 'malacadhati_quiz_itemsort_notes';
  const stored = localStorage.getItem(key);
  if (stored === 'manual' || stored === 'newest' || stored === 'oldest' || stored === 'study') return stored;
  if (!forSet) {
    const legacy = localStorage.getItem('malacadhati_quiz_itemsort');
    if (legacy === 'manual' || legacy === 'newest' || legacy === 'oldest' || legacy === 'study') return legacy;
  }
  return forSet ? 'manual' : 'newest';
}

function loadProgress(): Record<string, Record<number, 'known' | 'learning'>> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function saveProgress(all: Record<string, Record<number, 'known' | 'learning'>>) {
  safeLocalStorageSet(PROGRESS_KEY, JSON.stringify(all));
}

function loadHiddenAnswers(): Record<number, true> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_ANSWERS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<number, true> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v) out[Number(k)] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function saveHiddenAnswers(map: Record<number, true>) {
  safeLocalStorageSet(HIDDEN_ANSWERS_KEY, JSON.stringify(map));
}

function normalizeQuizName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

// Content is valid if it has visible text OR an embedded image.
// Shared with notes/drafts so image-only content counts everywhere.
const hasContent = hasRichContent;

interface QuizItemRowProps {
  item: QuizItem;
  onEdit: (item: QuizItem) => void;
  onDelete: () => void;
  speakingId: number | null;
  onSpeak: (id: number) => void;
  favs: Set<number>;
  onToggleFav: (item: QuizItem) => void;
  progressMap?: Record<number, 'known' | 'learning'>;
  sets?: QuizSet[];
  folders?: QuizFolder[];
  onMoveToSet?: (setId: string, keepCopy: boolean) => void;
  hideAnswers?: boolean;
  /** Per-item hide preference (independent of set-level hide). */
  answerHidden?: boolean;
  onToggleHideAnswer?: (id: number) => void;
  onSetStatus?: (id: number, status: 'known' | 'learning' | null) => void;
  canReorder?: boolean;
  questionNumber?: number;
  totalQuestions?: number;
  onMoveToPosition?: (targetPosition: number) => void;
  sourceLocation?: {
    folderName: string | null;
    setName: string | null;
    setId: string | null;
    fromNotes: boolean;
  } | null;
  onOpenSource?: () => void;
  onAddRubrik?: () => void;
}

const QuizItemRow = memo(function QuizItemRow({ item, onEdit, onDelete, speakingId, onSpeak, favs, onToggleFav, progressMap, sets, folders, onMoveToSet, hideAnswers, answerHidden, onToggleHideAnswer, onSetStatus, canReorder, questionNumber, totalQuestions, onMoveToPosition, sourceLocation, onOpenSource, onAddRubrik }: QuizItemRowProps) {
  const { t } = useLanguage();
  const [moveOpen, setMoveOpen] = useState(false);
  const [keepCopy, setKeepCopy] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [targetPos, setTargetPos] = useState('');
  const commitMove = () => {
    const n = parseInt(targetPos, 10);
    if (!n || n === questionNumber || n < 1 || n > (totalQuestions ?? 0)) {
      setTargetPos('');
      return;
    }
    onMoveToPosition?.(n);
    setTargetPos('');
  };
  // Re-hide a revealed card whenever global or per-item hide flips
  useEffect(() => { setRevealed(false); }, [hideAnswers, answerHidden]);
  const status = progressMap?.[item.id];
  const masked = (!!hideAnswers || !!answerHidden) && !revealed;
  // Mark which cards need more studying: known = done (green), everything else = study more.
  const accent = status === 'known'
    ? 'border-l-4 border-l-emerald-400'
    : status === 'learning'
      ? 'border-l-4 border-l-red-400'
      : 'border-l-4 border-l-amber-400';
  const studyMore = status !== 'known';
  return (
    <div id={`quiz-item-${item.id}`} className={'group overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e] ' + accent}>
      <div className="flex flex-col sm:flex-row sm:items-stretch">
        <div className={'grid min-w-0 flex-1 grid-cols-1 ' + (questionNumber ? 'sm:grid-cols-[52px_minmax(0,0.8fr)_minmax(0,1.2fr)]' : 'sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]')}>
          {questionNumber != null && (
            <div className="flex min-w-0 flex-row items-center justify-center gap-1.5 border-b border-app-border px-1.5 py-3 dark:border-white/10 sm:flex-col sm:border-b-0 sm:border-r sm:py-4">
              <span className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-lg bg-primary/10 text-[12px] font-bold tabular-nums text-primary">
                {questionNumber}
              </span>
              {canReorder && (
                <input
                  type="number"
                  min={1}
                  max={totalQuestions}
                  value={targetPos}
                  onChange={(e) => setTargetPos(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitMove();
                    }
                    if (e.key === 'Escape') setTargetPos('');
                  }}
                  onBlur={commitMove}
                  placeholder="#"
                  title={t.quizReorderHint}
                  aria-label={t.quizReorderAria}
                  className="h-7 w-9 rounded-lg border border-app-border bg-white text-center text-[11px] font-semibold tabular-nums text-app-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              )}
            </div>
          )}
          <div className="flex min-w-0 flex-col items-start overflow-x-hidden px-5 py-4">
            {sourceLocation && (sourceLocation.folderName || sourceLocation.setName) && (
              <p className="mb-2 w-full px-0.5 text-[11px] text-app-text-secondary/70 dark:text-gray-500">
                {sourceLocation.folderName && (
                  <span>{sourceLocation.folderName}</span>
                )}
                {sourceLocation.folderName && sourceLocation.setName && (
                  <span className="mx-1.5 text-app-text-secondary/35 dark:text-gray-600">·</span>
                )}
                {sourceLocation.setName && (
                  onOpenSource && (sourceLocation.setId || sourceLocation.fromNotes) ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenSource();
                      }}
                      className="font-semibold text-primary/90 transition-colors hover:text-primary hover:underline dark:text-primary/80"
                    >
                      {sourceLocation.setName}
                    </button>
                  ) : (
                    <span className="font-semibold">{sourceLocation.setName}</span>
                  )
                )}
              </p>
            )}
            <span className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase text-app-text-secondary/45">
              {t.quizQuestionLabel}
              {studyMore && (
                <span className={'rounded-full px-2 py-0.5 text-[8px] font-bold normal-case tracking-normal ' + (status === 'learning' ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400')}>
                  {t.quizStudyMore}
                </span>
              )}
            </span>
            <StableNoteHtml
              html={mdToHtml(item.question)}
              className="note-content block w-full max-w-full min-w-0 break-words whitespace-normal text-center text-[14px] font-semibold leading-relaxed text-app-text [overflow-wrap:anywhere] dark:text-gray-100 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal"
            />
          </div>
          <div className="flex min-w-0 flex-col items-start overflow-x-hidden border-t border-app-border bg-app-bg/55 px-5 py-4 dark:border-white/10 dark:bg-white/[0.035] sm:border-l sm:border-t-0 sm:px-6 sm:pr-5">
            <span className="mb-2 text-[9px] font-bold uppercase text-primary/70">{t.quizAnswerLabel}</span>
            <div className="relative w-full min-w-0 max-w-full overflow-x-hidden">
              <StableNoteHtml
                html={mdToHtml(item.answer)}
                className={'note-content block w-full max-w-full min-w-0 break-words whitespace-normal text-[14px] leading-[1.7] text-app-text [overflow-wrap:anywhere] dark:text-gray-100 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal [&_.note-img-frame]:my-3 [&_.note-img-frame]:cursor-zoom-in [&_.note-img-frame]:max-w-full [&_.note-yt-frame]:mx-auto [&>ul:first-child]:mt-0 [&>ol:first-child]:mt-0 [&_.note-img-frame_img]:my-0 [&_.note-img-frame_img]:block [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:max-h-none [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:cursor-zoom-in [&_.note-img-frame_img]:rounded-none [&_.note-img-frame_img]:border-0 [&_.note-img-frame_img]:bg-transparent [&_.note-img-frame_img]:object-contain [&_.note-img-frame_img]:p-0 [&_.note-img-frame_img]:shadow-none ' + (masked ? 'select-none blur-sm' : '')}
              />
              {masked && (
                <button
                  onClick={() => setRevealed(true)}
                  className="absolute inset-0 flex items-center justify-center rounded-lg bg-app-bg/40 text-[11px] font-semibold text-app-text-secondary backdrop-blur-[2px] transition hover:text-primary dark:bg-white/[0.02]"
                >
                  {t.quizRevealAnswer}
                </button>
              )}
            </div>
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
        <div className="relative z-10 flex w-full flex-shrink-0 flex-wrap items-center justify-end gap-2 border-t border-app-border bg-white px-3 py-2 dark:border-white/10 dark:bg-[#1e1e2e] sm:w-[68px] sm:flex-col sm:flex-nowrap sm:justify-center sm:gap-1.5 sm:border-l sm:border-t-0 sm:px-2 sm:py-3">
          {onSetStatus && (
            status === 'known' ? (
              <button
                onClick={() => onSetStatus(item.id, 'learning')}
                className="text-base text-emerald-500 transition-colors hover:text-red-500"
                title={t.quizMarkNotKnown}
              >✅</button>
            ) : (
              <button
                onClick={() => onSetStatus(item.id, 'known')}
                className="text-base text-app-text-secondary/40 transition-colors hover:text-emerald-500"
                title={t.quizMarkKnown}
              >☑️</button>
            )
          )}
          {onToggleHideAnswer && (
            <button
              onClick={() => onToggleHideAnswer(item.id)}
              className={'text-base transition-colors ' + (answerHidden || hideAnswers ? 'text-primary' : 'text-app-text-secondary/40 hover:text-primary')}
              title={answerHidden ? t.quizShowAnswer : t.quizHideAnswer}
              aria-label={answerHidden ? t.quizShowAnswer : t.quizHideAnswer}
              aria-pressed={!!answerHidden}
            >{answerHidden ? '👁️' : '🙈'}</button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFav(item); }}
            className={'text-base transition-colors ' + ((favs.has(item.id) || item.favOf != null) ? 'text-amber-400' : 'text-app-text-secondary/40 hover:text-amber-400')}
            title={t.quizFavorite}
            aria-pressed={favs.has(item.id) || item.favOf != null}
          >★</button>
          <button
            onClick={() => onSpeak(item.id)}
            className={'transition-colors ' + (speakingId === item.id ? 'text-primary' : 'text-app-text-secondary/40 hover:text-primary')}
            title={speakingId === item.id ? t.quizStopSpeak : t.quizSpeak}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
          <button onClick={() => onEdit(item)} className="text-[11px] text-app-text-secondary/40 transition-colors hover:text-primary" title={t.quizEdit}>✏️</button>
          {onAddRubrik && (
            <button
              type="button"
              onClick={onAddRubrik}
              className="text-[11px] text-app-text-secondary/40 transition-colors hover:text-primary"
              title={t.quizSectionAdd}
            >
              ¶
            </button>
          )}
          {onMoveToSet && sets && sets.length > 0 && (
            <>
              <button
                onClick={() => { setMoveOpen(true); setKeepCopy(false); setActiveFolderId(null); }}
                title={t.quizMoveToSet}
                className="text-[13px] text-app-text-secondary/40 transition-colors hover:text-primary"
              >📂</button>
              {moveOpen && createPortal(
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setMoveOpen(false)}>
                  <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between border-b border-app-border px-4 py-3 dark:border-white/10">
                      <p className="text-[13px] font-semibold text-app-text dark:text-gray-100">
                        {keepCopy ? t.quizCopyToSetTitle : t.quizMoveToSetTitle}
                      </p>
                      <button onClick={() => setMoveOpen(false)} className="text-app-text-secondary/50 hover:text-app-text">✕</button>
                    </div>
                    <label className="flex cursor-pointer items-start gap-2.5 border-b border-app-border/60 bg-app-bg/50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                      <input
                        type="checkbox"
                        checked={keepCopy}
                        onChange={(e) => setKeepCopy(e.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-medium text-app-text dark:text-gray-100">{t.quizKeepCopyHere}</span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-app-text-secondary/55">{t.quizKeepCopyHereHint}</span>
                      </span>
                    </label>
                    <div className="max-h-[420px] overflow-y-auto">
                      {/* Folders and their sets */}
                      {(folders ?? []).map((f) => {
                        const fSets = sets.filter((s) => s.folderId === f.id);
                        const open = activeFolderId === f.id;
                        return (
                          <div key={f.id}>
                            <button
                              onClick={() => setActiveFolderId(open ? null : f.id)}
                              className="flex w-full items-center gap-2.5 border-b border-app-border/40 px-4 py-2.5 text-left transition-colors hover:bg-app-bg dark:border-white/5 dark:hover:bg-white/5"
                            >
                              <span className="text-base">📁</span>
                              <span className="flex-1 text-[12px] font-bold text-app-text dark:text-gray-100">{f.name}</span>
                              <span className="text-[10px] text-app-text-secondary/40">{fSets.length} {t.quizSetsWord}</span>
                              <span className="text-[10px] text-app-text-secondary/30">{open ? '▲' : '▼'}</span>
                            </button>
                            {open && (
                              <div className="border-b border-app-border/40 bg-app-bg/40 dark:border-white/5 dark:bg-white/[0.02]">
                                {fSets.length === 0 ? (
                                  <p className="px-6 py-3 text-[11px] italic text-app-text-secondary/40">{t.quizNoSetsInFolder}</p>
                                ) : fSets.map((s) => (
                                  <button
                                    key={s.id}
                                    onClick={() => { onMoveToSet(s.id, keepCopy); setMoveOpen(false); }}
                                    className="flex w-full items-center gap-3 border-b border-app-border/20 px-6 py-2.5 text-left transition-colors last:border-b-0 hover:bg-primary/5 dark:border-white/5 dark:hover:bg-primary/10"
                                  >
                                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color ?? '#6C63FF' }} />
                                    <AutoFitText text={s.name} maxSize={13} minSize={9} className="flex-1 text-app-text dark:text-gray-100" />
                                    <span className="text-[11px] text-app-text-secondary/40">{countQuizSetQuestions(s)} {t.quizItemsShort}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </>
          )}
          <button onClick={onDelete} className="text-[13px] text-app-text-secondary/40 transition-all hover:scale-110 hover:text-red-500" title={t.quizDelete} aria-label={t.quizDelete}>🗑️</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-app-border/40 bg-app-bg/30 px-5 py-1.5 dark:border-white/5 dark:bg-white/[0.015]">
        {item.createdAt && (
          <span className="text-[10px] text-app-text-secondary/35 dark:text-gray-600">
            {t.quizCreated} {new Date(item.createdAt).toLocaleString()}
          </span>
        )}
        {item.updatedAt && item.updatedAt !== item.createdAt && (
          <span className="text-[10px] text-app-text-secondary/35 dark:text-gray-600">
            {t.quizUpdated} {new Date(item.updatedAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.item.id === next.item.id
  && prev.item.question === next.item.question
  && prev.item.answer === next.item.answer
  && prev.item.explanation === next.item.explanation
  && prev.hideAnswers === next.hideAnswers
  && prev.answerHidden === next.answerHidden
  && prev.speakingId === next.speakingId
  && (prev.favs.has(prev.item.id) || prev.item.favOf != null) === (next.favs.has(next.item.id) || next.item.favOf != null)
  && prev.progressMap?.[prev.item.id] === next.progressMap?.[next.item.id]
  && prev.questionNumber === next.questionNumber
  && prev.canReorder === next.canReorder
  && prev.totalQuestions === next.totalQuestions
  && prev.sourceLocation?.setId === next.sourceLocation?.setId
  && prev.sourceLocation?.setName === next.sourceLocation?.setName
  && prev.sourceLocation?.folderName === next.sourceLocation?.folderName
  && prev.sourceLocation?.fromNotes === next.sourceLocation?.fromNotes
));

const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface SavePayload {
  question: string;
  answer: string;
  options?: string[];
  correctIndex?: number;
  correctIndexes?: number[];
  explanation?: string;
}

interface OpenQuestionForm {
  formId: string;
  /** Set id or `__notes__` — drafts never render/update under another scope. */
  scopeKey: string;
  itemId: number | null;
  question: string;
  answer: string;
  saveStatus: 'empty' | 'syncing' | 'saved';
  // true when editing an already-saved question; drafts leave this falsy so
  // Cancel discards them even if they contain partial content.
  finalized?: boolean;
  // Local-only editor extras (MCQ). Kept in React state per set — never
  // soft-created in the cloud while typing.
  mcq?: boolean;
  options?: string[];
  correctIndexes?: number[];
  explanation?: string;
}

function cloneOpenForms(forms: OpenQuestionForm[]): OpenQuestionForm[] {
  return forms.map((f) => ({ ...f }));
}

function cloneOpenFormsMap(
  map: Record<string, OpenQuestionForm[]>,
): Record<string, OpenQuestionForm[]> {
  const out: Record<string, OpenQuestionForm[]> = {};
  for (const [key, forms] of Object.entries(map)) {
    out[key] = cloneOpenForms(forms);
  }
  return out;
}

type LocalFormMeta = {
  mcq: boolean;
  options: string[];
  correctIndexes: number[];
  explanation: string;
};

/** Scope key for stashing open Q/A forms across set/folder navigation. */
function formsScopeKey(setId: string | null, folderId: string | null): string | null {
  if (setId) return setId;
  if (!folderId) return '__notes__';
  return null;
}

function sanitizeOpenForm(raw: unknown): OpenQuestionForm | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<OpenQuestionForm>;
  if (typeof f.formId !== 'string' || !f.formId) return null;
  if (typeof f.scopeKey !== 'string' || !f.scopeKey) return null;
  if (f.itemId != null && typeof f.itemId !== 'number') return null;
  return {
    formId: f.formId,
    scopeKey: f.scopeKey,
    itemId: f.itemId ?? null,
    question: typeof f.question === 'string' ? f.question : '',
    answer: typeof f.answer === 'string' ? f.answer : '',
    saveStatus: f.saveStatus === 'syncing' || f.saveStatus === 'saved' || f.saveStatus === 'empty'
      ? (f.saveStatus === 'syncing' ? 'saved' : f.saveStatus)
      : 'empty',
    finalized: f.finalized ? true : undefined,
    mcq: typeof f.mcq === 'boolean' ? f.mcq : undefined,
    options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === 'string') : undefined,
    correctIndexes: Array.isArray(f.correctIndexes)
      ? f.correctIndexes.filter((n): n is number => typeof n === 'number')
      : undefined,
    explanation: typeof f.explanation === 'string' ? f.explanation : undefined,
  };
}

function loadDurableFormsByScope(): Record<string, OpenQuestionForm[]> {
  try {
    const raw = sessionStorage.getItem(OPEN_FORMS_STASH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, OpenQuestionForm[]> = {};
    for (const [scopeKey, forms] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(forms)) continue;
      const cleaned = forms
        .map(sanitizeOpenForm)
        .filter((f): f is OpenQuestionForm => !!f && f.scopeKey === scopeKey);
      if (cleaned.length) out[scopeKey] = cleaned;
    }
    return out;
  } catch {
    return {};
  }
}

function writeDurableFormsByScope(map: Record<string, OpenQuestionForm[]>) {
  const pruned: Record<string, OpenQuestionForm[]> = {};
  for (const [key, forms] of Object.entries(map)) {
    if (forms.length) pruned[key] = cloneOpenForms(forms);
  }
  // Module cache survives SPA route changes even if sessionStorage write fails.
  durableFormsByScopeCache = pruned;
  try {
    if (Object.keys(pruned).length === 0) {
      sessionStorage.removeItem(OPEN_FORMS_STASH_KEY);
    } else {
      sessionStorage.setItem(OPEN_FORMS_STASH_KEY, JSON.stringify(pruned));
    }
  } catch (err) {
    console.error('[quiz open forms] sessionStorage write failed', err);
  }
}

/** In-memory + sessionStorage stash keyed by scope (setId / `__notes__`). */
let durableFormsByScopeCache: Record<string, OpenQuestionForm[]> = loadDurableFormsByScope();
let durableFormsPersistTimer: ReturnType<typeof setTimeout> | null = null;

function readDurableFormsByScope(): Record<string, OpenQuestionForm[]> {
  return durableFormsByScopeCache;
}

function persistDurableFormsByScope(
  map: Record<string, OpenQuestionForm[]>,
  opts?: { immediate?: boolean },
) {
  durableFormsByScopeCache = map;
  if (opts?.immediate) {
    if (durableFormsPersistTimer) {
      clearTimeout(durableFormsPersistTimer);
      durableFormsPersistTimer = null;
    }
    writeDurableFormsByScope(map);
    return;
  }
  if (durableFormsPersistTimer) clearTimeout(durableFormsPersistTimer);
  durableFormsPersistTimer = setTimeout(() => {
    durableFormsPersistTimer = null;
    writeDurableFormsByScope(durableFormsByScopeCache);
  }, 200);
}

interface EditPanelProps {
  question: string;
  answer: string;
  initialOptions?: string[];
  initialCorrect?: number;
  initialCorrects?: number[];
  initialExplanation?: string;
  initialMcq?: boolean;
  saveStatus?: 'empty' | 'syncing' | 'saved';
  persisted?: boolean;
  questionNumber?: number | null;
  onChangeQ: (v: string) => void;
  onChangeA: (v: string) => void;
  onSave: (override?: SavePayload) => void;
  onCancel: () => void;
  /** Snapshot MCQ/local editor fields into the parent draft (no cloud). */
  onLocalMetaChange?: (meta: LocalFormMeta) => void;
}

function EditPanel({ question, answer, initialOptions, initialCorrect, initialCorrects, initialExplanation, initialMcq, saveStatus = 'empty', persisted = false, questionNumber, onChangeQ, onChangeA, onSave, onCancel, onLocalMetaChange }: EditPanelProps) {
  const { t } = useLanguage();
  const { hasAi } = useAuth();
  const { show } = useToast();
  const questionFlushRef = useRef<(() => string) | null>(null);
  const answerFlushRef = useRef<(() => string) | null>(null);
  const latestQuestionRef = useRef(question);
  const latestAnswerRef = useRef(answer);
  latestQuestionRef.current = question;
  latestAnswerRef.current = answer;
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiAnswerStyle, setAiAnswerStyle] = useAiAnswerStyle();
  const [mcq, setMcq] = useState<boolean>(initialMcq ?? !!(initialOptions && initialOptions.length));
  const [options, setOptions] = useState<string[]>(initialOptions && initialOptions.length ? initialOptions : ['', '']);
  const initCorrectSet = initialCorrects?.length
    ? new Set(initialCorrects)
    : initialCorrect !== undefined ? new Set([initialCorrect]) : new Set([0]);
  const [correctSet, setCorrectSet] = useState<Set<number>>(initCorrectSet);
  const [explanation, setExplanation] = useState<string>(initialExplanation ?? '');
  const onLocalMetaChangeRef = useRef(onLocalMetaChange);
  onLocalMetaChangeRef.current = onLocalMetaChange;

  // Keep parent draft meta in sync so set-switching can remount with MCQ state.
  useEffect(() => {
    onLocalMetaChangeRef.current?.({
      mcq,
      options,
      correctIndexes: Array.from(correctSet).sort((a, b) => a - b),
      explanation,
    });
  }, [mcq, options, correctSet, explanation]);

  const handleAiAnswer = async () => {
    const plain = question.replace(/<[^>]*>/g, '').trim();
    if (!plain) return;
    setAiLoading(true);
    try {
      const res = mdToHtml(await answerQuestion(plain, aiAnswerStyle));
      if (hasContent(answer)) setAiSuggestion(res);
      else onChangeA(res);
    } catch (e) {
      show(e instanceof Error ? e.message : 'AI-svar misslyckades');
    } finally {
      setAiLoading(false);
    }
  };

  const setOption = (i: number, v: string) => setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => (prev.length < OPT_LETTERS.length ? [...prev, ''] : prev));
  const removeOption = (i: number) => setOptions((prev) => {
    const next = prev.filter((_, idx) => idx !== i);
    setCorrectSet((cs) => {
      const remapped = new Set<number>();
      cs.forEach((c) => { if (c !== i) remapped.add(c > i ? c - 1 : c); });
      return remapped.size ? remapped : new Set([0]);
    });
    return next.length ? next : [''];
  });
  const toggleCorrect = (i: number) => setCorrectSet((prev) => {
    const next = new Set(prev);
    if (next.has(i)) { if (next.size > 1) next.delete(i); }
    else next.add(i);
    return next;
  });

  const handleSave = () => {
    const flushedQ = questionFlushRef.current?.();
    const flushedA = answerFlushRef.current?.();
    const pick = (flushed: string | undefined, latest: string, prop: string) => {
      if (flushed != null && hasContent(flushed)) return flushed;
      if (hasContent(latest)) return latest;
      if (hasContent(prop)) return prop;
      return flushed ?? latest ?? prop;
    };
    const finalQ = pick(flushedQ, latestQuestionRef.current, question);
    const finalA = pick(flushedA, latestAnswerRef.current, answer);
    if (!hasContent(finalQ) && !hasContent(finalA)) {
      show(t.quizSaveNeedContent);
      return;
    }
    if (!mcq) { onSave({ question: finalQ, answer: finalA }); return; }
    const kept = options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    if (kept.length < 2) {
      show(t.quizMcqNeedOptions);
      return;
    }
    const finalOptions = kept.map((x) => x.o);
    const newCorrectIndexes = kept
      .map((x, newIdx) => ({ newIdx, old: x.i }))
      .filter((x) => correctSet.has(x.old))
      .map((x) => x.newIdx);
    const safeCorrects = newCorrectIndexes.length ? newCorrectIndexes : [0];
    const optionsHtml = finalOptions
      .map((o, i) => `<div>${OPT_LETTERS[i]}) ${escapeHtml(o)}</div>`)
      .join('');
    const composedQ = `${finalQ}<div style="margin-top:6px">${optionsHtml}</div>`;
    const composedA = safeCorrects.map((ci) => `${OPT_LETTERS[ci]}) ${escapeHtml(finalOptions[ci])} ✓`).join('<br>');
    onSave({
      question: composedQ,
      answer: composedA,
      options: finalOptions,
      correctIndexes: safeCorrects,
      explanation: hasContent(explanation) ? explanation : undefined,
    });
  };

  return (
    <div className="rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex items-center justify-between border-b border-app-border px-4 py-2 dark:border-white/10">
        <div className="flex min-w-0 items-center gap-3">
          {questionNumber != null && (
            <span className="flex h-7 min-w-[1.75rem] flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[12px] font-bold tabular-nums text-primary">
              {questionNumber}
            </span>
          )}
          <span className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/50">{mcq ? t.quizEditMcqBadge : t.quizEditQaBadge}</span>
          <SaveStatusBadge
            status={
              saveStatus === 'syncing'
                ? 'syncing'
                : persisted || saveStatus === 'saved'
                  ? 'saved'
                  : 'none'
            }
            title={saveStatus === 'syncing' ? t.cloudSaving : t.cloudSavedMain}
            size="xs"
          />
        </div>
        <button
          onClick={() => setMcq((v) => !v)}
          className={'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ' +
            (mcq ? 'border-primary/40 bg-primary/10 text-primary' : 'border-app-border text-app-text-secondary hover:bg-app-bg dark:border-white/10')}
        >
          ☑ {t.quizMcq}
        </button>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 p-4 md:grid-cols-2 md:items-stretch">
        {/* Avoid overflow-hidden: it creates a sticky scrollport so the formatting
            toolbar cannot stick while the quiz page scrolls. Round corners on
            first/last children instead. */}
        <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-app-border dark:border-white/10 [&>:last-child]:rounded-b-[0.75rem] [&_[data-note-fmt-toolbar]]:rounded-t-[0.75rem]">
          <AppRichTextEditor
            html={question}
            onChange={(v) => { latestQuestionRef.current = v; onChangeQ(v); }}
            onLiveChange={(v) => { latestQuestionRef.current = v; onChangeQ(v); }}
            flushRef={questionFlushRef}
            placeholder={`${t.quizQuestionLabel}...`}
            minHeight="140px"
          />
          {hasAi && !mcq && (
            <div className="shrink-0 border-t border-app-border bg-app-bg/40 px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.02]">
              <div className="h-7" aria-hidden="true" />
            </div>
          )}
        </div>
        {mcq ? (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">{t.quizOptionsLabel} · <span className="text-emerald-500">{t.quizCorrect} ● {correctSet.size > 1 ? `(${correctSet.size})` : ''}</span></p>
            <div className="flex flex-col gap-2 rounded-xl border border-app-border p-2.5 dark:border-white/10">
              {options.map((o, i) => (
                <div key={i} className={'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all ' + (correctSet.has(i) ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-app-border dark:border-white/10')}>
                  <button
                    type="button"
                    onClick={() => toggleCorrect(i)}
                    title={t.quizCorrect}
                    className={'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all ' + (correctSet.has(i) ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-app-border text-transparent hover:border-emerald-400 dark:border-white/20')}
                  >✓</button>
                  <span className="flex-shrink-0 text-[12px] font-bold text-app-text-secondary/60">{OPT_LETTERS[i]}</span>
                  <input
                    value={o}
                    dir="auto"
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`${t.quizOptionPh} ${OPT_LETTERS[i]}`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-app-text outline-none dark:text-gray-100"
                  />
                  {options.length > 2 && (
                    <button type="button" onClick={() => removeOption(i)} className="flex-shrink-0 text-app-text-secondary/40 hover:text-red-500" title="✕">✕</button>
                  )}
                </div>
              ))}
              {options.length < OPT_LETTERS.length && (
                <button type="button" onClick={addOption} className="mt-0.5 rounded-lg border border-dashed border-app-border py-1.5 text-[12px] font-medium text-app-text-secondary/70 transition-all hover:border-primary hover:text-primary dark:border-white/10">
                  + {t.quizAddOption}
                </button>
              )}
            </div>
            <div className="mt-3 rounded-xl border border-app-border dark:border-white/10 [&>:last-child]:rounded-b-[0.75rem]">
              <p className="rounded-t-[0.75rem] border-b border-app-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60 dark:border-white/10">{t.quizExplanationOptional}</p>
              <AppRichTextEditor
                html={explanation}
                onChange={setExplanation}
                onLiveChange={setExplanation}
                placeholder={t.quizExplanationPh}
                minHeight="100px"
              />
            </div>
          </div>
        ) : (
        <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-app-border dark:border-white/10 [&>:last-child]:rounded-b-[0.75rem] [&_[data-note-fmt-toolbar]]:rounded-t-[0.75rem]">
          <AppRichTextEditor
            html={answer}
            onChange={(v) => { latestAnswerRef.current = v; onChangeA(v); }}
            onLiveChange={(v) => { latestAnswerRef.current = v; onChangeA(v); }}
            flushRef={answerFlushRef}
            placeholder={`${t.quizAnswerLabel}...`}
            minHeight="140px"
          />
          {hasAi && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-app-border bg-app-bg/40 px-2 py-1.5 dark:border-white/10 dark:bg-white/[0.02]">
              <AiAnswerStyleToggle value={aiAnswerStyle} onChange={setAiAnswerStyle} />
              <button
                type="button"
                onClick={handleAiAnswer}
                disabled={aiLoading || !question.replace(/<[^>]*>/g, '').trim()}
                className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
              >
                {aiLoading ? <span className="animate-spin">⏳</span> : '🧠'} {t.quizAiAnswer}
              </button>
            </div>
          )}
          {aiSuggestion !== null && (
            <div className="mt-2 overflow-hidden rounded-xl border border-violet-300 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="flex items-center justify-between border-b border-violet-200 px-3 py-1.5 dark:border-violet-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">🧠 {t.quizAiSuggestion}</span>
                <button onClick={() => setAiSuggestion(null)} className="text-[12px] text-violet-500/70 hover:text-violet-700">✕</button>
              </div>
              <div dir="auto" className="note-content px-3 py-2 text-[13px] leading-relaxed text-app-text [overflow-wrap:anywhere] dark:text-gray-200" dangerouslySetInnerHTML={{ __html: aiSuggestion }} />
              <div className="flex justify-end gap-2 border-t border-violet-200 px-3 py-2 dark:border-violet-500/20">
                <button onClick={() => setAiSuggestion(null)} className="rounded-lg border border-app-border px-3 py-1 text-[11px] text-app-text-secondary hover:bg-white/50 dark:border-white/10">{t.quizKeepCurrent}</button>
                <button onClick={() => { onChangeA(aiSuggestion); setAiSuggestion(null); }} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700">↔ {t.quizReplaceAnswer}</button>
              </div>
            </div>
          )}
        </div>
        )}
        <div className="flex justify-end gap-2 md:col-span-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text-secondary hover:bg-app-border/40">{t.setpassCancel}</button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleSave();
            }}
            className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
          >
            {t.mSave}
          </button>
        </div>
      </div>
    </div>
  );
}

function getSetColors(t: ReturnType<typeof useLanguage>['t']) {
  return getQuizSetColorOptions(t.quizColorDefault);
}

export function QuizPage({
  focusItemId = null,
  onFocusHandled,
}: {
  focusItemId?: number | null;
  onFocusHandled?: () => void;
}) {
  const { t } = useLanguage();
  const setColors = useMemo(() => getSetColors(t), [t]);
  const { show } = useToast();
  const { quizzes, quizSets: allQuizSets, quizFolders: allQuizFolders, quizLocalReady, quizContentReady, addQuiz, deleteQuiz, updateQuiz, permDeleteQuiz, addQuizSet, deleteQuizSet, renameQuizSet, reorderQuizSets, setQuizSetColor, setQuizSetFolder, addQuizFolder, renameQuizFolder, reorderQuizFolders, setQuizFolderColor, deleteQuizFolder, addItemToSet, removeItemFromSet, updateItemInSet, setItemsOrderInSet, addQuizSection, updateQuizSection, deleteQuizSection, setQuizzesOrder, hydrateQuizSet } = useNotes();
  const quizFolders = allQuizFolders.filter((folder) => !folder.trashed && !!folder?.id && typeof folder.name === 'string');
  // Coerce Firebase object-shaped items[] before any render path touches .map/.filter.
  const quizSets = useMemo(() => {
    const trashedFolders = new Set(allQuizFolders.filter((folder) => folder.trashed).map((folder) => folder.id));
    return allQuizSets
      .filter((set) => !set.trashed && !(set.folderId && trashedFolders.has(set.folderId)))
      .map(withCoercedQuizSetItems);
  }, [allQuizSets, allQuizFolders]);
  const trashedFolderIds = useMemo(
    () => new Set(allQuizFolders.filter((folder) => folder.trashed).map((folder) => folder.id)),
    [allQuizFolders],
  );
  const savedSelection = useMemo(() => loadQuizSelection(), []);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(() => savedSelection.setId);
  const selectedSetIdRef = useRef<string | null>(selectedSetId);
  selectedSetIdRef.current = selectedSetId;
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => savedSelection.folderId);
  const selectedFolderIdRef = useRef<string | null>(selectedFolderId);
  selectedFolderIdRef.current = selectedFolderId;
  const [sectionDraftBeforeId, setSectionDraftBeforeId] = useState<number | null>(null);
  useEffect(() => {
    setSectionDraftBeforeId(null);
  }, [selectedSetId]);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = () => setIsNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const dragSetId = useRef<string | null>(null);
  const dragFolderId = useRef<string | null>(null);
  const [dragOverSetId, setDragOverSetId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverFolderSortId, setDragOverFolderSortId] = useState<string | null>(null);
  // Favorites are persisted as copies inside the system "Favoriter" set.
  // favs = the set of ORIGINAL item ids that have a copy there.
  const favItemsRaw = allQuizSets.find((s) => s.id === FAVORITES_SET_ID)?.items;
  const favItems: QuizItem[] = Array.isArray(favItemsRaw)
    ? favItemsRaw
    : favItemsRaw && typeof favItemsRaw === 'object'
      ? Object.values(favItemsRaw as Record<string, QuizItem>).filter(Boolean)
      : [];
  const liveFavItems = useMemo(() => favItems.filter((i) => !i.trashed), [favItems]);
  const favs = useMemo(
    () => new Set(liveFavItems.map((i) => i.favOf).filter((x): x is number => x != null)),
    [liveFavItems],
  );
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [allProgress, setAllProgress] = useState<Record<string, Record<number, 'known' | 'learning'>>>(loadProgress);

  // Study mode
  const [studyMode, setStudyMode] = useState<'flashcard' | null>(null);
  // Optional filtered deck chosen from inside study mode (🎯 Välj)
  const [studyDeck, setStudyDeck] = useState<QuizItem[] | null>(null);
  // Hide answers (self-test): blur all Svar, click a card to reveal it
  const [hideAnswers, setHideAnswers] = useState(false);
  // Per-question hide (local preference map by item id — does not sync/wipe Q&A)
  const [hiddenAnswers, setHiddenAnswers] = useState<Record<number, true>>(loadHiddenAnswers);
  const toggleHideAnswer = (id: number) => {
    setHiddenAnswers((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      saveHiddenAnswers(next);
      return next;
    });
  };
  // Question list ordering: manual / oldest-first / studied vs not studied
  const [itemSort, setItemSort] = useState<ItemSort>(() => loadItemSort(false));
  const [itemSortMenuOpen, setItemSortMenuOpen] = useState(false);
  const changeItemSort = (mode: ItemSort) => {
    setItemSort(mode);
    const key = selectedSetId ? 'malacadhati_quiz_itemsort_set' : 'malacadhati_quiz_itemsort_notes';
    safeLocalStorageSet(key, mode);
    setItemSortMenuOpen(false);
  };
  // Multiple open question forms (new drafts + in-progress edits).
  // Stashed per set/notes scope (module + sessionStorage) so set switches AND
  // leaving /quiz for Favourites etc. restore in-progress editors — without
  // mid-typing cloud draft create (itemId stays null until Save).
  const [openForms, setOpenForms] = useState<OpenQuestionForm[]>([]);
  const openFormsRef = useRef(openForms);
  openFormsRef.current = openForms;
  const formsByScopeRef = useRef<Record<string, OpenQuestionForm[]>>(
    cloneOpenFormsMap(readDurableFormsByScope()),
  );
  const activeFormsScopeRef = useRef<string | null>(null);
  const quizzesRef = useRef(quizzes);
  quizzesRef.current = quizzes;
  const allQuizSetsRef = useRef(allQuizSets);
  allQuizSetsRef.current = allQuizSets;
  const autoSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const livePushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const currentFormsScopeKey = formsScopeKey(selectedSetId, selectedFolderId);

  const putScopeForms = (
    key: string,
    forms: OpenQuestionForm[],
    opts?: { immediate?: boolean },
  ) => {
    const scoped = cloneOpenForms(forms.filter((f) => f.scopeKey === key));
    if (scoped.length) formsByScopeRef.current[key] = scoped;
    else delete formsByScopeRef.current[key];
    persistDurableFormsByScope({ ...formsByScopeRef.current }, opts);
  };

  const stashActiveFormsScope = (opts?: { immediate?: boolean }) => {
    const key = activeFormsScopeRef.current;
    if (key == null) return;
    putScopeForms(
      key,
      openFormsRef.current.filter((f) => f.scopeKey === key),
      opts,
    );
  };

  const buildCloudDraftForms = (scopeKey: string, setId: string | null): OpenQuestionForm[] => {
    const items = setId
      ? coerceQuizItems(allQuizSetsRef.current.find((s) => s.id === setId)?.items)
      : quizzesRef.current.filter((q) => !q.trashed);
    return items
      .filter((item) => item.draft)
      .map((item) => ({
        formId: `item-${item.id}`,
        scopeKey,
        itemId: item.id as number | null,
        question: item.question ?? '',
        answer: item.answer ?? '',
        saveStatus: 'saved' as const,
        options: item.options,
        correctIndexes: item.correctIndexes,
        explanation: item.explanation,
        mcq: !!(item.options && item.options.length),
      }));
  };

  /** Swap open forms onto a set/notes scope. Call in the same tick as selection changes. */
  const switchFormsScope = (nextSetId: string | null, nextFolderId: string | null) => {
    const nextKey = formsScopeKey(nextSetId, nextFolderId);
    const prevKey = activeFormsScopeRef.current;

    stashActiveFormsScope({ immediate: true });

    autoSaveTimers.current.forEach((timer) => clearTimeout(timer));
    autoSaveTimers.current.clear();

    if (nextKey == null) {
      activeFormsScopeRef.current = null;
      openFormsRef.current = [];
      setOpenForms([]);
      return;
    }

    if (prevKey === nextKey) {
      const filtered = openFormsRef.current.filter((f) => f.scopeKey === nextKey);
      if (filtered.length !== openFormsRef.current.length) {
        openFormsRef.current = filtered;
        setOpenForms(filtered);
      }
      return;
    }

    activeFormsScopeRef.current = nextKey;
    // Prefer durable stash (session/module) over the in-component ref after remount.
    const fromDurable = readDurableFormsByScope()[nextKey];
    if (fromDurable) {
      formsByScopeRef.current[nextKey] = cloneOpenForms(fromDurable);
    }
    const stashed = cloneOpenForms(formsByScopeRef.current[nextKey] ?? [])
      .filter((f) => f.scopeKey === nextKey)
      .map((f) => ({ ...f, scopeKey: nextKey }));
    const stashedItemIds = new Set(
      stashed.map((f) => f.itemId).filter((id): id is number => id != null),
    );
    const merged = [
      ...stashed,
      ...buildCloudDraftForms(nextKey, nextSetId).filter(
        (f) => f.itemId != null && !stashedItemIds.has(f.itemId),
      ),
    ];
    putScopeForms(nextKey, merged, { immediate: true });
    openFormsRef.current = merged;
    setOpenForms(merged);
  };

  const selectQuizSet = (setId: string | null) => {
    // Sync before paint/click so "+ Add" on the new set is never blocked by a
    // stale activeFormsScopeRef from an unsaved draft on the previous set.
    switchFormsScope(setId, selectedFolderIdRef.current);
    setSelectedSetId(setId);
  };

  const selectQuizFolder = (folderId: string | null, setId: string | null) => {
    switchFormsScope(setId, folderId);
    setSelectedFolderId(folderId);
    setSelectedSetId(setId);
  };

  const scrollToQuizItem = (itemId: number) => {
    let cancelled = false;
    let attempts = 0;
    let retryTimer = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(`quiz-item-${itemId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary/50');
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-primary/50');
        }, 1600);
        return;
      }
      attempts += 1;
      if (attempts < 24) retryTimer = window.setTimeout(tryScroll, 50);
    };

    const scrollTimer = window.setTimeout(tryScroll, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(scrollTimer);
      window.clearTimeout(retryTimer);
    };
  };

  const openQuestionSource = (sourceItemId: number) => {
    const orphan = quizzes.find((q) => q.id === sourceItemId && !q.trashed);
    if (orphan) {
      selectQuizFolder(null, null);
    } else {
      for (const set of allQuizSets) {
        if (set.trashed) continue;
        if (coerceQuizItems(set.items).some((i) => i.id === sourceItemId && !i.trashed)) {
          selectQuizFolder(set.folderId ?? null, set.id);
          break;
        }
      }
    }
    scrollToQuizItem(sourceItemId);
  };

  const updateForm = (formId: string, patch: Partial<Omit<OpenQuestionForm, 'formId' | 'scopeKey'>>) => {
    setOpenForms((prev) => {
      const active = activeFormsScopeRef.current;
      const next = prev.map((f) => {
        if (f.formId !== formId) return f;
        // Late RichTextEditor/onChange after a set switch must not mutate the new set.
        if (active != null && f.scopeKey !== active) return f;
        return { ...f, ...patch };
      });
      openFormsRef.current = next;
      if (active != null) {
        putScopeForms(active, next.filter((f) => f.scopeKey === active));
      }
      return next;
    });
  };

  /** Push question/answer to quizItemsById within ~50ms so the other device
   *  sees typing in the same card without waiting for Save. */
  const scheduleLiveCloudPush = (formId: string) => {
    const existing = livePushTimers.current.get(formId);
    if (existing) clearTimeout(existing);
    livePushTimers.current.set(
      formId,
      setTimeout(() => {
        livePushTimers.current.delete(formId);
        const form = openFormsRef.current.find((f) => f.formId === formId);
        if (!form || form.itemId == null) return;
        const patch = {
          question: form.question,
          answer: form.answer,
          draft: form.finalized ? false : true,
        };
        const setId = selectedSetIdRef.current;
        updateForm(formId, { saveStatus: 'syncing' });
        if (setId) updateItemInSet(setId, form.itemId, patch, false);
        else updateQuiz(form.itemId, patch, false);
        window.setTimeout(() => {
          const still = openFormsRef.current.find((f) => f.formId === formId);
          if (still && still.saveStatus === 'syncing') updateForm(formId, { saveStatus: 'saved' });
        }, 200);
      }, 50),
    );
  };

  const updateFormContent = (formId: string, patch: Pick<OpenQuestionForm, 'question'> | Pick<OpenQuestionForm, 'answer'> | Pick<OpenQuestionForm, 'question' | 'answer'>) => {
    const existing = openFormsRef.current.find((f) => f.formId === formId);
    if (!existing) return;
    // Ignore late editor events from a form that belongs to another set.
    if (existing.scopeKey !== activeFormsScopeRef.current) return;

    setOpenForms((prev) => {
      const active = activeFormsScopeRef.current;
      const next = prev.map((f) => {
        if (f.formId !== formId) return f;
        if (active != null && f.scopeKey !== active) return f;
        const updated = { ...f, ...patch };
        if (f.itemId !== null) return updated;
        const complete = hasContent(updated.question) && hasContent(updated.answer);
        if (!complete) return { ...updated, saveStatus: 'empty' as const };
        return updated;
      });
      openFormsRef.current = next;
      if (active != null) {
        putScopeForms(active, next.filter((f) => f.scopeKey === active));
      }
      return next;
    });
    // Live push on the same tick as typing — do not wait for the 120ms autosave effect.
    if (existing.itemId != null) {
      openFormsRef.current = openFormsRef.current.map((f) => (
        f.formId === formId ? { ...f, ...patch } : f
      ));
      scheduleLiveCloudPush(formId);
    }
  };

  const closeForm = (formId: string) => {
    const timer = autoSaveTimers.current.get(formId);
    if (timer) clearTimeout(timer);
    autoSaveTimers.current.delete(formId);
    const live = livePushTimers.current.get(formId);
    if (live) clearTimeout(live);
    livePushTimers.current.delete(formId);
    setOpenForms((prev) => {
      const next = prev.filter((f) => f.formId !== formId);
      openFormsRef.current = next;
      const active = activeFormsScopeRef.current;
      if (active != null) {
        // Save/Cancel must drop the draft from durable stash immediately.
        putScopeForms(active, next.filter((f) => f.scopeKey === active), { immediate: true });
      }
      return next;
    });
  };

  const persistForm = (formId: string, override?: SavePayload, finalize = false): number | null => {
    const form = openFormsRef.current.find((f) => f.formId === formId);
    if (!form) return null;
    const q = override?.question ?? form.question;
    const a = override?.answer ?? form.answer;
    const patch = {
      question: q,
      answer: a,
      options: override?.options,
      correctIndex: override?.correctIndexes?.[0],
      correctIndexes: override?.correctIndexes,
      explanation: override?.explanation,
      // Never demote an already-saved question back to a draft on autosave.
      draft: finalize ? false : (form.finalized ? false : true),
    };

    const setId = selectedSetIdRef.current;

    if (form.itemId === null) {
      if (!hasContent(q) && !hasContent(a)) return null;
      if (setId) {
        if (!finalize) return null;
        const id = addItemToSet(setId, {
          noteId: 0,
          noteTitle: '',
          question: q,
          answer: a,
          date: new Date().toLocaleDateString(),
          createdAt: new Date().toISOString(),
          draft: false,
          options: patch.options,
          correctIndex: patch.correctIndex,
          correctIndexes: patch.correctIndexes,
          explanation: patch.explanation,
        });
        updateForm(formId, { itemId: id, question: q, answer: a, saveStatus: 'saved', finalized: true });
        return id;
      }
      const id = addQuiz({
        noteId: 0,
        noteTitle: '',
        question: q,
        answer: a,
        date: new Date().toLocaleDateString(),
        createdAt: new Date().toISOString(),
        draft: !finalize,
        options: patch.options,
        correctIndex: patch.correctIndex,
        correctIndexes: patch.correctIndexes,
        explanation: patch.explanation,
      });
      updateForm(formId, { itemId: id, saveStatus: 'saved', finalized: finalize || undefined });
      if (!finalize) return id;
      updateQuiz(id, { ...patch, draft: false }, true);
      return id;
    }

    const storedItem = setId
      ? coerceQuizItems(allQuizSetsRef.current.find((s) => s.id === setId)?.items).find((i) => i.id === form.itemId)
      : quizzesRef.current.find((item) => item.id === form.itemId);
    if (storedItem && !quizPatchChangesContent(storedItem, patch)) {
      if (form.saveStatus !== 'saved') updateForm(formId, { saveStatus: 'saved' });
      return form.itemId;
    }

    updateForm(formId, { saveStatus: 'syncing' });
    // Live typing: durable quizItemsById only (forceCloud=false). Finalize/save
    // still pushes the full quizSets array for compatibility.
    if (setId) updateItemInSet(setId, form.itemId, patch, finalize);
    else updateQuiz(form.itemId, patch, finalize);
    window.setTimeout(() => {
      updateForm(formId, { question: q, answer: a, saveStatus: 'saved' });
    }, 350);
    return form.itemId;
  };

  const flushAllOpenForms = () => {
    for (const form of openFormsRef.current) {
      if (form.itemId === null) continue;
      const complete = hasContent(form.question) && hasContent(form.answer);
      flushForm(form.formId, undefined, !!form.finalized || complete);
    }
  };

  const flushForm = (formId: string, override?: SavePayload, finalize = false) => {
    const timer = autoSaveTimers.current.get(formId);
    if (timer) {
      clearTimeout(timer);
      autoSaveTimers.current.delete(formId);
    }
    persistForm(formId, override, finalize);
  };

  const addNewForm = (initial?: Partial<Pick<OpenQuestionForm, 'itemId' | 'question' | 'answer'>>) => {
    const setId = selectedSetIdRef.current;
    const folderId = selectedFolderIdRef.current;
    const scopeKey = formsScopeKey(setId, folderId);
    if (!scopeKey) return;
    // Selection can update before active scope (or after a stash race). Align
    // first — never refuse "+ Add" because another set still owns activeFormsScopeRef.
    if (scopeKey !== activeFormsScopeRef.current) {
      switchFormsScope(setId, folderId);
    }
    if (scopeKey !== activeFormsScopeRef.current) return;

    const appendScopedForm = (form: OpenQuestionForm) => {
      setOpenForms((prev) => {
        const scoped = prev.filter((f) => f.scopeKey === scopeKey);
        const next = [...scoped, form];
        openFormsRef.current = next;
        putScopeForms(scopeKey, next, { immediate: true });
        return next;
      });
    };

    if (initial?.itemId) {
      if (openFormsRef.current.some((f) => f.itemId === initial.itemId && f.scopeKey === scopeKey)) return;
      appendScopedForm({
        formId: `item-${initial.itemId}`,
        scopeKey,
        itemId: initial.itemId!,
        question: initial.question ?? '',
        answer: initial.answer ?? '',
        saveStatus: 'saved',
        finalized: true,
      });
      return;
    }

    const item = {
      noteId: 0,
      noteTitle: '',
      question: '',
      answer: '',
      date: new Date().toLocaleDateString(),
      createdAt: new Date().toISOString(),
      draft: true,
    };
    if (setId) {
      appendScopedForm({
        formId: `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        scopeKey,
        itemId: null,
        question: '',
        answer: '',
        saveStatus: 'empty',
      });
      return;
    }
    const id = addQuiz(item);
    appendScopedForm({
      formId: `item-${id}`,
      scopeKey,
      itemId: id,
      question: '',
      answer: '',
      saveStatus: 'saved',
    });
  };

  const handleSaveForm = (formId: string, override?: SavePayload) => {
    flushForm(formId, override, true);
    closeForm(formId);
  };

  const handleCancelForm = (formId: string) => {
    const form = openFormsRef.current.find((f) => f.formId === formId);
    if (!form) return;
    const bothEmpty = !hasContent(form.question) && !hasContent(form.answer);
    if (form.itemId && (!form.finalized || bothEmpty)) {
      if (selectedSetId) removeItemFromSet(selectedSetId, form.itemId);
      else permDeleteQuiz(form.itemId);
    }
    const timer = autoSaveTimers.current.get(formId);
    if (timer) clearTimeout(timer);
    autoSaveTimers.current.delete(formId);
    closeForm(formId);
  };

  const handleAddQuestionClick = () => {
    addNewForm();
  };

  const formSaveSigs = useMemo(
    () => openForms.map((f) => `${f.formId}:${f.question}:${f.answer}`).join('|'),
    [openForms],
  );

  useEffect(() => {
    openForms.forEach((form) => {
      if (form.itemId === null) return;
      const existing = autoSaveTimers.current.get(form.formId);
      if (existing) clearTimeout(existing);
      autoSaveTimers.current.set(
        form.formId,
        setTimeout(() => {
          persistForm(form.formId);
        }, 120),
      );
    });
  }, [formSaveSigs, selectedSetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const persistOpenDraftsLocally = () => {
      // Keep unfinished new questions (itemId null) in session/module stash —
      // never soft-create them in the cloud on nav-away.
      stashActiveFormsScope({ immediate: true });
    };
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return;
      persistOpenDraftsLocally();
      flushAllOpenForms();
    };
    const onPageHide = () => {
      persistOpenDraftsLocally();
      flushAllOpenForms();
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onHide);
      persistOpenDraftsLocally();
      flushAllOpenForms();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizContentReady || focusItemId == null) return;

    const orphan = quizzes.find((q) => q.id === focusItemId && !q.trashed);
    if (orphan) {
      selectQuizFolder(null, null);
    } else {
      let foundSet: QuizSet | undefined;
      for (const set of allQuizSets) {
        if (set.trashed) continue;
        if (coerceQuizItems(set.items).some((i) => i.id === focusItemId && !i.trashed)) {
          foundSet = set;
          break;
        }
      }
      if (foundSet) {
        selectQuizFolder(foundSet.folderId ?? null, foundSet.id);
      }
    }

    let cancelled = false;
    let attempts = 0;
    let retryTimer = 0;

    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(`quiz-item-${focusItemId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary/50');
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-primary/50');
        }, 1600);
        onFocusHandled?.();
        return;
      }
      attempts += 1;
      if (attempts < 24) {
        retryTimer = window.setTimeout(tryScroll, 50);
      } else {
        onFocusHandled?.();
      }
    };

    const scrollTimer = window.setTimeout(tryScroll, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(scrollTimer);
      window.clearTimeout(retryTimer);
    };
  }, [focusItemId, quizContentReady, allQuizSets, quizzes, onFocusHandled]);

  useEffect(() => {
    saveQuizSelection(selectedFolderId, selectedSetId);
  }, [selectedFolderId, selectedSetId]);

  useEffect(() => {
    setItemSort(loadItemSort(!!selectedSetId));
  }, [selectedSetId]);

  useEffect(() => {
    if (!quizLocalReady) return;
    if (selectedSetId && !allQuizSets.some((set) => set.id === selectedSetId && !set.trashed)) {
      selectQuizSet(null);
      return;
    }
    // On narrow phones, keep folder→sets browsing; don't auto-jump into a set
    // (that used to collapse the nav and hide the rest of Prover's sets).
    if (isNarrow) return;
    if (selectedFolderId && !selectedSetId) {
      const folderSets = allQuizSets.filter(
        (set) => !set.trashed && set.folderId === selectedFolderId,
      );
      if (folderSets.length > 0) selectQuizSet(folderSets[0].id);
    }
  }, [quizLocalReady, selectedFolderId, selectedSetId, allQuizSets, isNarrow]);

  const isNotesViewRef = useRef(false);
  // Before paint: stash leaving set's drafts and load only the selected set's forms.
  // useLayoutEffect avoids a painted frame where Schimke's draft appears under Infliximab.
  useLayoutEffect(() => {
    if (!quizLocalReady) return;
    isNotesViewRef.current = !selectedFolderId && !selectedSetId;
    switchFormsScope(selectedSetId, selectedFolderId);
  }, [selectedSetId, selectedFolderId, quizLocalReady]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!quizLocalReady) return;
    const scopeKey = formsScopeKey(selectedSetId, selectedFolderId);
    if (!scopeKey || scopeKey !== activeFormsScopeRef.current) return;
    if (!selectedSetId && !isNotesViewRef.current) return;
    const drafts = buildCloudDraftForms(scopeKey, selectedSetId);
    setOpenForms((prev) => {
      const openIds = new Set(prev.map((f) => f.itemId));
      const additions = drafts.filter((d) => d.itemId != null && !openIds.has(d.itemId));
      if (!additions.length) return prev;
      const next = [...prev, ...additions];
      openFormsRef.current = next;
      putScopeForms(scopeKey, next, { immediate: true });
      return next;
    });
  }, [allQuizSets, quizzes, selectedSetId, selectedFolderId, quizLocalReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rename set — place controls whether the input shows in the sidebar list or the header.
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renameSetPlace, setRenameSetPlace] = useState<'sidebar' | 'header' | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const startRenameSet = (set: QuizSet, place: 'sidebar' | 'header') => {
    setRenameVal(set.name);
    setRenamingSetId(set.id);
    setRenameSetPlace(place);
  };
  const stopRenameSet = () => {
    setRenamingSetId(null);
    setRenameSetPlace(null);
  };

  // Folders (OneNote-style notebooks)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameVal, setFolderRenameVal] = useState('');
  const folderRenameValRef = useRef('');
  folderRenameValRef.current = folderRenameVal;
  const renamingFolderIdRef = useRef<string | null>(null);
  const folderRenameClosingRef = useRef(false);
  const folderRenameInputRef = useRef<HTMLInputElement | null>(null);
  const finishFolderRenameRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Keep ref in sync from state only — never overwrite an intentional close
    // mid-commit (parent setQuizFolders can re-render before setState(null)).
    if (folderRenameClosingRef.current) {
      if (renamingFolderId != null) setRenamingFolderId(null);
      renamingFolderIdRef.current = null;
      return;
    }
    renamingFolderIdRef.current = renamingFolderId;
  }, [renamingFolderId]);
  const [folderCtxMenu, setFolderCtxMenu] = useState<{ folderId: string; x: number; y: number; flip?: boolean } | null>(null);
  const [folderColorPicker, setFolderColorPicker] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<{ id: string; name: string } | null>(null);
  const [moveMenuForSet, setMoveMenuForSet] = useState<string | null>(null);
  const [nameAlert, setNameAlert] = useState<'set' | 'folder' | null>(null);

  // Show/hide the sets sidebar
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => localStorage.getItem('malacadhati_quiz_sidebar') !== 'closed');
  const [pdfExporting, setPdfExporting] = useState(false);
  const toggleSidebar = () => setSidebarOpen((v) => {
    const n = !v;
    safeLocalStorageSet('malacadhati_quiz_sidebar', n ? 'open' : 'closed');
    return n;
  });
  // Resizable width of the folders column
  const [folderColW, setFolderColW] = useState<number>(() => Number(localStorage.getItem('malacadhati_quiz_foldercol')) || 84);
  const startFolderResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = folderColW;
    let lastW = startW;
    const onMove = (ev: MouseEvent) => {
      lastW = Math.min(220, Math.max(56, startW + ev.clientX - startX));
      setFolderColW(lastW);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      safeLocalStorageSet('malacadhati_quiz_foldercol', String(lastW));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Sort the sets list
  type ListSortMode = 'manual' | 'name' | 'count' | 'newest' | 'oldest';
  const [setSort, setSetSort] = useState<ListSortMode>(() => {
    const saved = localStorage.getItem('malacadhati_quiz_setsort');
    return saved === 'name' || saved === 'count' || saved === 'newest' || saved === 'oldest' || saved === 'manual'
      ? saved
      : 'manual';
  });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const changeSort = (mode: ListSortMode) => {
    setSetSort(mode);
    safeLocalStorageSet('malacadhati_quiz_setsort', mode);
    setSortMenuOpen(false);
  };

  const [folderSort, setFolderSort] = useState<ListSortMode>(() => {
    const saved = localStorage.getItem('malacadhati_quiz_foldersort');
    return saved === 'name' || saved === 'count' || saved === 'newest' || saved === 'oldest' || saved === 'manual'
      ? saved
      : 'manual';
  });
  const [folderSortMenuOpen, setFolderSortMenuOpen] = useState(false);
  const changeFolderSort = (mode: ListSortMode) => {
    setFolderSort(mode);
    safeLocalStorageSet('malacadhati_quiz_foldersort', mode);
    setFolderSortMenuOpen(false);
  };

  const toggleFav = (item: QuizItem) => {
    // Inside the Favorites set: the card itself is the copy — remove it.
    if (item.favOf != null) { removeItemFromSet(FAVORITES_SET_ID, item.id); return; }
    const existing = liveFavItems.find((i) => i.favOf === item.id);
    if (existing) {
      removeItemFromSet(FAVORITES_SET_ID, existing.id);
    } else {
      addItemToSet(FAVORITES_SET_ID, {
        noteId: item.noteId, noteTitle: item.noteTitle, question: item.question, answer: item.answer,
        date: item.date, options: item.options, correctIndex: item.correctIndex,
        correctIndexes: item.correctIndexes, explanation: item.explanation, favOf: item.id,
      });
    }
  };

  const handleSpeak = (id: number) => {
    const item = selectedSet
      ? coerceQuizItems(selectedSet.items).find((i) => i.id === id)
      : quizzes.find((q) => q.id === id);
    if (!item) return;
    if (speakingId === id) { window.speechSynthesis.cancel(); setSpeakingId(null); return; }
    window.speechSynthesis.cancel();
    setSpeakingId(id);
    const q = (item.question || '').replace(/<[^>]*>/g, '');
    const a = (item.answer || '').replace(/<[^>]*>/g, '');
    const u = new SpeechSynthesisUtterance(`${q}. ${a}`);
    u.lang = navigator.language || 'sv-SE';
    u.onend = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
  };

  const startEdit = (item: QuizItem) => {
    if (openFormsRef.current.some((f) => f.itemId === item.id)) return;
    const question = item.question || '';
    const stem = item.options && item.options.length
      ? question.replace(/<div style="margin-top:6px">[\s\S]*$/, '')
      : question;
    addNewForm({ itemId: item.id, question: stem, answer: item.answer || '' });
  };

  const handleQuickCreateSet = () => {
    let num = quizSets.length + 1;
    while (allQuizSets.some((set) => normalizeQuizName(set.name) === normalizeQuizName(`Nameless ${num}`))) num += 1;
    // Single-shot create with folderId; awaits ById so hard refresh cannot lose it.
    void addQuizSet(`Nameless ${num}`, selectedFolderId || undefined).then((s) => {
      selectQuizSet(s.id);
    });
  };

  const commitSetName = (set: QuizSet) => {
    const name = renameVal.trim().replace(/\s+/g, ' ') || set.name;
    const duplicate = allQuizSets.some((item) => item.id !== set.id && normalizeQuizName(item.name) === normalizeQuizName(name));
    if (duplicate) {
      setNameAlert('set');
      return;
    }
    renameQuizSet(set.id, name);
    stopRenameSet();
  };

  const stopFolderRename = () => {
    folderRenameClosingRef.current = true;
    renamingFolderIdRef.current = null;
    setRenamingFolderId(null);
    setFolderRenameVal('');
  };

  const beginFolderRename = (folderId: string, name: string) => {
    folderRenameClosingRef.current = false;
    renamingFolderIdRef.current = folderId;
    setRenamingFolderId(folderId);
    setFolderRenameVal(name);
  };

  const commitFolderName = (folderId: string, fallbackName: string) => {
    if (folderRenameClosingRef.current) return;
    if (renamingFolderIdRef.current !== folderId) return;
    const name = String(folderRenameValRef.current ?? '').trim().replace(/\s+/g, ' ') || fallbackName;
    const duplicate = quizFolders.some((folder) => (
      folder.id !== folderId
      && !folder.system
      && typeof folder.name === 'string'
      && normalizeQuizName(folder.name) === normalizeQuizName(name)
    ));
    // Close the editor first so a cloud/parent re-render cannot leave the
    // input stuck open after Enter (save already happened / will happen).
    stopFolderRename();
    if (duplicate) {
      setNameAlert('folder');
      return;
    }
    if (name) renameQuizFolder(folderId, name);
  };

  finishFolderRenameRef.current = () => {
    const folderId = renamingFolderIdRef.current;
    if (!folderId || folderRenameClosingRef.current) return;
    const fallback = quizFolders.find((folder) => folder.id === folderId)?.name
      || folderRenameValRef.current
      || t.quizNewFolder;
    commitFolderName(folderId, fallback);
  };

  useEffect(() => {
    if (!renamingFolderId) return;
    const input = folderRenameInputRef.current;
    input?.focus();
    input?.select();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Element && target.closest('[data-quiz-folder-rename]')) return;
      finishFolderRenameRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [renamingFolderId]);

  const createFolder = () => {
    const base = t.quizNewFolder;
    let name = base;
    let suffix = 2;
    while (allQuizFolders.some((folder) => normalizeQuizName(folder.name) === normalizeQuizName(name))) {
      name = `${base} ${suffix}`;
      suffix += 1;
    }
    const folder = addQuizFolder(name);
    selectQuizFolder(folder.id, null);
    requestAnimationFrame(() => {
      beginFolderRename(folder.id, name);
    });
  };

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ setId: string; x: number; y: number; flip?: boolean } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [confirmDeleteSet, setConfirmDeleteSet] = useState<{ id: string; name: string } | null>(null);

  const openCtxMenu = (e: React.MouseEvent, setId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const flipY = e.clientY > window.innerHeight * 0.6;
    setCtxMenu({ setId, x: e.clientX, y: flipY ? window.innerHeight - e.clientY : e.clientY, flip: flipY });
    setShowColorPicker(false);
    setMoveMenuForSet(null);
  };

  const closeCtxMenu = () => { setCtxMenu(null); setShowColorPicker(false); setMoveMenuForSet(null); };

  const progressKey = selectedSetId ?? 'all';
  const currentProgress = allProgress[progressKey] ?? {};
  const knownCount = Object.values(currentProgress).filter((v) => v === 'known').length;

  const handleSaveProgress = (p: Record<number, 'known' | 'learning'>) => {
    const next = { ...allProgress, [progressKey]: p };
    setAllProgress(next);
    saveProgress(next);
  };

  // Manually mark a single question as studied/known or send it back to "needs study"
  const setItemStatus = (id: number, status: 'known' | 'learning' | null) => {
    const p = { ...currentProgress };
    if (status) p[id] = status; else delete p[id];
    handleSaveProgress(p);
  };

  const isNotesView = !selectedFolderId && !selectedSetId;
  const isFolderEmptyView = !!selectedFolderId && !selectedSetId;
  const selectedFolder = selectedFolderId ? allQuizFolders.find((f) => f.id === selectedFolderId) : undefined;
  const selectedSet: QuizSet | undefined = selectedSetId ? quizSets.find((s) => s.id === selectedSetId) : undefined;
  const displayItems: QuizItem[] = selectedSet
    ? visibleQuizItems(selectedSet.items).map((item) => ({
        ...item,
        question: typeof item.question === 'string' ? item.question : item.question == null ? '' : String(item.question),
        answer: typeof item.answer === 'string' ? item.answer : item.answer == null ? '' : String(item.answer),
        explanation: typeof item.explanation === 'string' || item.explanation == null
          ? item.explanation
          : String(item.explanation),
      }))
    : isNotesView ? quizzes : [];
  const expectedSetCount = selectedSet ? countQuizSetQuestions(selectedSet) : 0;
  const setBodiesLoading = !!selectedSet
    && expectedSetCount > 0
    && displayItems.length < expectedSetCount;
  const setLoadPct = expectedSetCount > 0
    ? Math.min(100, Math.round((displayItems.length / expectedSetCount) * 100))
    : 100;

  useEffect(() => {
    if (!selectedSetId || !setBodiesLoading) return;
    void hydrateQuizSet(selectedSetId);
  }, [selectedSetId, setBodiesLoading, expectedSetCount, displayItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedItems = useMemo(() => {
    if (itemSort === 'manual') return displayItems;
    if (itemSort === 'newest' || itemSort === 'oldest') {
      const dir = itemSort === 'newest' ? -1 : 1;
      return [...displayItems].sort((a, b) => dir * (quizItemCreatedAtMs(a) - quizItemCreatedAtMs(b)));
    }
    return [...displayItems].sort((a, b) => {
      const aStudied = currentProgress[a.id] === 'known' ? 1 : 0;
      const bStudied = currentProgress[b.id] === 'known' ? 1 : 0;
      if (aStudied !== bStudied) return aStudied - bStudied;
      return selectedSetId
        ? quizItemCreatedAtMs(a) - quizItemCreatedAtMs(b)
        : quizItemCreatedAtMs(b) - quizItemCreatedAtMs(a);
    });
  }, [displayItems, itemSort, currentProgress, selectedSetId]);

  const listRows = useMemo(
    () => (selectedSetId
      ? buildQuizListRows(orderedItems, selectedSet?.sections ?? [])
      : orderedItems.map((item, index) => ({ type: 'item' as const, item, questionNumber: index + 1 }))),
    [selectedSetId, orderedItems, selectedSet?.sections],
  );

  const scrollToLastQuestion = () => {
    const last = orderedItems[orderedItems.length - 1];
    if (!last) return;
    scrollToQuizItem(last.id);
  };

  const studyItems = useMemo(() => orderedItems.filter((item) => !item.draft), [orderedItems]);

  const canReorder = orderedItems.length > 1 && (!!selectedSetId || isNotesView);

  const applyItemOrder = (ids: number[]) => {
    if (itemSort !== 'manual') changeItemSort('manual');
    if (selectedSetId) setItemsOrderInSet(selectedSetId, ids);
    else setQuizzesOrder(ids);
  };

  const handleMoveToPosition = (itemId: number, targetPosition: number) => {
    const list = [...orderedItems];
    const fromIdx = list.findIndex((i) => i.id === itemId);
    const toIdx = targetPosition - 1;
    if (fromIdx < 0 || toIdx < 0 || toIdx >= list.length || fromIdx === toIdx) return;
    // Insert-and-shift (not swap): remove from current index, insert at target.
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    applyItemOrder(list.map((i) => i.id));
  };

  const renderItem = (item: QuizItem, visualIndex: number) => {
    const questionNumber = visualIndex + 1;
    const sourceItemId = selectedSetId === FAVORITES_SET_ID ? item.favOf ?? null : null;
    const source = sourceItemId
      ? findQuizItemSource(sourceItemId, allQuizSets, allQuizFolders, quizzes)
      : null;
    const sourceLocation = source && (source.folderName || source.setName)
      ? {
          folderName: source.folderName,
          setName: source.setName ?? (source.fromNotes ? t.searchCategoryQuiz : null),
          setId: source.setId,
          fromNotes: source.fromNotes,
        }
      : null;
    return (
      <QuizItemRow
        key={`${item.id}-${item.updatedAt || ''}-${(item.question || '').length}-${(item.answer || '').length}`}
        item={item}
        onEdit={startEdit}
        onDelete={() => deleteQuiz(item.id, selectedSetId)}
        speakingId={speakingId}
        onSpeak={handleSpeak}
        favs={favs}
        onToggleFav={toggleFav}
        progressMap={currentProgress}
        hideAnswers={hideAnswers}
        answerHidden={!!hiddenAnswers[item.id]}
        onToggleHideAnswer={toggleHideAnswer}
        onSetStatus={setItemStatus}
        sets={quizSets.filter((s) => s.id !== selectedSetId && !!s.folderId && !s.system)}
        folders={quizFolders}
        onMoveToSet={(setId, keepCopy) => {
          // Strip identity/meta so the destination gets a fresh item.
          const { id, favOf, draft, trashed, deletedAt, ...rest } = item;
          addItemToSet(setId, { ...rest });
          if (keepCopy) return;
          if (selectedSetId) removeItemFromSet(selectedSetId, item.id);
          else deleteQuiz(item.id);
        }}
        canReorder={canReorder}
        questionNumber={questionNumber}
        totalQuestions={orderedItems.length}
        onMoveToPosition={(targetPosition) => handleMoveToPosition(item.id, targetPosition)}
        sourceLocation={sourceLocation}
        onOpenSource={sourceItemId ? () => openQuestionSource(sourceItemId) : undefined}
        onAddRubrik={selectedSetId ? () => setSectionDraftBeforeId(item.id) : undefined}
      />
    );
  };

  const renderItemOrForm = (item: QuizItem, visualIndex: number) => {
    const form = openForms.find(
      (f) => f.itemId === item.id && (!currentFormsScopeKey || f.scopeKey === currentFormsScopeKey),
    );
    if (form) return renderOpenForm(form, visualIndex, visualIndex + 1);
    return renderItem(item, visualIndex);
  };

  const renderOpenForm = (form: OpenQuestionForm, formIndex = 0, questionNumber?: number) => {
    if (currentFormsScopeKey && form.scopeKey !== currentFormsScopeKey) return null;
    const item = form.itemId
      ? (displayItems.find((i) => i.id === form.itemId)
        ?? coerceQuizItems(selectedSet?.items).find((i) => i.id === form.itemId))
      : undefined;
    const showNumber = questionNumber ?? (selectedSetId && form.itemId === null ? orderedItems.length + formIndex + 1 : null);
    return (
      <div
        key={`${form.scopeKey}-${form.formId}`}
        id={form.itemId != null ? `quiz-item-${form.itemId}` : undefined}
      >
      <EditPanel
        question={form.question}
        answer={form.answer}
        saveStatus={form.saveStatus}
        persisted={form.itemId !== null}
        questionNumber={showNumber}
        initialMcq={form.mcq}
        initialOptions={form.options ?? item?.options}
        initialCorrect={item?.correctIndex}
        initialCorrects={form.correctIndexes ?? item?.correctIndexes}
        initialExplanation={form.explanation ?? item?.explanation}
        onChangeQ={(v) => updateFormContent(form.formId, { question: v })}
        onChangeA={(v) => updateFormContent(form.formId, { answer: v })}
        onSave={(override) => handleSaveForm(form.formId, override)}
        onCancel={() => handleCancelForm(form.formId)}
        onLocalMetaChange={(meta) => {
          if (form.scopeKey !== activeFormsScopeRef.current) return;
          openFormsRef.current = openFormsRef.current.map((f) => (
            f.formId === form.formId && f.scopeKey === form.scopeKey ? { ...f, ...meta } : f
          ));
          putScopeForms(
            form.scopeKey,
            openFormsRef.current.filter((f) => f.scopeKey === form.scopeKey),
          );
          updateForm(form.formId, meta);
        }}
      />
      </div>
    );
  };

  const sortedSets = setSort === 'manual'
    ? quizSets
    : [...quizSets].sort((a, b) => {
        if (setSort === 'name') {
          return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
        }
        if (setSort === 'count') {
          return countQuizSetQuestions(b) - countQuizSetQuestions(a);
        }
        const aTime = Date.parse(a.createdAt || '') || 0;
        const bTime = Date.parse(b.createdAt || '') || 0;
        return setSort === 'newest' ? bTime - aTime : aTime - bTime;
      });

  const countQuestionsInFolder = (folderId: string) => (
    quizSets
      .filter((s) => s.folderId === folderId && !s.system)
      .reduce((sum, s) => sum + countQuizSetQuestions(s), 0)
  );

  const systemFolders = quizFolders.filter((f) => f.system);
  const userFolders = quizFolders.filter((f) => !f.system);
  const sortedUserFolders = folderSort === 'manual'
    ? userFolders
    : [...userFolders].sort((a, b) => {
        if (folderSort === 'name') {
          return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
        }
        if (folderSort === 'count') {
          return countQuestionsInFolder(b.id) - countQuestionsInFolder(a.id);
        }
        const aTime = Date.parse(a.createdAt || '') || 0;
        const bTime = Date.parse(b.createdAt || '') || 0;
        return folderSort === 'newest' ? bTime - aTime : aTime - bTime;
      });
  const sortedFolders = [...systemFolders, ...sortedUserFolders];

  const progressForSet = (setId: string | null) => {
    const key = setId ?? 'all';
    const prog = allProgress[key] ?? {};
    const items = setId
      ? visibleQuizItems(quizSets.find((s) => s.id === setId)?.items)
      : quizzes;
    const known = items.filter((i) => prog[i.id] === 'known').length;
    return { known, total: items.length };
  };

  // Group sorted sets by folder. A set whose folder was deleted falls back to ungrouped.
  const folderIds = new Set(quizFolders.map((f) => f.id));
  const ungroupedSets = sortedSets.filter((s) => !s.folderId || !folderIds.has(s.folderId));
  const setsInFolder = (fid: string) => sortedSets.filter((s) => s.folderId === fid);
  const userSetsInFolder = (fid: string) => setsInFolder(fid).filter((s) => !s.system);

  const selectFolder = (folderId: string) => {
    const folderSets = setsInFolder(folderId);
    selectQuizFolder(folderId, folderSets[0]?.id ?? null);
  };

  // Sets shown in the right panel depending on which folder is selected
  const currentSets = selectedFolderId ? setsInFolder(selectedFolderId) : ungroupedSets;

  const renderSetRow = (s: QuizSet) => {
    const { known, total } = progressForSet(s.id);
    const setAccent = s.color || '#9ca3af';
    const isSelected = selectedSetId === s.id;
    const isEditing = renamingSetId === s.id && renameSetPlace === 'sidebar';
    const questionCount = countQuizSetQuestions(s);
    return (
      <div key={s.id} className="group/st relative">
        {isEditing ? (
          <div
            className="relative mx-1.5 my-0.5 rounded-lg bg-gray-100/90 py-2 pl-3 pr-2 dark:bg-white/10"
            style={{ boxShadow: `inset 4px 0 0 0 ${setAccent}` }}
          >
            <input
              data-quiz-rename-input="1"
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitSetName(s);
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  stopRenameSet();
                }
              }}
              onBlur={() => commitSetName(s)}
              ref={(el) => {
                if (!el || el.dataset.focusedOnce === '1') return;
                el.dataset.focusedOnce = '1';
                requestAnimationFrame(() => {
                  el.focus();
                  el.select();
                });
              }}
              className="w-full rounded-md border-2 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-app-text shadow-sm outline-none dark:bg-gray-900 dark:text-gray-100"
              style={{ borderColor: setAccent }}
              aria-label={t.quizRename}
            />
          </div>
        ) : (
          <div
            draggable={!s.system}
            onDragStart={(e) => {
              if (s.system) return;
              dragSetId.current = s.id;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', s.id);
            }}
            onDragOver={(e) => {
              if (!dragSetId.current) return;
              e.preventDefault();
              setDragOverSetId(s.id);
            }}
            onDragLeave={() => setDragOverSetId(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragSetId.current && dragSetId.current !== s.id) {
                reorderQuizSets(dragSetId.current, s.id);
                if (setSort !== 'manual') changeSort('manual');
              }
              dragSetId.current = null;
              setDragOverSetId(null);
            }}
            onDragEnd={() => {
              dragSetId.current = null;
              setDragOverSetId(null);
              setDragOverFolderId(null);
              setDragOverFolderSortId(null);
            }}
            className={'relative mx-1 my-0.5 w-[calc(100%-0.5rem)] rounded-lg py-2.5 pl-3 pr-1 text-left transition-all ' +
              (dragOverSetId === s.id && dragSetId.current
                ? 'bg-primary/10 ring-2 ring-inset ring-primary/70 dark:bg-primary/20'
                : isSelected
                  ? 'bg-gray-200 ring-2 ring-inset ring-gray-300 shadow-sm dark:bg-white/20 dark:ring-white/25'
                  : 'hover:bg-white dark:hover:bg-white/5')}
            style={isSelected ? { boxShadow: `inset 4px 0 0 0 ${setAccent}` } : undefined}
          >
            {!isSelected && (
              <span className="absolute inset-y-1 left-0 w-1 rounded-r-sm" style={{ backgroundColor: setAccent }} />
            )}
            {!s.system && (
              <span className="absolute right-1 bottom-1 select-none text-[12px] text-app-text-secondary/20 opacity-0 transition-opacity group-hover/st:opacity-100">⠿</span>
            )}
            <button
              type="button"
              onClick={() => selectQuizSet(s.id)}
              onDoubleClick={(e) => {
                if (s.system) return;
                e.preventDefault();
                e.stopPropagation();
                startRenameSet(s, 'sidebar');
              }}
              onContextMenu={(e) => { if (!s.system) openCtxMenu(e, s.id); }}
              className="block w-full text-left"
            >
              <AutoFitText
                text={s.name || ''}
                maxSize={11}
                minSize={7}
                className={'block w-full font-semibold ' + (isSelected ? 'text-app-text dark:text-gray-100' : 'text-app-text dark:text-gray-200')}
              />
              <span className="block text-[9px] text-app-text-secondary/50">{questionCount}</span>
            </button>
            {!s.system && (
              <button
                type="button"
                onClick={(e) => openCtxMenu(e, s.id)}
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none text-app-text-secondary/40 opacity-0 transition-opacity hover:bg-app-border group-hover/st:opacity-100"
                title={t.quizOptions}
              >···</button>
            )}
            {total > 0 && known > 0 && (
              <div className="mt-1 flex items-center gap-2 pr-2 pl-0.5">
                <div className="h-1 flex-1 rounded-full bg-app-border dark:bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(known / total) * 100}%` }} />
                </div>
                <span className="text-[9px] font-semibold text-emerald-500">{known}/{total}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Collapsed: thin strip with a reopen button */}
      {!sidebarOpen && !(isNarrow && selectedSetId) && (
        <div className="flex flex-shrink-0 flex-col items-center border-r border-app-border bg-app-bg px-1.5 pt-3 dark:border-white/10 dark:bg-gray-950">
          <button
            onClick={toggleSidebar}
            title={t.quizShowSidebar}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
          >
            ☰
          </button>
        </div>
      )}

      {/* Sidebar — two-column: Folders | Sets. On narrow + set open, hide so questions get full width. */}
      {sidebarOpen && !(isNarrow && selectedSetId) && (
      <div
        className={'flex flex-shrink-0 flex-col border-r border-app-border bg-app-bg dark:border-white/10 dark:bg-gray-950 ' + (isNarrow ? 'w-full min-w-0' : '')}
        style={isNarrow ? undefined : { width: isNotesView ? folderColW : folderColW + 184 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60 dark:text-gray-500">{t.quizTitle}</p>
          <button
            onClick={toggleSidebar}
            title={t.quizHideSidebar}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-app-text-secondary/60 transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
          >«</button>
        </div>

        {/* Questions from Notes — full-width special row */}
        <button
          onClick={() => { selectQuizFolder(null, null); }}
          className={'mx-2 mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all ' +
            (isNotesView ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'text-app-text hover:bg-white dark:text-gray-300 dark:hover:bg-white/5')}
        >
          <span>🧠</span>
          <span className="flex-1 truncate">{t.quizQuestionsFromNotes}</span>
          <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{quizLocalReady ? quizzes.length : '…'}</span>
        </button>

        {/* Two-column area */}
        <div className="flex flex-1 overflow-hidden border-t border-app-border dark:border-white/10">

          {/* Left column: Folders */}
          <div className="flex flex-shrink-0 flex-col" style={{ width: folderColW }}>
            <div className="relative flex items-center justify-between px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-app-text-secondary/50 dark:text-gray-600">{t.quizFoldersLabel}</p>
              <button
                type="button"
                onClick={() => setFolderSortMenuOpen((v) => !v)}
                className="flex h-5 items-center gap-1 rounded-md px-1 text-[9px] font-semibold text-app-text-secondary/60 transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
              >⇅ {
                folderSort === 'name' ? t.quizSortAz
                  : folderSort === 'count' ? t.quizSortHash
                    : folderSort === 'newest' ? t.quizSortNewestShort
                      : folderSort === 'oldest' ? t.quizSortOldestShort
                        : t.quizSortManualShort
              }</button>
              {folderSortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setFolderSortMenuOpen(false)} />
                  <div className="absolute right-1 top-7 z-50 w-44 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800">
                    {([
                      { key: 'manual' as const, label: t.quizSortManual },
                      { key: 'name' as const, label: t.quizSortName },
                      { key: 'count' as const, label: t.quizSortCount },
                      { key: 'newest' as const, label: t.quizSortNewest },
                      { key: 'oldest' as const, label: t.quizSortOldest },
                    ]).map((o) => (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => changeFolderSort(o.key)}
                        className={'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-app-bg dark:hover:bg-white/5 ' +
                          (folderSort === o.key ? 'font-bold text-primary' : 'text-app-text dark:text-gray-200')}
                      >{o.label}{folderSort === o.key && ' ✓'}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {sortedFolders.length === 0 && (
                <p className="px-2 py-4 text-center text-[10px] italic leading-relaxed text-app-text-secondary/40">{t.quizNoFolders}</p>
              )}
              {sortedFolders.map((f) => {
                const folderAccent = f.color || '#9ca3af';
                const isSelected = selectedFolderId === f.id;
                const isEditing = renamingFolderId === f.id;
                return (
                <div key={f.id} className="group/fl relative">
                  {isEditing ? (
                    <form
                      data-quiz-folder-rename="1"
                      className="relative mx-1.5 my-0.5 rounded-lg bg-gray-100/90 py-2 pl-3 pr-2 dark:bg-white/10"
                      style={{ boxShadow: `inset 4px 0 0 0 ${folderAccent}` }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        commitFolderName(f.id, f.name);
                      }}
                    >
                      <input
                        ref={folderRenameInputRef}
                        data-quiz-folder-rename-input="1"
                        value={folderRenameVal}
                        onChange={(e) => setFolderRenameVal(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            stopFolderRename();
                          }
                        }}
                        onBlur={() => commitFolderName(f.id, f.name)}
                        className="w-full rounded-md border-2 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-app-text shadow-sm outline-none dark:bg-gray-900 dark:text-gray-100"
                        style={{ borderColor: folderAccent }}
                        aria-label={t.quizRename}
                      />
                    </form>
                  ) : (
                    <button
                      draggable={!f.system && !isEditing}
                      onDragStart={(e) => {
                        if (f.system) return;
                        dragFolderId.current = f.id;
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('application/x-quiz-folder', f.id);
                      }}
                      onClick={() => selectFolder(f.id)}
                      onDoubleClick={(e) => {
                        if (f.system) return;
                        e.preventDefault();
                        e.stopPropagation();
                        beginFolderRename(f.id, f.name);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!f.system) {
                          setFolderCtxMenu({ folderId: f.id, x: e.clientX, y: e.clientY > window.innerHeight * 0.6 ? window.innerHeight - e.clientY : e.clientY, flip: e.clientY > window.innerHeight * 0.6 });
                          setFolderColorPicker(false);
                        }
                      }}
                      onDragOver={(e) => {
                        const folderId = dragFolderId.current || e.dataTransfer.getData('application/x-quiz-folder');
                        if (folderId) {
                          if (f.system) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'move';
                          setDragOverFolderSortId(f.id);
                          return;
                        }
                        if (!dragSetId.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        setDragOverFolderId(f.id);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setDragOverFolderId(null);
                          setDragOverFolderSortId(null);
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const folderId = dragFolderId.current || e.dataTransfer.getData('application/x-quiz-folder');
                        if (folderId && folderId !== f.id && sortedFolders.some((row) => row.id === folderId)) {
                          if (folderSort !== 'manual') changeFolderSort('manual');
                          reorderQuizFolders(folderId, f.id);
                          dragFolderId.current = null;
                          setDragOverFolderSortId(null);
                          return;
                        }
                        const setId = dragSetId.current || e.dataTransfer.getData('text/plain');
                        if (setId) {
                          setQuizSetFolder(setId, f.id);
                          if (setSort !== 'manual') changeSort('manual');
                          selectFolder(f.id);
                        }
                        dragSetId.current = null;
                        setDragOverSetId(null);
                        setDragOverFolderId(null);
                        setDragOverFolderSortId(null);
                      }}
                      onDragEnd={() => { dragFolderId.current = null; setDragOverFolderSortId(null); }}
                      className={'relative mx-1 my-0.5 w-[calc(100%-0.5rem)] rounded-lg py-2.5 pl-3 pr-1 text-left transition-all ' +
                        (dragOverFolderSortId === f.id
                          ? 'bg-primary/10 ring-2 ring-inset ring-primary/70 dark:bg-primary/20'
                          : dragOverFolderId === f.id
                            ? 'bg-primary/20 ring-2 ring-inset ring-primary dark:bg-primary/30'
                            : isSelected
                              ? 'bg-gray-200 ring-2 ring-inset ring-gray-300 shadow-sm dark:bg-white/20 dark:ring-white/25'
                              : 'hover:bg-white dark:hover:bg-white/5')}
                      style={isSelected ? { boxShadow: `inset 4px 0 0 0 ${folderAccent}` } : undefined}
                    >
                      {!isSelected && (
                        <span className="absolute inset-y-1 left-0 w-1 rounded-r-sm" style={{ backgroundColor: folderAccent }} />
                      )}
                      {!f.system && (
                        <span className="absolute right-1 bottom-1 select-none text-[12px] text-app-text-secondary/20 opacity-0 transition-opacity group-hover/fl:opacity-100">⠿</span>
                      )}
                      <AutoFitText
                        text={f.system === 'favorites' ? `⭐ ${t.quizFavorites}` : f.system ? `🔒 ${t.quizRestored}` : f.name}
                        maxSize={11}
                        minSize={7}
                        className={'block w-full font-semibold ' + (isSelected ? 'text-app-text dark:text-gray-100' : 'text-app-text dark:text-gray-200')}
                      />
                      <span className="block text-[9px] text-app-text-secondary/50">{t.quizSetsCount.replace('{n}', String(userSetsInFolder(f.id).length))}</span>
                      {!f.system && (
                        <span
                          onClick={(e) => { e.stopPropagation(); setFolderCtxMenu({ folderId: f.id, x: e.clientX, y: e.clientY > window.innerHeight * 0.6 ? window.innerHeight - e.clientY : e.clientY, flip: e.clientY > window.innerHeight * 0.6 }); setFolderColorPicker(false); }}
                          className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none text-app-text-secondary/40 opacity-0 transition-opacity hover:bg-app-border group-hover/fl:opacity-100"
                        >···</span>
                      )}
                    </button>
                  )}
                </div>
                );
              })}
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={createFolder}
              className="flex w-full flex-shrink-0 items-center justify-center gap-1 border-t border-app-border py-2.5 text-[11px] font-semibold text-primary transition-all hover:bg-primary/5 dark:border-white/10 dark:hover:bg-primary/10"
            >
              <span className="text-base leading-none">+</span> {t.quizFolder}
            </button>
          </div>

          {/* Drag handle to resize folders column */}
          {!isNotesView && (
          <div
            onMouseDown={startFolderResize}
            className="group/handle relative w-1 flex-shrink-0 cursor-col-resize border-r border-app-border bg-transparent transition-colors hover:bg-primary/30 dark:border-white/10"
            title={t.quizResizeFoldersHint}
          >
            <span className="absolute inset-y-0 -left-1 -right-1" />
          </div>
          )}

          {/* Right column: Sets — only when a folder is selected */}
          {!isNotesView && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Sort control */}
            <div className="relative flex items-center justify-between px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-app-text-secondary/50 dark:text-gray-600">{t.quizSetsLabel}</p>
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                className="flex h-5 items-center gap-1 rounded-md px-1 text-[9px] font-semibold text-app-text-secondary/60 transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
              >⇅ {
                setSort === 'name' ? t.quizSortAz
                  : setSort === 'count' ? t.quizSortHash
                    : setSort === 'newest' ? t.quizSortNewestShort
                      : setSort === 'oldest' ? t.quizSortOldestShort
                        : t.quizSortManualShort
              }</button>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                  <div className="absolute right-1 top-7 z-50 w-44 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800">
                    {([
                      { key: 'manual' as const, label: t.quizSortManual },
                      { key: 'name' as const, label: t.quizSortName },
                      { key: 'count' as const, label: t.quizSortCount },
                      { key: 'newest' as const, label: t.quizSortNewest },
                      { key: 'oldest' as const, label: t.quizSortOldest },
                    ]).map((o) => (
                      <button
                        key={o.key}
                        onClick={() => changeSort(o.key)}
                        className={'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-app-bg dark:hover:bg-white/5 ' +
                          (setSort === o.key ? 'font-bold text-primary' : 'text-app-text dark:text-gray-200')}
                      >{o.label}{setSort === o.key && ' ✓'}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* Sets list — paint local immediately; no cloud-fetch placeholder */}
            <div className="flex-1 overflow-y-auto px-1">
              {currentSets.length === 0 ? (
                <p className="py-4 text-center text-[11px] italic text-app-text-secondary/40">
                  {selectedFolderId ? t.quizFolderEmpty : t.quizNoUngroupedSets}
                </p>
              ) : (
                currentSets.map((s) => renderSetRow(s))
              )}
            </div>
            <button
              onClick={handleQuickCreateSet}
              className="flex w-full flex-shrink-0 items-center justify-center gap-1 border-t border-app-border py-2.5 text-[11px] font-semibold text-primary transition-all hover:bg-primary/5 dark:border-white/10 dark:hover:bg-primary/10"
            >
              <span className="text-base leading-none">+</span> {t.quizAddSet}
            </button>
          </div>
          )}
        </div>
      </div>
      )}

      {/* Main content — last-good complete cache boots quizContentReady instantly
          (correct bodies, zero wait). Spinner only on first install before any
          last-good exists. On narrow folder browse (no set yet), hide main. */}
      {!(isNarrow && sidebarOpen && selectedFolderId && !selectedSetId && !isNotesView) && (
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          {!quizContentReady ? (
            <div className="flex min-h-[16rem] flex-col items-center justify-center py-24">
              <FilesLoadingIndicator text={t.quizLoadingQuestions} />
            </div>
          ) : (
          <>
          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            {isNarrow && selectedSetId && renameSetPlace !== 'header' && (
              <button
                type="button"
                onClick={() => selectQuizSet(null)}
                className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-primary hover:bg-primary/10"
              >
                ← {t.quizSetsLabel}
              </button>
            )}
            {selectedSet && renamingSetId === selectedSet.id && renameSetPlace === 'header' ? (
              <div className="flex w-full min-w-0 basis-full items-center gap-2">
                {isNarrow && (
                  <button
                    type="button"
                    onClick={() => selectQuizSet(null)}
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-primary hover:bg-primary/10"
                  >
                    ←
                  </button>
                )}
                <span aria-hidden className="shrink-0 text-[11px]">📂</span>
                <input
                  data-quiz-rename-input="1"
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitSetName(selectedSet);
                    }
                      if (e.key === 'Escape') {
                            e.preventDefault();
                            stopRenameSet();
                          }
                  }}
                  onBlur={() => commitSetName(selectedSet)}
                  ref={(el) => {
                    if (!el || el.dataset.focusedOnce === '1') return;
                    el.dataset.focusedOnce = '1';
                    requestAnimationFrame(() => {
                      el.focus();
                      el.setSelectionRange(0, el.value.length);
                      el.scrollLeft = 0;
                    });
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-primary/50 bg-white px-3 py-1.5 text-[14px] font-semibold normal-case tracking-normal text-app-text outline-none ring-2 ring-primary/20 dark:border-primary/50 dark:bg-gray-900 dark:text-gray-100"
                  aria-label={t.quizRename}
                />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitSetName(selectedSet)}
                  className="shrink-0 rounded-md px-2 py-1.5 text-[14px] font-bold text-primary"
                  title={t.quizRename}
                >✓</button>
                <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold normal-case tracking-normal text-app-text-secondary/70 dark:text-gray-500">
                  <span>
                    — {setBodiesLoading ? expectedSetCount : displayItems.length}{' '}
                    {(setBodiesLoading ? expectedSetCount : displayItems.length) === 1
                      ? t.quizQuestionOne
                      : t.quizQuestionMany}
                  </span>
                  {orderedItems.length > 1 && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={scrollToLastQuestion}
                      title={t.quizScrollToLast}
                      aria-label={t.quizScrollToLast}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-app-text-secondary/55 transition hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/15"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M12 5v14" />
                        <path d="m19 12-7 7-7-7" />
                      </svg>
                    </button>
                  )}
                </span>
              </div>
            ) : (
            <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
              {selectedSet ? (
                <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span aria-hidden>📂</span>
                  <button
                    type="button"
                    disabled={!!selectedSet.system}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (selectedSet.system) return;
                      startRenameSet(selectedSet, 'header');
                    }}
                    title={selectedSet.system ? undefined : t.quizRename}
                    className={'group/rename inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-left text-[13px] font-semibold normal-case tracking-normal transition ' +
                      (selectedSet.system
                        ? 'cursor-default text-app-text dark:text-gray-200'
                        : 'cursor-text text-app-text hover:bg-primary/10 hover:text-primary dark:text-gray-100 dark:hover:bg-primary/15')}
                  >
                    <span className="min-w-0 truncate">{selectedSet.name}</span>
                    {!selectedSet.system && (
                      <span className="shrink-0 text-[11px] opacity-40 transition group-hover/rename:opacity-80" aria-hidden>✏️</span>
                    )}
                  </button>
                  <span className="inline-flex items-center gap-1 font-bold normal-case tracking-normal text-app-text-secondary/70 dark:text-gray-500">
                    <span>
                      — {setBodiesLoading ? expectedSetCount : displayItems.length}{' '}
                      {(setBodiesLoading ? expectedSetCount : displayItems.length) === 1
                        ? t.quizQuestionOne
                        : t.quizQuestionMany}
                    </span>
                    {orderedItems.length > 1 && (
                      <button
                        type="button"
                        onClick={scrollToLastQuestion}
                        title={t.quizScrollToLast}
                        aria-label={t.quizScrollToLast}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-app-text-secondary/55 transition hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/15"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 5v14" />
                          <path d="m19 12-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </span>
                </span>
              ) : isFolderEmptyView
                ? `📁 ${selectedFolder?.system === 'favorites' ? t.quizFavorites : selectedFolder?.system ? t.quizRestored : selectedFolder?.name ?? t.quizFolder} — ${t.quizSetsCount.replace('{n}', String(userSetsInFolder(selectedFolderId ?? '').length))}`
                : (
                  <span className="inline-flex flex-wrap items-center gap-1 normal-case tracking-normal">
                    <span>🧠 {t.quizQuestionsFromNotes} — {displayItems.length} {displayItems.length === 1 ? t.quizQuestionOne : t.quizQuestionMany}</span>
                    {orderedItems.length > 1 && (
                      <button
                        type="button"
                        onClick={scrollToLastQuestion}
                        title={t.quizScrollToLast}
                        aria-label={t.quizScrollToLast}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-app-text-secondary/55 transition hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/15"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 5v14" />
                          <path d="m19 12-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </span>
                )}
              {setBodiesLoading && (
                <span className="ml-2 font-normal normal-case tracking-normal text-primary">
                  · {t.quizLoadingSetProgress
                    .replace('{loaded}', String(displayItems.length))
                    .replace('{total}', String(expectedSetCount))
                    .replace('{pct}', String(setLoadPct))}
                </span>
              )}
              {!isFolderEmptyView && !setBodiesLoading && knownCount > 0 && displayItems.length > 0 && (
                <span className="ml-2 font-normal text-emerald-500">· {knownCount}/{displayItems.length} {t.quizKnownProgress}</span>
              )}
            </span>
            )}
            {!isFolderEmptyView && displayItems.length > 0 && renameSetPlace !== 'header' && (
              <div className="flex items-center gap-1.5">
                {/* Hide/show answers toggle */}
                <button
                  onClick={() => setHideAnswers((v) => !v)}
                  className={'flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors ' + (hideAnswers ? 'border-primary bg-primary text-white' : 'border-app-border bg-app-bg text-app-text-secondary hover:bg-app-border/40 dark:border-white/10 dark:text-gray-400')}
                  title={hideAnswers ? t.quizShowAnswers : t.quizHideAnswers}
                >
                  {hideAnswers ? '👁️ ' : '🙈 '}{hideAnswers ? t.quizShowAnswersShort : t.quizHideAnswersShort}
                </button>
                {/* Sort order */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setItemSortMenuOpen((v) => !v)}
                    className="flex items-center gap-1 rounded-xl border border-app-border bg-app-bg px-2.5 py-1.5 text-[11px] font-semibold text-app-text-secondary transition hover:bg-app-border/40 dark:border-white/10 dark:bg-white/5 dark:text-gray-400"
                    title={t.quizSortQuestions}
                  >
                    ⇅ {(() => {
                      const opt = ITEM_SORT_OPTIONS.find((o) => o.key === itemSort);
                      return opt ? t[opt.shortKey] : t.quizSortManualShort;
                    })()}
                  </button>
                  {itemSortMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setItemSortMenuOpen(false)} />
                      <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800">
                        {ITEM_SORT_OPTIONS.map((o) => (
                          <button
                            key={o.key}
                            type="button"
                            onClick={() => changeItemSort(o.key)}
                            className={'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-app-bg dark:hover:bg-white/5 ' +
                              (itemSort === o.key ? 'font-bold text-primary' : 'text-app-text dark:text-gray-200')}
                          >
                            {t[o.labelKey]}
                            {itemSort === o.key && <span className="ml-auto text-[11px]">✓</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                {/* Study buttons */}
                <button
                  type="button"
                  disabled={pdfExporting || orderedItems.filter((item) => !item.draft).length === 0}
                  onClick={() => {
                    const title = selectedSet?.name ?? t.quizQuestionsFromNotes;
                    const items = orderedItems.filter((item) => !item.draft);
                    setPdfExporting(true);
                    void import('../../lib/exportQuizSetPdf').then(({ exportQuizSetToPdf }) => (
                      exportQuizSetToPdf(title, items, {
                        question: t.quizQuestionLabel,
                        answer: t.quizAnswerLabel,
                        explanation: t.quizExplanationLabel,
                        generatedOn: t.quizPdfGeneratedOn,
                        brandName: t.appName,
                        website: new URL(SITE_URL).host,
                        questionCount: items.length === 1 ? t.quizQuestionOne : t.quizQuestionMany,
                      })
                    )).catch(() => {
                      show(t.filesDownloadFailed);
                    }).finally(() => setPdfExporting(false));
                  }}
                  className="flex items-center gap-1 rounded-xl border border-app-border bg-app-bg px-3 py-1.5 text-[11px] font-semibold text-app-text-secondary transition hover:bg-app-border/40 disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/5 dark:text-gray-400"
                  title={t.quizDownloadPdf}
                >
                  {pdfExporting ? '…' : t.quizDownloadPdf}
                </button>
                <button
                  onClick={() => { setStudyDeck(null); setStudyMode('flashcard'); }}
                  className="flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  {t.quizFlashcards}
                </button>
                <button
                  onClick={handleAddQuestionClick}
                  className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                >
                  + {t.quizAdd}
                </button>
              </div>
            )}
            {!isFolderEmptyView && displayItems.length === 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleAddQuestionClick}
                  className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                >
                  <span className="text-base leading-none">+</span> {t.quizAddQuestion}
                </button>
              </div>
            )}
          </div>


          {isFolderEmptyView ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-app-border bg-white/60 px-6 py-24 text-center dark:border-white/10 dark:bg-white/5">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-2xl font-serif italic text-gray-400 dark:bg-white/10 dark:text-gray-500">
                i
              </div>
              <p className="text-base font-medium text-app-text dark:text-gray-100">
                {t.quizEmptySetMsg}
              </p>
              <p className="mt-1 text-sm text-app-text-secondary dark:text-gray-400">
                {t.quizEmptyFolderMsg}
              </p>
              <button
                onClick={handleQuickCreateSet}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition hover:bg-primary-dark"
              >
                <span className="text-base leading-none">+</span>
                {t.quizAddSet}
              </button>
            </div>
          ) : (
          <>
          {/* Questions list */}
          <div className="flex flex-col gap-2">
            {listRows.map((row) => {
              if (row.type === 'section') {
                return (
                  <QuizSectionHeading
                    key={row.section.id}
                    section={row.section}
                    onSave={(title) => {
                      if (selectedSetId) updateQuizSection(selectedSetId, row.section.id, title);
                    }}
                    onDelete={() => {
                      if (selectedSetId) deleteQuizSection(selectedSetId, row.section.id);
                    }}
                  />
                );
              }
              return (
                <div key={`row-${row.item.id}`}>
                  {sectionDraftBeforeId === row.item.id && selectedSetId && (
                    <div className="mb-2">
                      <QuizSectionDraft
                        onSave={(title) => {
                          addQuizSection(selectedSetId, row.item.id, title);
                          setSectionDraftBeforeId(null);
                        }}
                        onCancel={() => setSectionDraftBeforeId(null)}
                      />
                    </div>
                  )}
                  {renderItemOrForm(row.item, row.questionNumber - 1)}
                </div>
              );
            })}

            {setBodiesLoading && (
              <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-primary/25 bg-primary/5 px-6 py-10 dark:border-primary/30 dark:bg-primary/10">
                <FilesLoadingIndicator
                  text={t.quizLoadingSetProgress
                    .replace('{loaded}', String(displayItems.length))
                    .replace('{total}', String(expectedSetCount))
                    .replace('{pct}', String(setLoadPct))}
                />
                <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-app-border/60 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                    style={{ width: `${setLoadPct}%` }}
                  />
                </div>
              </div>
            )}

            {openForms
              .filter((f) => f.itemId === null && (!currentFormsScopeKey || f.scopeKey === currentFormsScopeKey))
              .map((form, formIndex) => renderOpenForm(form, formIndex))}

            {/* Add question dashed button — opens another form without closing existing ones */}
            <button
              onClick={handleAddQuestionClick}
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl border-2 border-dashed border-app-border text-xl text-app-text-secondary/50 transition-all hover:border-primary hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:hover:border-primary/50 dark:hover:bg-primary/10"
              title={t.quizAddQuestion}
            >
              +
            </button>
          </div>
          </>
          )}
          </>
          )}
        </div>
      </div>
      )}

      {/* Study mode overlay */}
      {studyMode && (studyDeck ?? studyItems).length > 0 && (
        <StudyMode
          title={selectedSet?.name ?? t.quizQuestionsFromNotes}
          items={studyDeck ?? studyItems}
          allItems={studyItems}
          mode={studyMode}
          initialProgress={currentProgress}
          onClose={() => { setStudyMode(null); setStudyDeck(null); }}
          onSaveProgress={handleSaveProgress}
        />
      )}

      {nameAlert && (
        <BrandedAlert
          message={nameAlert === 'folder' ? t.quizDupFolderName : t.quizDupSetName}
          buttonLabel="OK"
          onClose={() => setNameAlert(null)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeCtxMenu} onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }} />
          <div
            className={'fixed z-50 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800 ' + (showColorPicker ? 'w-[220px]' : 'min-w-[160px]')}
            style={ctxMenu.flip ? { bottom: ctxMenu.y, left: ctxMenu.x } : { top: ctxMenu.y, left: ctxMenu.x }}
          >
            <button
              onClick={() => {
                const s = quizSets.find((x) => x.id === ctxMenu.setId);
                if (s) {
                  selectQuizSet(s.id);
                  startRenameSet(s, 'sidebar');
                }
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              {t.quizRename}
            </button>
            <button
              onClick={() => setShowColorPicker((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">{t.quizColor}</span>
              <span className="text-app-text-secondary/50">{showColorPicker ? '▾' : '›'}</span>
            </button>
            {showColorPicker && (
              <QuizColorPickerGrid
                colors={setColors}
                activeValue={quizSets.find((x) => x.id === ctxMenu.setId)?.color ?? ''}
                onPick={(value) => { setQuizSetColor(ctxMenu.setId, value); closeCtxMenu(); }}
              />
            )}
            <button
              onClick={() => setMoveMenuForSet((v) => (v === ctxMenu.setId ? null : ctxMenu.setId))}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">{t.quizMoveToFolder}</span>
              <span className="text-app-text-secondary/50">{moveMenuForSet === ctxMenu.setId ? '▾' : '›'}</span>
            </button>
            {moveMenuForSet === ctxMenu.setId && (
              <div className="max-h-44 overflow-y-auto py-0.5">
                {quizFolders.map((f) => {
                  const active = quizSets.find((x) => x.id === ctxMenu.setId)?.folderId === f.id;
                  const folderLabel = f.system === 'favorites' ? t.quizFavorites : f.system ? t.quizRestored : f.name;
                  return (
                    <button
                      key={f.id}
                      onClick={() => { setQuizSetFolder(ctxMenu.setId, f.id); closeCtxMenu(); }}
                      className={'flex w-full items-center gap-2 px-6 py-1.5 text-[12px] hover:bg-app-bg dark:hover:bg-white/5 ' + (active ? 'font-bold text-primary' : 'text-app-text dark:text-gray-200')}
                    >📒 {folderLabel}{active && ' ✓'}</button>
                  );
                })}
                {quizFolders.length === 0 && <p className="px-6 py-1.5 text-[11px] italic text-app-text-secondary/50">{t.quizNoFoldersYet}</p>}
              </div>
            )}
            <div className="my-1 h-px bg-app-border dark:bg-white/10" />
            <button
              onClick={() => {
                const s = allQuizSets.find((x) => x.id === ctxMenu.setId);
                setConfirmDeleteSet({ id: ctxMenu.setId, name: s?.name ?? '' });
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              {t.quizDeleteSet}
            </button>
          </div>
        </>
      )}

      {/* Folder context menu */}
      {folderCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setFolderCtxMenu(null); setFolderColorPicker(false); }} onContextMenu={(e) => { e.preventDefault(); setFolderCtxMenu(null); }} />
          <div className={'fixed z-50 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800 ' + (folderColorPicker ? 'w-[220px]' : 'min-w-[160px]')} style={folderCtxMenu.flip ? { bottom: folderCtxMenu.y, left: folderCtxMenu.x } : { top: folderCtxMenu.y, left: folderCtxMenu.x }}>
            <button
              onClick={() => { const f = quizFolders.find((x) => x.id === folderCtxMenu.folderId); if (f) beginFolderRename(f.id, f.name); setFolderCtxMenu(null); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >{t.quizRename}</button>
            <button
              onClick={() => setFolderColorPicker((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">{t.quizColor}</span>
              <span className="text-app-text-secondary/50">{folderColorPicker ? '▾' : '›'}</span>
            </button>
            {folderColorPicker && (
              <QuizColorPickerGrid
                colors={setColors}
                activeValue={quizFolders.find((x) => x.id === folderCtxMenu.folderId)?.color ?? ''}
                onPick={(value) => { setQuizFolderColor(folderCtxMenu.folderId, value); setFolderCtxMenu(null); }}
              />
            )}
            <div className="my-1 h-px bg-app-border dark:bg-white/10" />
            <button
              onClick={() => {
                const f = allQuizFolders.find((x) => x.id === folderCtxMenu.folderId);
                setConfirmDeleteFolder({ id: folderCtxMenu.folderId, name: f?.name ?? '' });
                setFolderCtxMenu(null);
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >{t.quizDeleteFolder}</button>
          </div>
        </>
      )}

      {/* Delete folder confirmation — name captured on open so trash filter can't blank it */}
      {confirmDeleteFolder && (
        <ConfirmDialog
          title={t.quizMoveFolderTrash}
          message={t.quizMoveFolderTrashMsg.replace('{name}', confirmDeleteFolder.name)}
          confirmLabel={t.quizMoveToTrash}
          cancelLabel={t.setpassCancel}
          onConfirm={() => {
            const id = confirmDeleteFolder.id;
            setConfirmDeleteFolder(null);
            selectQuizFolder(selectedFolderIdRef.current === id ? null : selectedFolderIdRef.current, null);
            deleteQuizFolder(id);
          }}
          onCancel={() => setConfirmDeleteFolder(null)}
        />
      )}

      {/* Delete set confirmation — name captured on open so trash filter can't blank it */}
      {confirmDeleteSet && (
        <ConfirmDialog
          title={t.quizMoveSetTrash}
          message={t.quizMoveSetTrashMsg.replace('{name}', confirmDeleteSet.name)}
          confirmLabel={t.quizMoveToTrash}
          cancelLabel={t.setpassCancel}
          onConfirm={() => {
            const id = confirmDeleteSet.id;
            setConfirmDeleteSet(null);
            if (selectedSetIdRef.current === id) selectQuizSet(null);
            deleteQuizSet(id);
          }}
          onCancel={() => setConfirmDeleteSet(null)}
        />
      )}
    </div>
  );
}
