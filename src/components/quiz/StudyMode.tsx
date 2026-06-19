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

interface Props {
  title: string;
  items: QuizItem[];
  mode: 'flashcard' | 'written';
  initialProgress?: Record<number, 'known' | 'learning'>;
  onClose: () => void;
  onSaveProgress: (p: Record<number, 'known' | 'learning'>) => void;
}

export function StudyMode({ title, items, mode, initialProgress = {}, onClose, onSaveProgress }: Props) {
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

  const current = deck[index];

  useEffect(() => {
    setFlipped(false);
    setInput('');
    setRevealed(false);
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
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{mode === 'flashcard' ? '🃏 Flashcards' : '✏️ Written'}</p>
          <p className="text-[11px] text-app-text-secondary dark:text-gray-500 truncate max-w-[180px]">{title}</p>
        </div>
        <span className="text-[12px] font-semibold text-app-text-secondary dark:text-gray-400">{index + 1}/{deck.length}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-app-border dark:bg-white/10">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${((index) / deck.length) * 100}%` }} />
      </div>

      {/* Card area */}
      <div className="flex flex-1 flex-col items-center justify-center p-6 overflow-y-auto">
        {mode === 'flashcard' ? (
          <div className="w-full max-w-2xl flex flex-col items-center">
            {/* Flip card */}
            <div className="w-full cursor-pointer" style={{ perspective: '1200px' }} onClick={() => setFlipped((f) => !f)}>
              <div style={{ transformStyle: 'preserve-3d', transition: 'transform 0.5s cubic-bezier(.4,0,.2,1)', transform: flipped ? 'rotateY(180deg)' : 'none', position: 'relative', minHeight: '240px' }}>
                {/* Front */}
                <div style={{ backfaceVisibility: 'hidden' }} className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-app-border bg-white p-8 shadow-lg dark:border-white/10 dark:bg-gray-800">
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-app-text-secondary/50">Question</p>
                  <div className="text-center text-lg font-semibold leading-relaxed text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.question) }} />
                  <p className="mt-6 text-[11px] text-app-text-secondary/40 dark:text-gray-600">Tap to reveal answer</p>
                </div>
                {/* Back */}
                <div style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }} className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-primary/30 bg-primary/5 p-8 shadow-lg dark:border-primary/20 dark:bg-primary/10">
                  <p className="mb-4 text-[10px] font-bold uppercase tracking-widest text-primary/60">Answer</p>
                  <div className="text-center text-lg leading-relaxed text-app-text dark:text-gray-100" dangerouslySetInnerHTML={{ __html: mdToHtml(current.answer) }} />
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
    </div>
  );
}
