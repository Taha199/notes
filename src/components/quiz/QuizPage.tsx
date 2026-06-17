import { useNotes } from '../../contexts/NotesContext';

export function QuizPage() {
  const { quizzes, deleteQuiz } = useNotes();

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
      <div className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-500">
        🧠 Quiz — {quizzes.length} {quizzes.length === 1 ? 'fråga' : 'frågor'}
      </div>
      <div className="flex flex-col gap-3.5">
        {quizzes.map((q) => (
          <div key={q.id} className="animate-slide-up rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-800/60">
            <div className="mb-1 flex items-start justify-between gap-2">
              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
                📄 {q.noteTitle || 'Note'}
              </span>
              <button
                onClick={() => deleteQuiz(q.id)}
                title="Delete"
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-[11px] text-app-text-secondary/50 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-[14px] font-semibold text-app-text dark:text-gray-100">{q.question}</p>
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Svar</span>
              <p className="mt-0.5 text-[13px] text-app-text dark:text-gray-200">{q.answer}</p>
            </div>
            <p className="mt-2 text-[10px] text-app-text-secondary/60 dark:text-gray-600">{q.date}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
