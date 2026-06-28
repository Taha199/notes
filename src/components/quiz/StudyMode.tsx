import { useState, useEffect } from 'react';
import type { QuizItem } from '../../types';

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

// For MCQ items the question stores the stem with an appended options block —
// strip it so the card shows just the stem above the clickable choices.
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
  lang?: 'sv' | 'en';
}

export function StudyMode({ title, items, mode, initialProgress = {}, onClose, onSaveProgress, allItems, lang = 'sv' }: Props) {
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
  const [chooserOpen, setChooserOpen] = useState(false);

  const pool = allItems ?? items;
  const pickScope = (subset: QuizItem[]) => {
    if (!subset.length) return;
    setDeck(shuffleArr(subset));
    setIndex(0);
    setDone(false);
    setSessionKnown(new Set());
    setSessionLearning(new Set());
    setChooserOpen(false);
  };

  const current = deck[index];

  useEffect(() => {
    setFlipped(false);
    setInput('');
    setRevealed(false);
    setSelectedOpt(null);
  }, [index]);

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
          {sessionLearning.size === 0 ? 'All done!' : `Round ${round} complete`}
        </h2>
        <p className="mb-2 text-app-text-secondary dark:text-gray-400">{pct}% correct</p>
        <div className="mb-6 flex gap-6">
          <span className="text-emerald-600 font-semibold">✓ {sessionKnown.size} known</span>
          <span className="text-red-500 font-semibold">✗ {sessionLearning.size} learning</span>
        </div>
        <div className="flex gap-3">
          {sessionLearning.size > 0 && (
            <button onClick={restartDontKnow} className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">
              Study {sessionLearning.size} more →
            </button>
          )}
          <button onClick={onClose} className="rounded-xl border border-app-border px-6 py-2.5 text-sm font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400">
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-app-border px-4 py-3 dark:border-white/10">
        <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">✕</button>
        <div className="text-center">
          {mode === 'flashcard' && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary">🃏 Flashcards</p>
          )}
          <p className={'truncate max-w-[180px] text-app-text dark:text-gray-100 ' + (mode === 'flashcard' ? 'text-[11px] text-app-text-secondary dark:text-gray-500' : 'text-[13px] font-semibold')}>{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChooserOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-app-border px-2.5 py-1.5 text-[11px] font-semibold text-app-text-secondary transition hover:bg-app-bg dark:border-white/10 dark:text-gray-400 dark:hover:bg-white/10"
            title={lang === 'sv' ? 'Välj frågor' : 'Choose questions'}
          >🎯 {lang === 'sv' ? 'Välj' : 'Pick'}</button>
          <span className="text-[12px] font-semibold text-app-text-secondary dark:text-gray-400">{index + 1}/{deck.length}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-app-border dark:bg-white/10">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((index) / deck.length) * 100}%` }} />
      </div>

      {/* Card area */}
      <div className="relative flex flex-1 flex-col items-center justify-center p-6 overflow-y-auto">
        {/* Large side navigation arrows */}
        <button
          onClick={goPrev}
          disabled={index === 0}
          className="absolute left-3 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-app-border bg-white/90 text-3xl text-app-text-secondary shadow-lg backdrop-blur transition hover:scale-105 hover:text-primary disabled:pointer-events-none disabled:opacity-25 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 sm:left-6 sm:h-16 sm:w-16"
          title="Föregående"
          aria-label="Föregående"
        >‹</button>
        <button
          onClick={goNext}
          disabled={index >= deck.length - 1}
          className="absolute right-3 top-1/2 z-10 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border border-app-border bg-white/90 text-3xl text-app-text-secondary shadow-lg backdrop-blur transition hover:scale-105 hover:text-primary disabled:pointer-events-none disabled:opacity-25 dark:border-white/10 dark:bg-white/10 dark:text-gray-300 sm:right-6 sm:h-16 sm:w-16"
          title="Nästa"
          aria-label="Nästa"
        >›</button>
        {mode === 'flashcard' ? (
          current.options && current.options.length ? (
            /* MCQ card — clickable choices */
            <div className="w-full max-w-2xl flex flex-col items-center">
              <div className="w-full rounded-[28px] p-8 shadow-2xl ring-1 ring-white/10" style={{ background: 'linear-gradient(160deg,#26304f 0%,#1b2440 60%,#161d36 100%)' }}>
                <p className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300/70">Fråga</p>
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
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-300/80">Förklaring</p>
                    <div dir="auto" className="text-[14px] leading-relaxed text-amber-100/90 [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.explanation) }} />
                  </div>
                )}
              </div>
              <div className="mt-6 flex gap-4">
                {selectedOpt === null ? (
                  <button onClick={() => saveAndNext(false)} className="rounded-xl border border-app-border px-8 py-2.5 text-sm font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:text-gray-400">
                    Hoppa över
                  </button>
                ) : (
                  <button onClick={() => { const ci = current.correctIndexes ?? (current.correctIndex !== undefined ? [current.correctIndex] : [0]); saveAndNext(selectedOpt !== null && ci.includes(selectedOpt)); }} className="rounded-xl bg-primary px-10 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">
                    Nästa →
                  </button>
                )}
              </div>
            </div>
          ) : (
          <div className="w-full max-w-3xl flex flex-col items-center">
            {/* Flip card — Quizlet-style polished card */}
            <div className="w-full cursor-pointer select-none" style={{ perspective: '1600px' }} onClick={() => setFlipped((f) => !f)}>
              <div style={{ transformStyle: 'preserve-3d', transition: 'transform 0.55s cubic-bezier(.4,0,.2,1)', transform: flipped ? 'rotateY(180deg)' : 'none', position: 'relative', minHeight: '380px' }}>
                {/* Front */}
                <div
                  style={{ backfaceVisibility: 'hidden', background: 'linear-gradient(160deg,#26304f 0%,#1b2440 60%,#161d36 100%)' }}
                  className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-[28px] p-10 shadow-2xl ring-1 ring-white/10 [&_img]:my-3 [&_img]:max-h-52 [&_img]:rounded-xl"
                >
                  <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-300/70">Fråga</p>
                  <div dir="auto" className="mx-auto w-full max-w-xl px-4 text-center text-[22px] font-semibold leading-relaxed text-white [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
                  <p className="mt-8 text-[12px] text-white/35">Tryck för att se svaret</p>
                </div>
                {/* Back */}
                <div
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)', background: 'linear-gradient(160deg,#1f3a36 0%,#17312f 55%,#13262a 100%)' }}
                  className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-[28px] p-10 shadow-2xl ring-1 ring-white/10 [&_img]:my-3 [&_img]:max-h-52 [&_img]:rounded-xl"
                >
                  <p className="mb-6 text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-300/70">Svar</p>
                  <div dir="auto" className="mx-auto w-full max-w-xl px-4 text-center text-[20px] leading-relaxed text-white [overflow-wrap:anywhere]" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                </div>
              </div>
            </div>

            <div className="mt-8 flex gap-4">
              {!flipped ? (
                <button onClick={() => setFlipped(true)} className="rounded-xl bg-primary px-10 py-3 text-sm font-semibold text-white hover:bg-primary-dark">
                  Flip card
                </button>
              ) : (
                <>
                  <button onClick={() => saveAndNext(false)} className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-8 py-3 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                    ✗ Don't Know
                  </button>
                  <button onClick={() => saveAndNext(true)} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-8 py-3 text-sm font-semibold text-white hover:bg-emerald-600">
                    ✓ Know It
                  </button>
                </>
              )}
            </div>
          </div>
          )
        ) : (
          /* Written mode */
          <div className="w-full max-w-2xl">
            <div className="mb-4 rounded-2xl border border-app-border bg-white p-6 shadow-lg dark:border-white/10 dark:bg-gray-800">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-app-text-secondary/50">Question</p>
              <div className="text-lg font-semibold leading-relaxed text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
            </div>

            {!revealed ? (
              <>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setRevealed(true); } }}
                  placeholder="Type your answer... (Enter to check)"
                  rows={3}
                  autoFocus
                  className="w-full resize-none rounded-xl border border-app-border bg-white px-4 py-3 text-[14px] text-app-text outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
                />
                <button onClick={() => setRevealed(true)} className="mt-3 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white hover:bg-primary-dark">
                  Check Answer
                </button>
              </>
            ) : (
              <>
                {input && (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-blue-600">Your Answer</p>
                    <p className="text-[13px] text-app-text dark:text-gray-200">{input}</p>
                  </div>
                )}
                <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">Correct Answer</p>
                  <div className="text-[13px] leading-relaxed text-app-text dark:text-gray-200" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => saveAndNext(false)} className="flex-1 rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10">
                    ✗ Incorrect
                  </button>
                  <button onClick={() => saveAndNext(true)} className="flex-1 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-600">
                    ✓ Correct
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom stats */}
      <div className="flex items-center justify-center gap-8 border-t border-app-border px-4 py-3 dark:border-white/10">
        <span className="text-[12px] font-semibold text-red-500">✗ {sessionLearning.size}</span>
        <span className="text-[11px] text-app-text-secondary/40">{deck.length - index - 1} remaining</span>
        <span className="text-[12px] font-semibold text-emerald-500">✓ {sessionKnown.size}</span>
      </div>

      {/* In-session scope chooser */}
      {chooserOpen && (() => {
        const known = pool.filter((it) => progress[it.id] === 'known');
        const learning = pool.filter((it) => progress[it.id] === 'learning');
        const fresh = pool.filter((it) => !progress[it.id]);
        const scopes = [
          { key: 'all', label: lang === 'sv' ? 'Alla frågor' : 'All questions', items: pool, cls: 'text-app-text dark:text-gray-100' },
          { key: 'new', label: lang === 'sv' ? 'Ej studerade' : 'Not studied', items: fresh, cls: 'text-app-text-secondary' },
          { key: 'learning', label: lang === 'sv' ? 'Kan inte (fel)' : "Don't know", items: learning, cls: 'text-red-500' },
          { key: 'known', label: lang === 'sv' ? 'Kan (rätt)' : 'Known', items: known, cls: 'text-emerald-500' },
        ];
        return (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm" onClick={() => setChooserOpen(false)}>
            <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-app-border px-5 py-3.5 dark:border-white/10">
                <p className="text-[13px] font-semibold text-app-text dark:text-gray-100">
                  {mode === 'flashcard' ? '🃏 Flashcards' : title} — {lang === 'sv' ? 'vad vill du plugga?' : 'what to study?'}
                </p>
                <button onClick={() => setChooserOpen(false)} className="text-app-text-secondary/50 hover:text-app-text">✕</button>
              </div>
              <div className="flex flex-col p-2">
                {scopes.map((s) => (
                  <button
                    key={s.key}
                    disabled={s.items.length === 0}
                    onClick={() => pickScope(s.items)}
                    className="flex items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-app-bg disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/5"
                  >
                    <span className={'text-[14px] font-medium ' + s.cls}>{s.label}</span>
                    <span className="rounded-full bg-app-bg px-2.5 py-0.5 text-[11px] font-semibold text-app-text-secondary/70 dark:bg-white/10">{s.items.length}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
