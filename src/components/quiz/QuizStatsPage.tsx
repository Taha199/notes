import { useNotes } from '../../contexts/NotesContext';
import { QuizStatsPanel } from './QuizStatsPanel';

/** Full-page quiz statistics (sidebar entry under Nedräkning). */
export function QuizStatsPage({
  onOpenQuiz,
}: {
  onOpenQuiz?: (itemId: number, setId?: string | null, folderId?: string | null) => void;
}) {
  const { quizzes, quizSets, quizFolders } = useNotes();
  return (
    <div className="bg-app-bg p-3 dark:bg-white/[0.03] sm:p-5">
      <div className="mx-auto max-w-5xl">
        <QuizStatsPanel
          quizzes={quizzes}
          quizSets={quizSets}
          quizFolders={quizFolders}
          variant="page"
          onOpenQuiz={onOpenQuiz}
        />
      </div>
    </div>
  );
}
