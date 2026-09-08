import { useNotes } from '../../contexts/NotesContext';
import { QuizStatsPanel } from './QuizStatsPanel';

/** Full-page quiz statistics (sidebar entry under Nedräkning). */
export function QuizStatsPage() {
  const { quizzes, quizSets } = useNotes();
  return (
    <div className="bg-app-bg p-3 dark:bg-white/[0.03] sm:p-5">
      <div className="mx-auto max-w-5xl">
        <QuizStatsPanel quizzes={quizzes} quizSets={quizSets} variant="page" />
      </div>
    </div>
  );
}
