import { useState, useRef, useEffect, useMemo } from 'react';
import { useNotes, FAVORITES_SET_ID } from '../../contexts/NotesContext';
import { RichTextEditor } from '../notes/RichTextEditor';
import { answerQuestion } from '../../lib/gemini';
import { StudyMode } from './StudyMode';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { BrandedAlert } from '../common/BrandedAlert';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import type { QuizItem, QuizSet, QuizFolder } from '../../types';

const PROGRESS_KEY = 'malacadhati_quiz_progress';

function loadProgress(): Record<string, Record<number, 'known' | 'learning'>> {
  try { return JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'); } catch { return {}; }
}

function saveProgress(all: Record<string, Record<number, 'known' | 'learning'>>) {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
}

function normalizeQuizName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

// Content is valid if it has visible text OR an embedded image.
function hasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').trim().length > 0;
}

function mdToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function parseImportText(raw: string): { question: string; answer: string }[] {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const pairs: { question: string; answer: string }[] = [];
  // Try tab-separated first
  const tabPairs = lines.map((l) => l.split('\t'));
  if (tabPairs.every((p) => p.length >= 2)) {
    return tabPairs.map(([q, ...rest]) => ({ question: q.trim(), answer: rest.join('\t').trim() })).filter((p) => p.question && p.answer);
  }
  // Try pipe-separated
  const pipePairs = lines.map((l) => l.split('|'));
  if (pipePairs.every((p) => p.length >= 2)) {
    return pipePairs.map(([q, ...rest]) => ({ question: q.trim(), answer: rest.join('|').trim() })).filter((p) => p.question && p.answer);
  }
  // Alternating lines: Q, A, Q, A ...
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] && lines[i + 1]) pairs.push({ question: lines[i], answer: lines[i + 1] });
  }
  return pairs;
}

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
  onMoveToSet?: (setId: string) => void;
  hideAnswers?: boolean;
  onSetStatus?: (id: number, status: 'known' | 'learning' | null) => void;
}

function QuizItemRow({ item, onEdit, onDelete, speakingId, onSpeak, favs, onToggleFav, progressMap, sets, folders, onMoveToSet, hideAnswers, onSetStatus }: QuizItemRowProps) {
  const [moveOpen, setMoveOpen] = useState(false);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // Re-hide a revealed card whenever the global toggle flips
  useEffect(() => { setRevealed(false); }, [hideAnswers]);
  const status = progressMap?.[item.id];
  const masked = !!hideAnswers && !revealed;
  // Mark which cards need more studying: known = done (green), everything else = study more.
  const accent = status === 'known'
    ? 'border-l-4 border-l-emerald-400'
    : status === 'learning'
      ? 'border-l-4 border-l-red-400'
      : 'border-l-4 border-l-amber-400';
  const studyMore = status !== 'known';
  return (
    <div className={'group overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e] ' + accent}>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_44px]">
        <div className="flex min-w-0 flex-col items-start px-5 py-4">
          <span className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase text-app-text-secondary/45">
            Fråga
            {studyMore && (
              <span className={'rounded-full px-2 py-0.5 text-[8px] font-bold normal-case tracking-normal ' + (status === 'learning' ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400')}>
                📚 Plugga mer
              </span>
            )}
          </span>
          {status && (
            <span className={`flex-shrink-0 text-[10px] font-bold ${status === 'known' ? 'text-emerald-500' : 'text-red-400'}`}>
              {status === 'known' ? '✓' : '✗'}
            </span>
          )}
          <span dir="auto" className="block w-full min-w-0 break-words text-center text-[14px] font-semibold leading-relaxed text-app-text [overflow-wrap:anywhere] dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(item.question) }} />
        </div>
        <div className="flex min-w-0 flex-col items-start border-t border-app-border bg-app-bg/55 px-5 py-4 dark:border-white/10 dark:bg-white/[0.035] sm:border-l sm:border-t-0 sm:px-6">
          <span className="mb-2 flex items-center gap-1.5 text-[9px] font-bold uppercase text-primary/70">
            <span className="h-1.5 w-1.5 rounded-full bg-primary/70" /> Svar
          </span>
          <div className="relative w-full min-w-0">
            <span
              dir="auto"
              className={'block w-full min-w-0 break-words text-[14px] leading-[1.7] text-app-text [overflow-wrap:anywhere] transition-all dark:text-gray-100 [&_img]:mx-auto [&_img]:my-3 [&_img]:block [&_img]:h-auto [&_img]:max-h-[280px] [&_img]:max-w-full [&_img]:rounded-xl [&_img]:border [&_img]:border-app-border [&_img]:bg-white [&_img]:object-contain [&_img]:p-1 [&_img]:shadow-sm dark:[&_img]:border-white/10 ' + (masked ? 'select-none blur-sm' : '')}
              dangerouslySetInnerHTML={{ __html: mdToHtml(item.answer) }}
            />
            {masked && (
              <button
                onClick={() => setRevealed(true)}
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-app-bg/40 text-[11px] font-semibold text-app-text-secondary backdrop-blur-[2px] transition hover:text-primary dark:bg-white/[0.02]"
              >
                👁️ Visa
              </button>
            )}
          </div>
          {item.explanation && (
            <div className="mt-3 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600/70 dark:text-amber-400/70">Förklaring</p>
              <p dir="auto" className="text-[13px] leading-relaxed text-amber-900 dark:text-amber-200">{item.explanation}</p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-4 border-t border-app-border px-4 py-2 dark:border-white/10 sm:flex-col sm:justify-center sm:gap-2 sm:border-l sm:border-t-0 sm:px-2">
          {onSetStatus && (
            status === 'known' ? (
              <button
                onClick={() => onSetStatus(item.id, 'learning')}
                className="text-base text-emerald-500 transition-colors hover:text-red-500"
                title="Markera som ej klar (plugga mer)"
              >✅</button>
            ) : (
              <button
                onClick={() => onSetStatus(item.id, 'known')}
                className="text-base text-app-text-secondary/40 transition-colors hover:text-emerald-500"
                title="Markera som studerad (kan)"
              >☑️</button>
            )
          )}
          <button onClick={() => onToggleFav(item)} className={'text-base transition-colors ' + ((favs.has(item.id) || item.favOf != null) ? 'text-amber-400' : 'text-app-text-secondary/40 hover:text-amber-400')} title="Favorit">★</button>
          <button
            onClick={() => onSpeak(item.id)}
            className={'transition-colors ' + (speakingId === item.id ? 'text-primary' : 'text-app-text-secondary/40 hover:text-primary')}
            title={speakingId === item.id ? 'Stoppa' : 'Läs upp'}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
          </button>
          <button onClick={() => onEdit(item)} className="text-[11px] text-app-text-secondary/40 transition-colors hover:text-primary" title="Redigera">✏️</button>
          {onMoveToSet && sets && sets.length > 0 && (
            <>
              <button
                onClick={() => { setMoveOpen(true); setActiveFolderId(null); }}
                title="Flytta till set"
                className="text-[13px] text-app-text-secondary/40 transition-colors hover:text-primary"
              >📂</button>
              {moveOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setMoveOpen(false)}>
                  <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between border-b border-app-border px-4 py-3 dark:border-white/10">
                      <p className="text-[13px] font-semibold text-app-text dark:text-gray-100">Flytta till set</p>
                      <button onClick={() => setMoveOpen(false)} className="text-app-text-secondary/50 hover:text-app-text">✕</button>
                    </div>
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
                              <span className="text-[10px] text-app-text-secondary/40">{fSets.length} set</span>
                              <span className="text-[10px] text-app-text-secondary/30">{open ? '▲' : '▼'}</span>
                            </button>
                            {open && (
                              <div className="border-b border-app-border/40 bg-app-bg/40 dark:border-white/5 dark:bg-white/[0.02]">
                                {fSets.length === 0 ? (
                                  <p className="px-6 py-3 text-[11px] italic text-app-text-secondary/40">Inga set i den här mappen</p>
                                ) : fSets.map((s) => (
                                  <button
                                    key={s.id}
                                    onClick={() => { onMoveToSet(s.id); setMoveOpen(false); }}
                                    className="flex w-full items-center gap-3 border-b border-app-border/20 px-6 py-2.5 text-left transition-colors last:border-b-0 hover:bg-primary/5 dark:border-white/5 dark:hover:bg-primary/10"
                                  >
                                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: s.color ?? '#6C63FF' }} />
                                    <span className="flex-1 truncate text-[13px] text-app-text dark:text-gray-100">{s.name}</span>
                                    <span className="text-[11px] text-app-text-secondary/40">{s.items.length} st</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <button onClick={onDelete} className="text-[13px] text-app-text-secondary/40 transition-all hover:scale-110 hover:text-red-500" title="Ta bort" aria-label="Ta bort">🗑️</button>
        </div>
      </div>
      {/* Footer: timestamps */}
      {(item.createdAt || item.updatedAt) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-t border-app-border/40 bg-app-bg/30 px-5 py-1.5 dark:border-white/5 dark:bg-white/[0.015]">
          <span className="flex items-center gap-1 text-[10px] text-app-text-secondary/35 dark:text-gray-600">
            <span>☁</span> Saved
          </span>
          {item.createdAt && (
            <span className="text-[10px] text-app-text-secondary/35 dark:text-gray-600">
              Skapad: {new Date(item.createdAt).toLocaleString()}
            </span>
          )}
          {item.updatedAt && item.updatedAt !== item.createdAt && (
            <span className="text-[10px] text-app-text-secondary/35 dark:text-gray-600">
              Uppdaterad: {new Date(item.updatedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

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

interface EditPanelProps {
  question: string;
  answer: string;
  initialOptions?: string[];
  initialCorrect?: number;
  initialCorrects?: number[];
  initialExplanation?: string;
  onChangeQ: (v: string) => void;
  onChangeA: (v: string) => void;
  onSave: (override?: SavePayload) => void;
  onCancel: () => void;
}

function EditPanel({ question, answer, initialOptions, initialCorrect, initialCorrects, initialExplanation, onChangeQ, onChangeA, onSave, onCancel }: EditPanelProps) {
  const { lang } = useLanguage();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [mcq, setMcq] = useState<boolean>(!!(initialOptions && initialOptions.length));
  const [options, setOptions] = useState<string[]>(initialOptions && initialOptions.length ? initialOptions : ['', '']);
  const initCorrectSet = initialCorrects?.length
    ? new Set(initialCorrects)
    : initialCorrect !== undefined ? new Set([initialCorrect]) : new Set([0]);
  const [correctSet, setCorrectSet] = useState<Set<number>>(initCorrectSet);
  const [explanation, setExplanation] = useState<string>(initialExplanation ?? '');
  const labels = lang === 'en'
    ? { question: 'Question', answer: 'Answer', aiAnswer: 'AI Answer', aiSuggestion: 'AI suggestion', keep: 'Keep current', replace: 'Replace answer', cancel: 'Cancel', save: 'Save', mcq: 'MCQ', options: 'Options', addOption: 'Add option', correct: 'Correct', optionPh: 'Option' }
    : { question: 'Fråga', answer: 'Svar', aiAnswer: 'AI-svar', aiSuggestion: 'AI-förslag', keep: 'Behåll nuvarande', replace: 'Ersätt svaret', cancel: 'Avbryt', save: 'Spara', mcq: 'Flerval', options: 'Alternativ', addOption: 'Lägg till alternativ', correct: 'Rätt', optionPh: 'Alternativ' };

  const handleAiAnswer = async () => {
    const plain = question.replace(/<[^>]*>/g, '').trim();
    if (!plain) return;
    setAiLoading(true);
    try {
      const res = await answerQuestion(plain);
      if (hasContent(answer)) setAiSuggestion(res);
      else onChangeA(res);
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
    if (!mcq) { onSave(); return; }
    const kept = options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    if (kept.length < 2) return;
    const finalOptions = kept.map((x) => x.o);
    const newCorrectIndexes = kept
      .map((x, newIdx) => ({ newIdx, old: x.i }))
      .filter((x) => correctSet.has(x.old))
      .map((x) => x.newIdx);
    const safeCorrects = newCorrectIndexes.length ? newCorrectIndexes : [0];
    const optionsHtml = finalOptions
      .map((o, i) => `<div>${OPT_LETTERS[i]}) ${escapeHtml(o)}</div>`)
      .join('');
    const composedQ = `${question}<div style="margin-top:6px">${optionsHtml}</div>`;
    const composedA = safeCorrects.map((ci) => `${OPT_LETTERS[ci]}) ${escapeHtml(finalOptions[ci])} ✓`).join('<br>');
    onSave({ question: composedQ, answer: composedA, options: finalOptions, correctIndexes: safeCorrects, explanation: explanation.trim() || undefined });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className="flex items-center justify-between border-b border-app-border px-4 py-2 dark:border-white/10">
        <span className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/50">{mcq ? '☑ MCQ' : '✏️ Q/A'}</span>
        <button
          onClick={() => setMcq((v) => !v)}
          className={'flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-all ' +
            (mcq ? 'border-primary/40 bg-primary/10 text-primary' : 'border-app-border text-app-text-secondary hover:bg-app-bg dark:border-white/10')}
        >
          ☑ {labels.mcq}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">{labels.question}</p>
          <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
            <RichTextEditor
              html={question}
              onChange={onChangeQ}
              placeholder={`${labels.question}...`}
              minHeight="90px"
            />
          </div>
        </div>
        {mcq ? (
          <div>
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">{labels.options} · <span className="text-emerald-500">{labels.correct} ● {correctSet.size > 1 ? `(${correctSet.size})` : ''}</span></p>
            <div className="flex flex-col gap-2 rounded-xl border border-app-border p-2.5 dark:border-white/10">
              {options.map((o, i) => (
                <div key={i} className={'flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-all ' + (correctSet.has(i) ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10' : 'border-app-border dark:border-white/10')}>
                  <button
                    type="button"
                    onClick={() => toggleCorrect(i)}
                    title={labels.correct}
                    className={'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition-all ' + (correctSet.has(i) ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-app-border text-transparent hover:border-emerald-400 dark:border-white/20')}
                  >✓</button>
                  <span className="flex-shrink-0 text-[12px] font-bold text-app-text-secondary/60">{OPT_LETTERS[i]}</span>
                  <input
                    value={o}
                    dir="auto"
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`${labels.optionPh} ${OPT_LETTERS[i]}`}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-app-text outline-none dark:text-gray-100"
                  />
                  {options.length > 2 && (
                    <button type="button" onClick={() => removeOption(i)} className="flex-shrink-0 text-app-text-secondary/40 hover:text-red-500" title="✕">✕</button>
                  )}
                </div>
              ))}
              {options.length < OPT_LETTERS.length && (
                <button type="button" onClick={addOption} className="mt-0.5 rounded-lg border border-dashed border-app-border py-1.5 text-[12px] font-medium text-app-text-secondary/70 transition-all hover:border-primary hover:text-primary dark:border-white/10">
                  + {labels.addOption}
                </button>
              )}
            </div>
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">{lang === 'en' ? 'Explanation (optional)' : 'Förklaring (valfri)'}</p>
              <textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                dir="auto"
                rows={3}
                placeholder={lang === 'en' ? 'Why is this the correct answer?' : 'Varför är detta rätt svar?'}
                className="w-full resize-none rounded-xl border border-app-border bg-white px-3 py-2 text-[13px] text-app-text outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200/60 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
              />
            </div>
          </div>
        ) : (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">{labels.answer}</p>
          <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
            <RichTextEditor
              html={answer}
              onChange={onChangeA}
              placeholder={`${labels.answer}...`}
              minHeight="90px"
              toolbarEnd={(
                <button
                  type="button"
                  onClick={handleAiAnswer}
                  disabled={aiLoading || !question.replace(/<[^>]*>/g, '').trim()}
                  className="flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-violet-200 bg-violet-50 px-2.5 text-[11px] font-semibold text-violet-700 transition-all hover:bg-violet-100 disabled:opacity-40 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  {aiLoading ? <span className="animate-spin">⏳</span> : '🧠'} {labels.aiAnswer}
                </button>
              )}
            />
          </div>
          {aiSuggestion !== null && (
            <div className="mt-2 overflow-hidden rounded-xl border border-violet-300 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="flex items-center justify-between border-b border-violet-200 px-3 py-1.5 dark:border-violet-500/20">
                <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">🧠 {labels.aiSuggestion}</span>
                <button onClick={() => setAiSuggestion(null)} className="text-[12px] text-violet-500/70 hover:text-violet-700">✕</button>
              </div>
              <div dir="auto" className="px-3 py-2 text-[13px] leading-relaxed text-app-text [overflow-wrap:anywhere] dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(aiSuggestion) }} />
              <div className="flex justify-end gap-2 border-t border-violet-200 px-3 py-2 dark:border-violet-500/20">
                <button onClick={() => setAiSuggestion(null)} className="rounded-lg border border-app-border px-3 py-1 text-[11px] text-app-text-secondary hover:bg-white/50 dark:border-white/10">{labels.keep}</button>
                <button onClick={() => { onChangeA(aiSuggestion); setAiSuggestion(null); }} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700">↔ {labels.replace}</button>
              </div>
            </div>
          )}
        </div>
        )}
        <div className="flex justify-end gap-2 md:col-span-2">
          <button onClick={onCancel} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text-secondary hover:bg-app-border/40">{labels.cancel}</button>
          <button onClick={handleSave} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">{labels.save}</button>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onImport, onClose }: { onImport: (pairs: { question: string; answer: string }[]) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const preview = parseImportText(text);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/60 p-4 backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-app-border bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-app-text dark:text-gray-100">📋 Import from text</h3>
          <button onClick={onClose} className="text-app-text-secondary hover:text-app-text">✕</button>
        </div>
        <p className="text-[12px] text-app-text-secondary dark:text-gray-400">
          Paste pairs separated by <strong>Tab</strong>, <strong>|</strong>, or <strong>alternating lines</strong> (question, answer, question, answer…)
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Capital of France\tParis\nCapital of Japan\tTokyo"}
          rows={6}
          className="w-full resize-none rounded-xl border border-app-border bg-app-bg px-4 py-3 text-[13px] font-mono text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
        />
        {text && (
          <div className="rounded-xl border border-app-border bg-app-bg px-3 py-2 dark:border-white/10 dark:bg-gray-800">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">Preview — {preview.length} pairs</p>
            <div className="max-h-32 overflow-y-auto">
              {preview.slice(0, 5).map((p, i) => (
                <div key={i} className="flex gap-2 py-0.5 text-[11px]">
                  <span className="font-semibold text-app-text dark:text-gray-200 truncate">{p.question}</span>
                  <span className="flex-shrink-0 text-app-text-secondary/50">→</span>
                  <span className="text-app-text-secondary dark:text-gray-400 truncate">{p.answer}</span>
                </div>
              ))}
              {preview.length > 5 && <p className="text-[10px] text-app-text-secondary/50">+{preview.length - 5} more…</p>}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-app-border px-4 py-2 text-[13px] text-app-text-secondary hover:bg-app-bg dark:border-white/10">Cancel</button>
          <button
            onClick={() => { if (preview.length > 0) { onImport(preview); onClose(); } }}
            disabled={preview.length === 0}
            className="rounded-xl bg-primary px-5 py-2 text-[13px] font-semibold text-white hover:bg-primary-dark disabled:opacity-40"
          >
            Import {preview.length > 0 ? `${preview.length} pairs` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

const SET_COLORS = [
  { name: 'Default', value: '' },
  { name: 'Lila', value: '#8b5cf6' },
  { name: 'Blå', value: '#3b82f6' },
  { name: 'Grön', value: '#10b981' },
  { name: 'Gul', value: '#f59e0b' },
  { name: 'Röd', value: '#ef4444' },
  { name: 'Rosa', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
];

export function QuizPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const { quizzes, quizSets: allQuizSets, quizFolders: allQuizFolders, addQuiz, deleteQuiz, updateQuiz, addQuizSet, deleteQuizSet, renameQuizSet, reorderQuizSets, setQuizSetColor, setQuizSetFolder, addQuizFolder, renameQuizFolder, reorderQuizFolders, setQuizFolderColor, deleteQuizFolder, restoreQuizFolder, recoverQuizFolders, addItemToSet, removeItemFromSet, updateItemInSet } = useNotes();
  const trashedFolderIds = new Set(allQuizFolders.filter((folder) => folder.trashed).map((folder) => folder.id));
  const quizFolders = allQuizFolders.filter((folder) => !folder.trashed);
  const quizSets = allQuizSets.filter((set) => !set.trashed && !(set.folderId && trashedFolderIds.has(set.folderId)));
  const trashedUserFolders = useMemo(
    () => allQuizFolders.filter((folder) => folder.trashed && !folder.system),
    [allQuizFolders],
  );
  const orphanSetCount = useMemo(() => {
    const folderIds = new Set(allQuizFolders.map((folder) => folder.id));
    return allQuizSets.filter((set) => !set.trashed && set.folderId && !folderIds.has(set.folderId)).length;
  }, [allQuizFolders, allQuizSets]);

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const dragSetId = useRef<string | null>(null);
  const dragFolderId = useRef<string | null>(null);
  const [dragOverSetId, setDragOverSetId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverFolderSortId, setDragOverFolderSortId] = useState<string | null>(null);
  // Favorites are persisted as copies inside the system "Favoriter" set.
  // favs = the set of ORIGINAL item ids that have a copy there.
  const favItems = allQuizSets.find((s) => s.id === FAVORITES_SET_ID)?.items ?? [];
  const favs = useMemo(
    () => new Set(favItems.map((i) => i.favOf).filter((x): x is number => x != null)),
    [favItems]
  );
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const [allProgress, setAllProgress] = useState<Record<string, Record<number, 'known' | 'learning'>>>(loadProgress);

  // Study mode
  const [studyMode, setStudyMode] = useState<'flashcard' | 'written' | null>(null);
  // Optional filtered deck chosen from inside study mode (🎯 Välj)
  const [studyDeck, setStudyDeck] = useState<QuizItem[] | null>(null);
  // Hide answers (self-test): blur all Svar, click a card to reveal it
  const [hideAnswers, setHideAnswers] = useState(false);
  // Ordering: default = study priority (not-known/not-studied first, known last).
  // Toggle to chronological (original) order.
  const [chronological, setChronological] = useState(false);
  // Which questions to show: all / only to-study (not known) / only known
  const [viewFilter, setViewFilter] = useState<'all' | 'study' | 'known'>('all');

  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editQ, setEditQ] = useState('');
  const [editA, setEditA] = useState('');

  // New question panel
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');

  // Rename set
  const [renamingSetId, setRenamingSetId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // Folders (OneNote-style notebooks)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderRenameVal, setFolderRenameVal] = useState('');
  const [folderCtxMenu, setFolderCtxMenu] = useState<{ folderId: string; x: number; y: number; flip?: boolean } | null>(null);
  const [folderColorPicker, setFolderColorPicker] = useState(false);
  const [confirmDeleteFolderId, setConfirmDeleteFolderId] = useState<string | null>(null);
  const [moveMenuForSet, setMoveMenuForSet] = useState<string | null>(null);
  const [nameAlert, setNameAlert] = useState<'set' | 'folder' | null>(null);

  // Import
  const [showImport, setShowImport] = useState(false);

  // Show/hide the sets sidebar
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => localStorage.getItem('malacadhati_quiz_sidebar') !== 'closed');
  const toggleSidebar = () => setSidebarOpen((v) => { const n = !v; localStorage.setItem('malacadhati_quiz_sidebar', n ? 'open' : 'closed'); return n; });
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
      localStorage.setItem('malacadhati_quiz_foldercol', String(lastW));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Sort the sets list
  const [setSort, setSetSort] = useState<'manual' | 'name' | 'count'>(() => (localStorage.getItem('malacadhati_quiz_setsort') as 'manual' | 'name' | 'count') || 'manual');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const changeSort = (mode: 'manual' | 'name' | 'count') => { setSetSort(mode); localStorage.setItem('malacadhati_quiz_setsort', mode); setSortMenuOpen(false); };

  const toggleFav = (item: QuizItem) => {
    // Inside the Favorites set: the card itself is the copy — remove it.
    if (item.favOf != null) { removeItemFromSet(FAVORITES_SET_ID, item.id); return; }
    const existing = favItems.find((i) => i.favOf === item.id);
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
    const item = selectedSet ? selectedSet.items.find((i) => i.id === id) : quizzes.find((q) => q.id === id);
    if (!item) return;
    if (speakingId === id) { window.speechSynthesis.cancel(); setSpeakingId(null); return; }
    window.speechSynthesis.cancel();
    setSpeakingId(id);
    const u = new SpeechSynthesisUtterance(item.question.replace(/<[^>]*>/g, '') + '. ' + item.answer.replace(/<[^>]*>/g, ''));
    u.lang = navigator.language || 'sv-SE';
    u.onend = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
  };

  const startEdit = (item: QuizItem) => {
    setEditingId(item.id);
    // For MCQ items the question stores the stem + the appended options block;
    // strip that block so the editor shows just the stem (options have their own fields).
    const stem = item.options && item.options.length
      ? item.question.replace(/<div style="margin-top:6px">[\s\S]*$/, '')
      : item.question;
    setEditQ(stem);
    setEditA(item.answer);
  };

  const saveEdit = (override?: SavePayload) => {
    if (editingId === null) return;
    const q = override?.question ?? editQ;
    const a = override?.answer ?? editA;
    if (!hasContent(q) || !hasContent(a)) return;
    const patch = { question: q, answer: a, options: override?.options, correctIndex: override?.correctIndexes?.[0], correctIndexes: override?.correctIndexes, explanation: override?.explanation };
    if (selectedSetId) updateItemInSet(selectedSetId, editingId, patch);
    else updateQuiz(editingId, patch);
    setEditingId(null);
  };

  const saveNewQuestion = (override?: SavePayload) => {
    const q = override?.question ?? newQ;
    const a = override?.answer ?? newA;
    if (!hasContent(q) || !hasContent(a)) return;
    const item = { noteId: 0, noteTitle: '', question: q, answer: a, options: override?.options, correctIndex: override?.correctIndexes?.[0], correctIndexes: override?.correctIndexes, explanation: override?.explanation, date: new Date().toLocaleDateString(), createdAt: new Date().toISOString() };
    if (selectedSetId) addItemToSet(selectedSetId, item);
    else addQuiz(item);
    setNewQ(''); setNewA(''); setAddingQuestion(false);
  };

  const saveAndAddNew = () => {
    if (hasContent(newQ) && hasContent(newA)) {
      const item = { noteId: 0, noteTitle: '', question: newQ, answer: newA, date: new Date().toLocaleDateString(), createdAt: new Date().toISOString() };
      if (selectedSetId) addItemToSet(selectedSetId, item);
      else addQuiz(item);
    }
    setNewQ(''); setNewA('');
    setAddingQuestion(true);
  };

  const handleQuickCreateSet = () => {
    let num = quizSets.length + 1;
    while (allQuizSets.some((set) => normalizeQuizName(set.name) === normalizeQuizName(`Nameless ${num}`))) num += 1;
    const s = addQuizSet(`Nameless ${num}`);
    if (selectedFolderId) setQuizSetFolder(s.id, selectedFolderId);
    setSelectedSetId(s.id);
  };

  const commitSetName = (set: QuizSet) => {
    const name = renameVal.trim().replace(/\s+/g, ' ') || set.name;
    const duplicate = allQuizSets.some((item) => item.id !== set.id && normalizeQuizName(item.name) === normalizeQuizName(name));
    if (duplicate) {
      setNameAlert('set');
      return;
    }
    renameQuizSet(set.id, name);
    setRenamingSetId(null);
  };

  const commitFolderName = (folderId: string, fallbackName: string) => {
    const name = folderRenameVal.trim().replace(/\s+/g, ' ') || fallbackName;
    const duplicate = allQuizFolders.some((folder) => folder.id !== folderId && normalizeQuizName(folder.name) === normalizeQuizName(name));
    if (duplicate) {
      setNameAlert('folder');
      return;
    }
    renameQuizFolder(folderId, name);
    setRenamingFolderId(null);
  };

  const createFolder = () => {
    const base = lang === 'sv' ? 'Ny mapp' : 'New folder';
    let name = base;
    let suffix = 2;
    while (allQuizFolders.some((folder) => normalizeQuizName(folder.name) === normalizeQuizName(name))) {
      name = `${base} ${suffix}`;
      suffix += 1;
    }
    const folder = addQuizFolder(name);
    setRenamingFolderId(folder.id);
    setFolderRenameVal(name);
    setSelectedFolderId(folder.id);
    setSelectedSetId(null);
  };

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ setId: string; x: number; y: number; flip?: boolean } | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [confirmDeleteSetId, setConfirmDeleteSetId] = useState<string | null>(null);

  const openCtxMenu = (e: React.MouseEvent, setId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const flipY = e.clientY > window.innerHeight * 0.6;
    setCtxMenu({ setId, x: e.clientX, y: flipY ? window.innerHeight - e.clientY : e.clientY, flip: flipY });
    setShowColorPicker(false);
    setMoveMenuForSet(null);
  };

  const closeCtxMenu = () => { setCtxMenu(null); setShowColorPicker(false); setMoveMenuForSet(null); };

  const handleImport = (pairs: { question: string; answer: string }[]) => {
    pairs.forEach((p) => {
      if (selectedSetId) {
        addItemToSet(selectedSetId, { noteId: 0, noteTitle: '', question: p.question, answer: p.answer, date: new Date().toLocaleDateString() });
      }
    });
  };

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
  const displayItems: QuizItem[] = selectedSet ? (selectedSet.items ?? []) : isNotesView ? [...quizzes].reverse() : [];

  const renderItem = (item: QuizItem) => (
    editingId === item.id ? (
      <EditPanel
        key={item.id}
        question={editQ}
        answer={editA}
        initialOptions={item.options}
        initialCorrect={item.correctIndex}
        initialCorrects={item.correctIndexes}
        initialExplanation={item.explanation}
        onChangeQ={setEditQ}
        onChangeA={setEditA}
        onSave={saveEdit}
        onCancel={() => setEditingId(null)}
      />
    ) : (
      <QuizItemRow
        key={item.id}
        item={item}
        onEdit={startEdit}
        onDelete={() => selectedSetId ? removeItemFromSet(selectedSetId, item.id) : deleteQuiz(item.id)}
        speakingId={speakingId}
        onSpeak={handleSpeak}
        favs={favs}
        onToggleFav={toggleFav}
        progressMap={currentProgress}
        hideAnswers={hideAnswers}
        onSetStatus={setItemStatus}
        sets={quizSets.filter((s) => s.id !== selectedSetId && !!s.folderId && !s.system)}
        folders={quizFolders}
        onMoveToSet={(setId) => {
          addItemToSet(setId, { ...item });
          if (selectedSetId) removeItemFromSet(selectedSetId, item.id);
          else deleteQuiz(item.id);
        }}
      />
    )
  );

  // Study-priority order: learning (got wrong) first, then not-studied, then known last.
  // Stable sort preserves original order within each tier.
  const priorityRank = (it: QuizItem) => {
    const s = currentProgress[it.id];
    if (s === 'learning') return 0;
    if (!s) return 1;
    return 2; // known
  };
  const filteredItems = displayItems.filter((it) => {
    if (viewFilter === 'known') return currentProgress[it.id] === 'known';
    if (viewFilter === 'study') return currentProgress[it.id] !== 'known';
    return true;
  });
  const orderedItems = chronological
    ? filteredItems
    : filteredItems.map((it, i) => ({ it, i })).sort((a, b) => priorityRank(a.it) - priorityRank(b.it) || a.i - b.i).map((x) => x.it);

  const sortedSets = setSort === 'manual'
    ? quizSets
    : [...quizSets].sort((a, b) =>
        setSort === 'name'
          ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
          : (b.items?.length ?? 0) - (a.items?.length ?? 0));

  const progressForSet = (setId: string | null) => {
    const key = setId ?? 'all';
    const prog = allProgress[key] ?? {};
    const items = setId ? (quizSets.find((s) => s.id === setId)?.items ?? []) : quizzes;
    const known = items.filter((i) => prog[i.id] === 'known').length;
    return { known, total: items.length };
  };

  // Group sorted sets by folder. A set whose folder was deleted falls back to ungrouped.
  const folderIds = new Set(quizFolders.map((f) => f.id));
  const ungroupedSets = sortedSets.filter((s) => !s.folderId || !folderIds.has(s.folderId));
  const setsInFolder = (fid: string) => sortedSets.filter((s) => s.folderId === fid);

  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId);
    setSelectedSetId(setsInFolder(folderId)[0]?.id ?? null);
  };

  // Sets shown in the right panel depending on which folder is selected
  const currentSets = selectedFolderId ? setsInFolder(selectedFolderId) : ungroupedSets;

  const renderSetRow = (s: QuizSet) => {
    const { known, total } = progressForSet(s.id);
    return (
      <div
        key={s.id}
        className="group mb-0.5"
        draggable={!s.system}
        onDragStart={(e) => {
          dragSetId.current = s.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', s.id);
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOverSetId(s.id); }}
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
        onDragEnd={() => { dragSetId.current = null; setDragOverSetId(null); setDragOverFolderId(null); setDragOverFolderSortId(null); }}
        style={dragOverSetId === s.id ? { outline: '2px solid var(--color-primary)', outlineOffset: '-2px', borderRadius: '8px' } : undefined}
      >
        {renamingSetId === s.id ? (
          <div className="flex items-center gap-1 rounded-xl bg-white px-2 py-1.5 dark:bg-white/5">
            <input
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSetName(s);
                if (e.key === 'Escape') setRenamingSetId(null);
              }}
              onBlur={() => commitSetName(s)}
              className="min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none dark:text-gray-200"
            />
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => commitSetName(s)} className="text-[10px] text-primary">✓</button>
          </div>
        ) : (
          <div
            onContextMenu={(e) => { if (!s.system) openCtxMenu(e, s.id); }}
            className={'relative flex w-full flex-col overflow-hidden rounded-lg text-left text-[13px] font-medium transition-all ' +
              (selectedSetId === s.id ? 'bg-primary/10 dark:bg-primary/20' : 'hover:bg-white dark:hover:bg-white/5')}
          >
            <span className="absolute inset-y-0 left-0 w-[5px] rounded-r-sm" style={{ backgroundColor: s.color || '#9ca3af' }} />
            <div className="flex w-full items-center">
              <span className="flex-shrink-0 select-none pl-1.5 text-[13px] text-app-text-secondary/20 opacity-0 transition-opacity group-hover:opacity-100">{s.system === 'favorites' ? '⭐' : '⠿'}</span>
              <button onClick={() => setSelectedSetId(s.id)} className="flex flex-1 items-center gap-2 py-2.5 pl-1.5 pr-2 min-w-0">
                <span className={'flex-1 truncate ' + (selectedSetId === s.id ? 'text-primary' : 'text-app-text dark:text-gray-200')}>{s.name}</span>
                <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{s.items?.length ?? 0}</span>
              </button>
              {!s.system && (
                <button
                  onClick={(e) => openCtxMenu(e, s.id)}
                  className="mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[13px] leading-none text-app-text-secondary/40 opacity-0 transition-opacity hover:bg-app-border hover:text-app-text group-hover:opacity-100 dark:hover:bg-white/10"
                  title="Options"
                >···</button>
              )}
            </div>
            {total > 0 && known > 0 && (
              <div className="mb-1.5 flex items-center gap-2 pl-10 pr-3">
                <div className="h-1 flex-1 rounded-full bg-app-border dark:bg-white/10">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(known / total) * 100}%` }} />
                </div>
                <span className="text-[9px] text-emerald-500 font-semibold">{known}/{total}</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Collapsed: thin strip with a reopen button */}
      {!sidebarOpen && (
        <div className="flex flex-shrink-0 flex-col items-center border-r border-app-border bg-app-bg px-1.5 pt-3 dark:border-white/10 dark:bg-gray-950">
          <button
            onClick={toggleSidebar}
            title="Visa listan"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
          >
            ☰
          </button>
        </div>
      )}

      {/* Sidebar — two-column: Folders | Sets */}
      {sidebarOpen && (
      <div className="flex flex-shrink-0 flex-col border-r border-app-border bg-app-bg dark:border-white/10 dark:bg-gray-950" style={{ width: folderColW + 184 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60 dark:text-gray-500">Quiz</p>
          <button
            onClick={toggleSidebar}
            title="Dölj listan"
            className="flex h-6 w-6 items-center justify-center rounded-lg text-app-text-secondary/60 transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
          >«</button>
        </div>

        {(trashedUserFolders.length > 0 || orphanSetCount > 0) && (
          <div className="mx-2 mb-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            {trashedUserFolders.map((folder) => (
              <div key={folder.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{lang === 'sv' ? 'Mapp i papperskorgen' : 'Folder in trash'}: <strong>{folder.name}</strong></span>
                <button
                  onClick={() => { restoreQuizFolder(folder.id); show(lang === 'sv' ? `↩ ${folder.name} återställd` : `↩ ${folder.name} restored`); }}
                  className="flex-shrink-0 rounded-lg bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
                >
                  {lang === 'sv' ? 'Återställ' : 'Restore'}
                </button>
              </div>
            ))}
            {orphanSetCount > 0 && (
              <button
                onClick={() => {
                  void recoverQuizFolders().then((count) => {
                    show(count > 0
                      ? (lang === 'sv' ? `↩ ${count} saknade mappar återställda` : `↩ ${count} missing folders restored`)
                      : (lang === 'sv' ? 'Inga fler mappar hittades' : 'No more folders found'));
                  });
                }}
                className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-100"
              >
                {lang === 'sv' ? 'Sök efter saknade mappar' : 'Search for missing folders'}
              </button>
            )}
          </div>
        )}

        {/* Questions from Notes — full-width special row */}
        <button
          onClick={() => { setSelectedSetId(null); setSelectedFolderId(null); }}
          className={'mx-2 mb-1 flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-medium transition-all ' +
            (isNotesView ? 'bg-primary/10 text-primary dark:bg-primary/20' : 'text-app-text hover:bg-white dark:text-gray-300 dark:hover:bg-white/5')}
        >
          <span>🧠</span>
          <span className="flex-1 truncate">Questions from Notes</span>
          <span className="text-[11px] text-app-text-secondary/60 dark:text-gray-500">{quizzes.length}</span>
        </button>

        {/* Two-column area */}
        <div className="flex flex-1 overflow-hidden border-t border-app-border dark:border-white/10">

          {/* Left column: Folders */}
          <div className="flex flex-shrink-0 flex-col overflow-y-auto py-1" style={{ width: folderColW }}>
            {quizFolders.length === 0 && (
              <p className="px-2 py-4 text-center text-[10px] italic leading-relaxed text-app-text-secondary/40">Inga<br/>mappar</p>
            )}
            {quizFolders.map((f) => (
              <div key={f.id} className="group/fl relative">
                {renamingFolderId === f.id ? (
                  <div className="px-2 py-1.5">
                    <input
                      autoFocus
                      value={folderRenameVal}
                      onChange={(e) => setFolderRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitFolderName(f.id, f.name);
                        if (e.key === 'Escape') setRenamingFolderId(null);
                      }}
                      onBlur={() => commitFolderName(f.id, f.name)}
                      className="w-full bg-transparent text-[11px] font-semibold text-app-text outline-none dark:text-gray-100"
                    />
                  </div>
                ) : (
                  <button
                    draggable={!f.system}
                    onDragStart={(e) => {
                      if (f.system) return;
                      dragFolderId.current = f.id;
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('application/x-quiz-folder', f.id);
                    }}
                    onClick={() => selectFolder(f.id)}
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
                      if (folderId) {
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
                    className={'relative w-full py-2.5 pl-3 pr-1 text-left transition-all ' +
                      (dragOverFolderSortId === f.id
                        ? 'bg-primary/10 ring-2 ring-inset ring-primary/70 dark:bg-primary/20'
                        : dragOverFolderId === f.id
                          ? 'bg-primary/20 ring-2 ring-inset ring-primary dark:bg-primary/30'
                          : selectedFolderId === f.id
                            ? 'bg-primary/10 dark:bg-primary/20'
                            : 'hover:bg-white dark:hover:bg-white/5')}
                  >
                    <span className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: f.color || '#9ca3af' }} />
                    {!f.system && (
                      <span className="absolute right-1 bottom-1 select-none text-[12px] text-app-text-secondary/20 opacity-0 transition-opacity group-hover/fl:opacity-100">⠿</span>
                    )}
                    <span title={f.system === 'favorites' ? 'Favoriter' : f.system ? (lang === 'sv' ? 'Återställda set' : 'Restored Sets') : f.name} className={'block truncate text-[11px] font-semibold ' + (selectedFolderId === f.id ? 'text-primary' : 'text-app-text dark:text-gray-200')}>
                      {f.system === 'favorites' ? '⭐ Favoriter' : f.system ? `🔒 ${lang === 'sv' ? 'Återställda' : 'Restored'}` : f.name}
                    </span>
                    <span className="block text-[9px] text-app-text-secondary/50">{setsInFolder(f.id).length} set</span>
                    {!f.system && (
                      <span
                        onClick={(e) => { e.stopPropagation(); setFolderCtxMenu({ folderId: f.id, x: e.clientX, y: e.clientY > window.innerHeight * 0.6 ? window.innerHeight - e.clientY : e.clientY, flip: e.clientY > window.innerHeight * 0.6 }); setFolderColorPicker(false); }}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded text-[10px] leading-none text-app-text-secondary/40 opacity-0 transition-opacity hover:bg-app-border group-hover/fl:opacity-100"
                      >···</span>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Drag handle to resize folders column */}
          <div
            onMouseDown={startFolderResize}
            className="group/handle relative w-1 flex-shrink-0 cursor-col-resize border-r border-app-border bg-transparent transition-colors hover:bg-primary/30 dark:border-white/10"
            title="Dra för att ändra bredd"
          >
            <span className="absolute inset-y-0 -left-1 -right-1" />
          </div>

          {/* Right column: Sets */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Sort control */}
            <div className="relative flex items-center justify-between px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-app-text-secondary/50 dark:text-gray-600">Sets</p>
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                className="flex h-5 items-center gap-1 rounded-md px-1 text-[9px] font-semibold text-app-text-secondary/60 transition-colors hover:bg-white hover:text-primary dark:hover:bg-white/10"
              >⇅ {setSort === 'name' ? 'A–Z' : setSort === 'count' ? '#' : 'Egen'}</button>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                  <div className="absolute right-1 top-7 z-50 w-36 overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800">
                    {([
                      { key: 'manual', label: '✋ Egen ordning' },
                      { key: 'name', label: '🔤 Namn (A–Z)' },
                      { key: 'count', label: '🔢 Antal frågor' },
                    ] as const).map((o) => (
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
            {/* Sets list */}
            <div className="flex-1 overflow-y-auto px-1">
              {currentSets.length === 0 ? (
                <p className="py-4 text-center text-[11px] italic text-app-text-secondary/40">
                  {selectedFolderId ? 'Tomt' : 'Inga lösa set'}
                </p>
              ) : (
                currentSets.map((s) => renderSetRow(s))
              )}
            </div>
          </div>
        </div>

        {/* Bottom buttons — aligned with their column */}
        <div className="flex border-t border-app-border dark:border-white/10">
          <button
            onClick={createFolder}
            className="flex w-[84px] flex-shrink-0 items-center justify-center gap-1 border-r border-app-border py-2.5 text-[11px] font-semibold text-primary transition-all hover:bg-primary/5 dark:border-white/10 dark:hover:bg-primary/10"
          >
            <span className="text-base leading-none">+</span> Mapp
          </button>
          <button
            onClick={handleQuickCreateSet}
            className="flex flex-1 items-center justify-center gap-1 py-2.5 text-[11px] font-semibold text-primary transition-all hover:bg-primary/5 dark:hover:bg-primary/10"
          >
            <span className="text-base leading-none">+</span> Lägg till set
          </button>
        </div>
      </div>
      )}

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-4 sm:px-5 sm:py-5">
          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
            <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
              {selectedSet
                ? `📂 ${selectedSet.name} — ${displayItems.length} ${displayItems.length === 1 ? 'fråga' : 'frågor'}`
                : isFolderEmptyView
                  ? `📁 ${selectedFolder?.system === 'favorites' ? 'Favoriter' : selectedFolder?.system ? (lang === 'sv' ? 'Återställda' : 'Restored') : selectedFolder?.name ?? (lang === 'sv' ? 'Mapp' : 'Folder')} — 0 set`
                  : `🧠 Questions from Notes — ${displayItems.length} ${displayItems.length === 1 ? 'fråga' : 'frågor'}`}
              {!isFolderEmptyView && knownCount > 0 && displayItems.length > 0 && (
                <span className="ml-2 font-normal text-emerald-500">· {knownCount}/{displayItems.length} known</span>
              )}
            </span>
            {!isFolderEmptyView && displayItems.length > 0 && (
              <div className="flex items-center gap-1.5">
                {/* View filter: all / to-study / known */}
                <select
                  value={viewFilter}
                  onChange={(e) => setViewFilter(e.target.value as 'all' | 'study' | 'known')}
                  className="rounded-xl border border-app-border bg-app-bg px-2.5 py-1.5 text-[11px] font-semibold text-app-text-secondary outline-none transition hover:bg-app-border/40 dark:border-white/10 dark:bg-white/5 dark:text-gray-400"
                  title={lang === 'sv' ? 'Visa frågor' : 'Show questions'}
                >
                  <option value="all">{lang === 'sv' ? 'Alla frågor' : 'All questions'}</option>
                  <option value="study">{lang === 'sv' ? 'Att plugga' : 'To study'}</option>
                  <option value="known">{lang === 'sv' ? 'Kan' : 'Known'}</option>
                </select>
                {/* Import - only for sets */}
                {selectedSetId && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1 rounded-xl border border-app-border px-2.5 py-1.5 text-[11px] font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
                    title="Import from text"
                  >
                    📋 Import
                  </button>
                )}
                {/* Hide/show answers toggle */}
                <button
                  onClick={() => setHideAnswers((v) => !v)}
                  className={'flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors ' + (hideAnswers ? 'border-primary bg-primary text-white' : 'border-app-border bg-app-bg text-app-text-secondary hover:bg-app-border/40 dark:border-white/10 dark:text-gray-400')}
                  title={hideAnswers ? (lang === 'sv' ? 'Visa svar' : 'Show answers') : (lang === 'sv' ? 'Dölj svar' : 'Hide answers')}
                >
                  {hideAnswers ? '👁️ ' : '🙈 '}{hideAnswers ? (lang === 'sv' ? 'Visa svar' : 'Show') : (lang === 'sv' ? 'Dölj svar' : 'Hide')}
                </button>
                {/* Order toggle: study priority vs chronological */}
                <button
                  onClick={() => setChronological((v) => !v)}
                  className={'flex items-center gap-1 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors ' + (chronological ? 'border-primary bg-primary text-white' : 'border-app-border bg-app-bg text-app-text-secondary hover:bg-app-border/40 dark:border-white/10 dark:text-gray-400')}
                  title={chronological ? (lang === 'sv' ? 'Visa studieordning (att plugga först)' : 'Show study order') : (lang === 'sv' ? 'Ordna i kronologisk ordning' : 'Chronological order')}
                >
                  {chronological ? '🎯 ' : '🕑 '}{chronological ? (lang === 'sv' ? 'Studieordning' : 'Study order') : (lang === 'sv' ? 'Kronologisk' : 'Chronological')}
                </button>
                {/* Study buttons */}
                <button
                  onClick={() => { setStudyDeck(null); setStudyMode('flashcard'); }}
                  className="flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                >
                  🃏 Flashcards
                </button>
                <button
                  onClick={() => { setStudyDeck(null); setStudyMode('written'); }}
                  className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
                >
                  ✏️ Written
                </button>
                <button
                  onClick={() => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
                  className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                >
                  + {lang === 'sv' ? 'Lägg till' : 'Add'}
                </button>
              </div>
            )}
            {!isFolderEmptyView && displayItems.length === 0 && (
              <div className="flex items-center gap-1.5">
                {selectedSetId && (
                  <button
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1 rounded-xl border border-app-border px-2.5 py-1.5 text-[11px] font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
                  >
                    📋 Import
                  </button>
                )}
                <button
                  onClick={() => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
                  className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-3 py-1.5 text-[12px] font-semibold text-primary transition-all hover:bg-primary/10"
                >
                  <span className="text-base leading-none">+</span> {lang === 'sv' ? 'Lägg till fråga' : 'Add Question'}
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
                {lang === 'sv' ? 'Det finns inga set här.' : 'There are no sets here.'}
              </p>
              <p className="mt-1 text-sm text-app-text-secondary dark:text-gray-400">
                {lang === 'sv' ? 'Lägg till ett set för att börja.' : 'Add a set to get started.'}
              </p>
              <button
                onClick={handleQuickCreateSet}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/30 transition hover:bg-primary-dark"
              >
                <span className="text-base leading-none">+</span>
                {lang === 'sv' ? 'Lägg till set' : 'Add set'}
              </button>
            </div>
          ) : (
          <>
          {/* Questions list */}
          <div className="flex flex-col gap-2">
            {orderedItems.map((item) => renderItem(item))}

            {/* New question panel — appears at the bottom, where you add */}
            {addingQuestion && (
              <EditPanel
                question={newQ}
                answer={newA}
                onChangeQ={setNewQ}
                onChangeA={setNewA}
                onSave={saveNewQuestion}
                onCancel={() => { setAddingQuestion(false); setNewQ(''); setNewA(''); }}
              />
            )}

            {/* Add question dashed button — always visible; saves current if open */}
            <button
              onClick={addingQuestion ? saveAndAddNew : () => { setAddingQuestion(true); setNewQ(''); setNewA(''); }}
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl border-2 border-dashed border-app-border text-xl text-app-text-secondary/50 transition-all hover:border-primary hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:hover:border-primary/50 dark:hover:bg-primary/10"
              title={lang === 'sv' ? 'Lägg till fråga' : 'Add Question'}
            >
              +
            </button>
          </div>
          </>
          )}
        </div>
      </div>

      {/* Study mode overlay */}
      {studyMode && (studyDeck ?? displayItems).length > 0 && (
        <StudyMode
          title={selectedSet?.name ?? 'Questions from Notes'}
          items={studyDeck ?? displayItems}
          allItems={displayItems}
          lang={lang}
          mode={studyMode}
          initialProgress={currentProgress}
          onClose={() => { setStudyMode(null); setStudyDeck(null); }}
          onSaveProgress={handleSaveProgress}
        />
      )}

      {/* Import modal */}
      {showImport && selectedSetId && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {nameAlert && (
        <BrandedAlert
          message={lang === 'sv'
            ? nameAlert === 'folder'
              ? 'Det finns redan en mapp med det namnet. Försök med ett annat namn.'
              : 'Det finns redan ett set med det namnet. Försök med ett annat namn.'
            : nameAlert === 'folder'
              ? 'A folder with that name already exists. Try a different name.'
              : 'A set with that name already exists. Try a different name.'}
          buttonLabel="OK"
          onClose={() => setNameAlert(null)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeCtxMenu} onContextMenu={(e) => { e.preventDefault(); closeCtxMenu(); }} />
          <div
            className="fixed z-50 min-w-[160px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800"
            style={ctxMenu.flip ? { bottom: ctxMenu.y, left: ctxMenu.x } : { top: ctxMenu.y, left: ctxMenu.x }}
          >
            <button
              onClick={() => {
                const s = quizSets.find((x) => x.id === ctxMenu.setId);
                if (s) { setRenamingSetId(s.id); setRenameVal(s.name); setSelectedSetId(s.id); }
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              ✏️ Byt namn
            </button>
            <button
              onClick={() => setShowColorPicker((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">🎨 Färg</span>
              <span className="text-app-text-secondary/50">{showColorPicker ? '▾' : '›'}</span>
            </button>
            {showColorPicker && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2">
                {SET_COLORS.map((c) => {
                  const active = (quizSets.find((x) => x.id === ctxMenu.setId)?.color ?? '') === c.value;
                  return (
                    <button
                      key={c.name}
                      title={c.name}
                      onClick={() => { setQuizSetColor(ctxMenu.setId, c.value); closeCtxMenu(); }}
                      className={'flex h-6 w-6 items-center justify-center rounded-full border transition-all ' +
                        (active ? 'border-app-text ring-2 ring-primary/40 dark:border-white' : 'border-app-border dark:border-white/20')}
                      style={c.value ? { backgroundColor: c.value } : undefined}
                    >
                      {!c.value && <span className="text-[10px] text-app-text-secondary">✕</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setMoveMenuForSet((v) => (v === ctxMenu.setId ? null : ctxMenu.setId))}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">📒 Flytta till mapp</span>
              <span className="text-app-text-secondary/50">{moveMenuForSet === ctxMenu.setId ? '▾' : '›'}</span>
            </button>
            {moveMenuForSet === ctxMenu.setId && (
              <div className="max-h-44 overflow-y-auto py-0.5">
                {quizFolders.map((f) => {
                  const active = quizSets.find((x) => x.id === ctxMenu.setId)?.folderId === f.id;
                  return (
                    <button
                      key={f.id}
                      onClick={() => { setQuizSetFolder(ctxMenu.setId, f.id); closeCtxMenu(); }}
                      className={'flex w-full items-center gap-2 px-6 py-1.5 text-[12px] hover:bg-app-bg dark:hover:bg-white/5 ' + (active ? 'font-bold text-primary' : 'text-app-text dark:text-gray-200')}
                    >📒 {f.name}{active && ' ✓'}</button>
                  );
                })}
                {quizFolders.length === 0 && <p className="px-6 py-1.5 text-[11px] italic text-app-text-secondary/50">Inga mappar än</p>}
              </div>
            )}
            <div className="my-1 h-px bg-app-border dark:bg-white/10" />
            <button
              onClick={() => {
                setConfirmDeleteSetId(ctxMenu.setId);
                closeCtxMenu();
              }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >
              🗑 Ta bort set
            </button>
          </div>
        </>
      )}

      {/* Folder context menu */}
      {folderCtxMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setFolderCtxMenu(null); setFolderColorPicker(false); }} onContextMenu={(e) => { e.preventDefault(); setFolderCtxMenu(null); }} />
          <div className="fixed z-50 min-w-[160px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800" style={folderCtxMenu.flip ? { bottom: folderCtxMenu.y, left: folderCtxMenu.x } : { top: folderCtxMenu.y, left: folderCtxMenu.x }}>
            <button
              onClick={() => { const f = quizFolders.find((x) => x.id === folderCtxMenu.folderId); if (f) { setRenamingFolderId(f.id); setFolderRenameVal(f.name); } setFolderCtxMenu(null); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >✏️ Byt namn</button>
            <button
              onClick={() => setFolderColorPicker((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-2 text-[13px] text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5"
            >
              <span className="flex items-center gap-3">🎨 Färg</span>
              <span className="text-app-text-secondary/50">{folderColorPicker ? '▾' : '›'}</span>
            </button>
            {folderColorPicker && (
              <div className="flex flex-wrap gap-1.5 px-4 py-2">
                {SET_COLORS.map((c) => {
                  const active = (quizFolders.find((x) => x.id === folderCtxMenu.folderId)?.color ?? '') === c.value;
                  return (
                    <button
                      key={c.name}
                      title={c.name}
                      onClick={() => { setQuizFolderColor(folderCtxMenu.folderId, c.value); setFolderCtxMenu(null); }}
                      className={'flex h-6 w-6 items-center justify-center rounded-full border transition-all ' + (active ? 'border-app-text ring-2 ring-primary/40 dark:border-white' : 'border-app-border dark:border-white/20')}
                      style={c.value ? { backgroundColor: c.value } : undefined}
                    >{!c.value && <span className="text-[10px] text-app-text-secondary">✕</span>}</button>
                  );
                })}
              </div>
            )}
            <div className="my-1 h-px bg-app-border dark:bg-white/10" />
            <button
              onClick={() => { setConfirmDeleteFolderId(folderCtxMenu.folderId); setFolderCtxMenu(null); }}
              className="flex w-full items-center gap-3 px-4 py-2 text-[13px] text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
            >🗑 Ta bort mapp</button>
          </div>
        </>
      )}

      {/* Delete folder confirmation */}
      {confirmDeleteFolderId && (() => {
        const f = quizFolders.find((x) => x.id === confirmDeleteFolderId);
        return (
          <ConfirmDialog
            title={lang === 'sv' ? 'Flytta mapp till papperskorgen' : 'Move folder to trash'}
            message={lang === 'sv' ? `Mappen "${f?.name ?? ''}" och dess sets flyttas till papperskorgen.` : `The folder "${f?.name ?? ''}" and its sets will be moved to trash.`}
            confirmLabel={lang === 'sv' ? 'Flytta till papperskorgen' : 'Move to trash'}
            cancelLabel={lang === 'sv' ? 'Avbryt' : 'Cancel'}
            onConfirm={() => { deleteQuizFolder(confirmDeleteFolderId); setSelectedFolderId(null); setSelectedSetId(null); setConfirmDeleteFolderId(null); }}
            onCancel={() => setConfirmDeleteFolderId(null)}
          />
        );
      })()}

      {/* Delete set confirmation */}
      {confirmDeleteSetId && (() => {
        const s = quizSets.find((x) => x.id === confirmDeleteSetId);
        return (
          <ConfirmDialog
            title={lang === 'sv' ? 'Flytta set till papperskorgen' : 'Move set to trash'}
            message={lang === 'sv' ? `Setet "${s?.name ?? ''}" flyttas till papperskorgen och kan återställas senare.` : `The set "${s?.name ?? ''}" will be moved to trash and can be restored later.`}
            confirmLabel={lang === 'sv' ? 'Flytta till papperskorgen' : 'Move to trash'}
            cancelLabel={lang === 'sv' ? 'Avbryt' : 'Cancel'}
            onConfirm={() => {
              if (selectedSetId === confirmDeleteSetId) setSelectedSetId(null);
              deleteQuizSet(confirmDeleteSetId);
              setConfirmDeleteSetId(null);
            }}
            onCancel={() => setConfirmDeleteSetId(null)}
          />
        );
      })()}
    </div>
  );
}
