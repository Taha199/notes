import { useState } from 'react';
import { useNotes } from '../../contexts/NotesContext';

function speak(text: string) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'sv-SE';
  window.speechSynthesis.speak(u);
}

export function QuizPage() {
  const { quizzes, deleteQuiz } = useNotes();
  const [favs, setFavs] = useState<Set<number>>(new Set());

  const toggleFav = (id: number) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (!quizzes.length) {
    return (
      <div className="animate-fade-in flex flex-col items-center py-20 text-center text-app-text-secondary/70 dark:text-gray-500">
        <span className="mb-3 text-5xl opacity-30">🧠</span>
        <p className="text-sm">Inga frågor ännu.<br />Öppna en anteckning och klicka på <strong>Generate Quiz</strong>.</p>
      </div>
    );
  }

  return (
    <div className="px-3 py-4 sm:px-5 sm:py-5">
      <div className="mb-3 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
        🧠 Quiz — {quizzes.length} {quizzes.length === 1 ? 'fråga' : 'frågor'}
      </div>
      <div className="flex flex-col gap-2">
        {quizzes.map((q) => (
          <div
            key={q.id}
            className="group flex items-stretch overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm transition-all hover:shadow-md dark:border-white/10 dark:bg-[#1e1e2e]"
          >
            {/* Left — Question */}
            <div className="flex flex-1 items-center px-4 py-4">
              <span className="text-[13px] text-app-text-secondary dark:text-gray-300 leading-snug">
                {q.question}
              </span>
            </div>

            {/* Divider */}
            <div className="w-px flex-shrink-0 bg-app-border dark:bg-white/10" />

            {/* Right — Answer */}
            <div className="flex w-[38%] flex-shrink-0 items-center px-4 py-4 pl-3">
              <span className="text-[14px] font-semibold text-app-text dark:text-gray-100 leading-snug">
                {q.answer}
              </span>
            </div>

            {/* Actions */}
            <div className="flex flex-shrink-0 flex-col items-center justify-between gap-2 px-3 py-3">
              <button
                onClick={() => toggleFav(q.id)}
                className={'text-base transition-colors ' + (favs.has(q.id) ? 'text-amber-400' : 'text-app-text-secondary/40 hover:text-amber-400')}
                title="Favorit"
              >
                ★
              </button>
              <button
                onClick={() => speak(q.question + '. ' + q.answer)}
                className="text-app-text-secondary/40 transition-colors hover:text-primary"
                title="Läs upp"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                </svg>
              </button>
              <button
                onClick={() => deleteQuiz(q.id)}
                className="text-[11px] text-app-text-secondary/30 transition-colors hover:text-red-500"
                title="Ta bort"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
