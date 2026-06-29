import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { QuizItem } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';

function mdToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function shuffleArr<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5);
}

function stemOnly(html: string): string {
  return html.replace(/<div style="margin-top:6px">[\s\S]*$/, '');
}

const MCQ_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

interface Props {
  title: string;
  items: QuizItem[];
  mode: 'flashcard' | 'written';
  initialProgress?: Record<number, 'known' | 'learning'>;
  onClose: () => void;
  onSaveProgress: (p: Record<number, 'known' | 'learning'>) => void;
  allItems?: QuizItem[];
}

export function StudyMode({ title, items, mode, initialProgress = {}, onClose, onSaveProgress, allItems }: Props) {
  const { t } = useLanguage();
  const fmt = (s: string, n: number) => s.replace('{n}', String(n));

  const [deck, setDeck] = useState(() => shuffleArr(items));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [progress, setProgress] = useState<Record<number, 'known' | 'learning'>>(initialProgress);
  const [input, setInput] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [sessionKnown, setSessionKnown] = useState<Set<number>>(new Set());
  const [sessionLearning, setSessionLearning] = useState<Set<number>>(new Set());
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(1);
  const [selectedOpt, setSelectedOpt] = useState<number | null>(null);
  const [scopeKey, setScopeKey] = useState('all');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const scopeBtnRef = useRef<HTMLButtonElement>(null);
  const scopeMenuRef = useRef<HTMLDivElement>(null);

  const pool = allItems ?? items;
  const scopes = [
    { key: 'all', label: t.quizStudyScopeAll, items: pool },
    { key: 'new', label: t.quizStudyScopeNew, items: pool.filter((it) => !progress[it.id]) },
    { key: 'learning', label: t.quizStudyScopeLearning, items: pool.filter((it) => progress[it.id] === 'learning') },
    { key: 'known', label: t.quizStudyScopeKnown, items: pool.filter((it) => progress[it.id] === 'known') },
  ];

  const pickScope = (subset: QuizItem[], key: string) => {
    if (!subset.length) return;
    setScopeKey(key);
    setDeck(shuffleArr(subset));
    setIndex(0);
    setDone(false);
    setSessionKnown(new Set());
    setSessionLearning(new Set());
  };

  const current = deck[index];

  useEffect(() => {
    setFlipped(false);
    setInput('');
    setRevealed(false);
    setSelectedOpt(null);
  }, [index]);

  useEffect(() => {
    if (!scopeMenuOpen) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (scopeMenuRef.current?.contains(target) || scopeBtnRef.current?.contains(target)) return;
      setScopeMenuOpen(false);
      setMenuPos(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [scopeMenuOpen]);

  useLayoutEffect(() => {
    if (!scopeMenuOpen) return;
    const updatePos = () => {
      const btn = scopeBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [scopeMenuOpen]);

  const toggleScopeMenu = () => {
    setScopeMenuOpen((open) => {
      if (open) {
        setMenuPos(null);
        return false;
      }
      const btn = scopeBtnRef.current;
      if (btn) {
        const r = btn.getBoundingClientRect();
        setMenuPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
      }
      return true;
    });
  };

  const saveAndNext = (isKnown: boolean) => {
    if (!current) return;
    const newProg = { ...progress, [current.id]: isKnown ? 'known' as const : 'learning' as const };
    setProgress(newProg);
    onSaveProgress(newProg);
    if (isKnown) setSessionKnown((s) => new Set([...s, current.id]));
    else setSessionLearning((s) => new Set([...s, current.id]));

    if (index + 1 >= deck.length) setDone(true);
    else setIndex((i) => i + 1);
  };

  const goPrev = () => setIndex((i) => Math.max(0, i - 1));
  const goNext = () => setIndex((i) => Math.min(deck.length - 1, i + 1));

  const restartDontKnow = () => {
    const retry = items.filter((i) => sessionLearning.has(i.id));
    if (!retry.length) return;
    setDeck(shuffleArr(retry));
    setIndex(0);
    setDone(false);
    setRound((r) => r + 1);
    setSessionLearning(new Set());
  };

  if (done) {
    const pct = Math.round((sessionKnown.size / (sessionKnown.size + sessionLearning.size)) * 100) || 100;
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white p-6 dark:bg-gray-950">
        <div className="mb-4 text-6xl">{sessionLearning.size === 0 ? '🎉' : '📚'}</div>
        <h2 className="mb-1 text-2xl font-bold text-app-text dark:text-gray-100">
          {sessionLearning.size === 0 ? t.quizStudyAllDone : fmt(t.quizStudyRoundComplete, round)}
        </h2>
        <p className="mb-2 text-app-text-secondary dark:text-gray-400">{fmt(t.quizStudyPercentCorrect, pct)}</p>
        <div className="mb-6 flex gap-6">
          <span className="font-semibold text-emerald-600">{fmt(t.quizStudyKnownCount, sessionKnown.size)}</span>
          <span className="font-semibold text-red-500">{fmt(t.quizStudyLearningCount, sessionLearning.size)}</span>
        </div>
        <div className="flex gap-3">
          {sessionLearning.size > 0 && (
            <button onClick={restartDontKnow} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">
              {fmt(t.quizStudyMoreBtn, sessionLearning.size)}
            </button>
          )}
          <button onClick={onClose} className="rounded-xl border border-app-border px-6 py-2.5 text-sm font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400">
            {t.quizStudyClose}
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const activeScope = scopes.find((s) => s.key === scopeKey) ?? scopes[0];
  const scopeLabelCls = (key: string) =>
    key === 'learning' ? 'text-red-500' : key === 'known' ? 'text-emerald-600' : key === 'new' ? 'text-app-text-secondary dark:text-gray-400' : 'text-app-text dark:text-gray-100';

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-gray-950">
      <div className="relative z-30 overflow-visible flex items-center justify-between border-b border-app-border px-4 py-3 dark:border-white/10">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">✕</button>
        <div className="text-center">
          {mode === 'flashcard' && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{t.quizFlashcards}</p>
          )}
          <p className={'truncate max-w-[180px] text-app-text dark:text-gray-100 ' + (mode === 'flashcard' ? 'text-[11px] text-app-text-secondary dark:text-gray-500' : 'text-[13px] font-semibold')}>{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              ref={scopeBtnRef}
              type="button"
              onClick={toggleScopeMenu}
              title={t.quizStudyChooseQuestions}
              aria-expanded={scopeMenuOpen}
              className="flex max-w-[148px] items-center gap-1.5 rounded-xl border border-app-border bg-white/90 px-2.5 py-1.5 text-[11px] font-semibold text-app-text shadow-sm backdrop-blur-sm transition hover:border-primary/35 hover:shadow-md dark:border-white/10 dark:bg-gray-900/90 dark:text-gray-200 sm:max-w-[176px]"
            >
              <span className="min-w-0 truncate">{activeScope.label}</span>
              <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-primary">{activeScope.items.length}</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={'shrink-0 text-app-text-secondary/60 transition-transform duration-200 ' + (scopeMenuOpen ? 'rotate-180' : '')}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
          <span className="text-[12px] font-semibold text-app-text-secondary dark:text-gray-400">{index + 1}/{deck.length}</span>
        </div>
      </div>

      <div className="h-1.5 bg-app-border dark:bg-white/10">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((index) / deck.length) * 100}%` }} />
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center overflow-y-auto p-6">
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-3 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-app-border bg-white/90 text-3xl text-app-text-secondary shadow-lg backdrop-blur transition hover:scale-105 hover:text-primary disabled:pointer-events-none disabled:opacity-25 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 sm:left-6 sm:h-16 sm:w-16"
          title={t.quizStudyPrevious}
          aria-label={t.quizStudyPrevious}
        >‹</button>
        <button
          onClick={goNext}
          disabled={index >= deck.length - 1}
          className="absolute right-3 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-app-border bg-white/90 text-3xl text-app-text-secondary shadow-lg backdrop-blur transition hover:scale-105 hover:text-primary disabled:pointer-events-none disabled:opacity-25 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 sm:right-6 sm:h-16 sm:w-16"
          title={t.quizStudyNext}
          aria-label={t.quizStudyNext}
        >›</button>
        {mode === 'flashcard' ? (
          current.options && current.options.length ? (
            <div className="w-full max-w-2xl flex flex-col items-center">
              <div className="w-full rounded-[28px] p-8 shadow-2xl ring-1 ring-white/10" style={{ background: 'linear-gradient(160deg,#26304f 0%,#1b2440 60%,#161d36 100%)' }}>
                <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300/70">{t.quizQuestionLabel}</p>
                <div dir="auto" className="mx-auto mb-6 w-full max-w-xl text-center text-[20px] font-semibold leading-relaxed text-white [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(stemOnly(current.question)) }} />
                <div className="mx-auto flex w-full max-w-xl flex-col gap-2.5">
                  {current.options.map((opt, i) => {
                    const correctIndexes = current.correctIndexes ?? (current.correctIndex !== undefined ? [current.correctIndex] : [0]);
                    const isCorrect = correctIndexes.includes(i);
                    const chosen = selectedOpt === i;
                    const answered = selectedOpt !== null;
                    let cls = 'border-white/15 bg-white/5 text-white hover:bg-white/10';
                    if (answered) {
                      if (isCorrect) cls = 'border-emerald-400 bg-emerald-500/20 text-white';
                      else if (chosen) cls = 'border-red-400 bg-red-500/20 text-white';
                      else cls = 'border-white/10 bg-white/[0.03] text-white/50';
                    }
                    return (
                      <button
                        key={i}
                        disabled={answered}
                        onClick={() => setSelectedOpt(i)}
                        className={'flex items-center gap-3 rounded-2xl border px-4 py-3 text-left text-[15px] transition-all ' + cls}
                      >
                        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-[12px] font-bold">{MCQ_LETTERS[i]}</span>
                        <span dir="auto" className="flex-1 [overflow-wrap:anywhere]">{opt}</span>
                        {answered && isCorrect && <span className="text-emerald-300">✓</span>}
                        {answered && chosen && !isCorrect && <span className="text-red-300">✗</span>}
                      </button>
                    );
                  })}
                </div>
                {selectedOpt !== null && current.explanation && (
                  <div className="mx-auto mt-5 w-full max-w-xl rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">{t.quizExplanationLabel}</p>
                    <div dir="auto" className="text-[14px] leading-relaxed text-amber-100/90 [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.explanation) }} />
                  </div>
                )}
              </div>
              <div className="mt-6 flex gap-4">
                {selectedOpt === null ? (
                  <button onClick={() => saveAndNext(false)} className="rounded-xl border border-app-border px-8 py-2.5 text-sm font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400">
                    {t.quizStudySkip}
                  </button>
                ) : (
                  <button onClick={() => { const ci = current.correctIndexes ?? (current.correctIndex !== undefined ? [current.correctIndex] : [0]); saveAndNext(selectedOpt !== null && ci.includes(selectedOpt)); }} className="rounded-xl bg-primary px-10 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">
                    {t.quizStudyNextArrow}
                  </button>
                )}
              </div>
            </div>
          ) : (
          <div className="w-full max-w-4xl flex flex-col items-center">
            <div className="w-full" style={{ perspective: '1600px' }}>
              <div style={{ transformStyle: 'preserve-3d', transition: 'transform 0.55s cubic-bezier(.4,0,.2,1)', transform: flipped ? 'rotateY(180deg)' : 'none', position: 'relative', minHeight: flipped ? '460px' : '420px' }}>
                <div
                  style={{ backfaceVisibility: 'hidden', background: 'linear-gradient(160deg,#26304f 0%,#1b2440 60%,#161d36 100%)' }}
                  className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-[28px] p-8 shadow-2xl ring-1 ring-white/10 sm:p-10 [&_img]:my-3 [&_img]:max-h-52 [&_img]:rounded-xl"
                >
                  <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300/70">{t.quizQuestionLabel}</p>
                  <div dir="auto" className="mx-auto w-full max-w-xl px-2 text-center text-[22px] font-semibold leading-relaxed text-white [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setFlipped(true); } }}
                    placeholder={t.quizStudyTypeAnswerPh}
                    rows={4}
                    className="mt-6 w-full max-w-xl resize-none rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-[14px] leading-relaxed text-white placeholder:text-white/30 outline-none focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-400/20"
                  />
                </div>
                <div
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: 'linear-gradient(160deg,#1f3a36 0%,#17312f 55%,#13262a 100%)' }}
                  className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-[28px] p-6 shadow-2xl ring-1 ring-white/10 sm:p-8 [&_img]:my-2 [&_img]:max-h-40 [&_img]:rounded-xl"
                >
                  <div className="grid w-full max-w-3xl gap-4 md:grid-cols-2">
                    <div className="flex min-h-[140px] flex-col rounded-2xl border border-blue-400/35 bg-blue-500/10 p-4 text-left">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-blue-300/90">{t.quizStudyYourAnswer}</p>
                      <p dir="auto" className={'flex-1 text-[15px] leading-relaxed [overflow-wrap:anywhere] ' + (input.trim() ? 'text-white' : 'italic text-white/40')}>
                        {input.trim() || t.quizStudyNoAnswer}
                      </p>
                    </div>
                    <div className="flex min-h-[140px] flex-col rounded-2xl border border-emerald-400/35 bg-emerald-500/10 p-4 text-left">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300/90">{t.quizStudyCorrectAnswer}</p>
                      <div dir="auto" className="flex-1 text-[15px] leading-relaxed text-white [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => setFlipped((f) => !f)}
                className={'rounded-xl px-8 py-3 text-sm font-semibold shadow-sm transition ' + (flipped
                  ? 'border border-app-border bg-white text-app-text hover:bg-app-bg dark:border-white/10 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-white/10'
                  : 'bg-primary text-white hover:bg-primary-dark')}
              >
                {flipped ? `↩ ${t.quizStudyFlipBack}` : t.quizStudyFlipCard}
              </button>
              {flipped && (
                <>
                  <button onClick={() => saveAndNext(false)} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-8 py-3 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                    ✗ {t.quizStudyDontKnow}
                  </button>
                  <button onClick={() => saveAndNext(true)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3 text-sm font-semibold text-white hover:bg-emerald-600">
                    ✓ {t.quizStudyKnowIt}
                  </button>
                </>
              )}
            </div>
          </div>
          )
        ) : (
          <div className="w-full max-w-2xl">
            <div className="mb-4 rounded-2xl border border-app-border bg-white p-6 shadow-lg dark:border-white/10 dark:bg-gray-800">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-app-text-secondary/50">{t.quizQuestionLabel}</p>
              <div className="text-lg font-semibold leading-relaxed text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
            </div>

            {!revealed ? (
              <>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setRevealed(true); } }}
                  placeholder={t.quizStudyTypeAnswerPh}
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl border border-app-border bg-white px-4 py-3 text-[14px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                />
                <button onClick={() => setRevealed(true)} className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark">
                  {t.quizStudyCheckAnswer}
                </button>
              </>
            ) : (
              <>
                {input && (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">{t.quizStudyYourAnswer}</p>
                    <p className="text-[13px] text-app-text dark:text-gray-200">{input}</p>
                  </div>
                )}
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">{t.quizStudyCorrectAnswer}</p>
                  <div className="text-[13px] leading-relaxed text-app-text dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => saveAndNext(false)} className="flex-1 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                    ✗ {t.quizStudyIncorrect}
                  </button>
                  <button onClick={() => saveAndNext(true)} className="flex-1 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600">
                    ✓ {t.quizStudyCorrect}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-8 border-t border-app-border px-4 py-3 dark:border-white/10">
        <span className="text-[12px] font-semibold text-red-500">✗ {sessionLearning.size}</span>
        <span className="text-[11px] text-app-text-secondary/40">{fmt(t.quizStudyRemaining, deck.length - index - 1)}</span>
        <span className="text-[12px] font-semibold text-emerald-500">✓ {sessionKnown.size}</span>
      </div>
      {scopeMenuOpen && menuPos && createPortal(
        <div
          ref={scopeMenuRef}
          className="animate-menu-pop fixed z-[300] w-[228px] origin-top-right overflow-hidden rounded-2xl border border-app-border bg-white p-1.5 shadow-2xl ring-1 ring-black/5 dark:border-white/10 dark:bg-gray-900 dark:ring-white/10"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          <p className="px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-app-text-secondary/50">{t.quizStudyWhatToStudy}</p>
          {scopes.map((s) => {
            const active = scopeKey === s.key;
            return (
              <button
                key={s.key}
                type="button"
                disabled={s.items.length === 0}
                onClick={() => { pickScope(s.items, s.key); setScopeMenuOpen(false); setMenuPos(null); }}
                className={'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ' +
                  (active ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-app-bg dark:hover:bg-white/5')}
              >
                <span className={'min-w-0 flex-1 truncate ' + (active ? '' : scopeLabelCls(s.key))}>{s.label}</span>
                <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ' +
                  (active ? 'bg-primary/15 text-primary' : 'bg-app-bg text-app-text-secondary/70 dark:bg-white/10')}>
                  {s.items.length}
                </span>
                {active && <span className="shrink-0 text-[11px] text-primary">✓</span>}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
