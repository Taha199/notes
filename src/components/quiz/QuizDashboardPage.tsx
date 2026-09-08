import { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import {
  buildQuizDashboardRows,
  saveQuizSelection,
  type QuizDashboardRow,
  type QuizStudyStatus,
} from '../../lib/quizProgress';

function Column({
  title,
  hint,
  rows,
  empty,
  accent,
  onOpen,
  questionsLabel,
}: {
  title: string;
  hint: string;
  rows: QuizDashboardRow[];
  empty: string;
  accent: string;
  onOpen: (row: QuizDashboardRow) => void;
  questionsLabel: (n: number) => string;
}) {
  return (
    <section className="flex min-h-[18rem] min-w-0 flex-col rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]">
      <div className={'border-b border-app-border px-3 py-3 dark:border-white/10 ' + accent}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold text-app-text dark:text-gray-100">{title}</h3>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold tabular-nums text-app-text dark:bg-black/20 dark:text-gray-100">
            {rows.length}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-app-text-secondary dark:text-gray-400">{hint}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {rows.length === 0 ? (
          <p className="px-2 py-10 text-center text-[13px] text-app-text-secondary/70">{empty}</p>
        ) : (
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpen(row)}
              className="flex w-full flex-col gap-0.5 rounded-xl border border-transparent px-3 py-2.5 text-left transition hover:border-primary/25 hover:bg-primary/5 dark:hover:bg-primary/10"
            >
              <span className="text-[13.5px] font-semibold leading-snug text-app-text dark:text-gray-100">
                {row.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-app-text-secondary">
                {row.folderName && (
                  <span className="truncate font-medium text-app-text-secondary/80">{row.folderName}</span>
                )}
                <span className="tabular-nums">{questionsLabel(row.total)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

export function QuizDashboardPage({
  onOpenSet,
}: {
  onOpenSet: (setId: string, folderId: string | null) => void;
}) {
  const { t } = useLanguage();
  const { quizSets, quizFolders } = useNotes();

  const columns = useMemo(
    () => buildQuizDashboardRows(quizSets, quizFolders),
    [quizSets, quizFolders],
  );

  const openRow = (row: QuizDashboardRow) => {
    saveQuizSelection(row.folderId, row.id);
    onOpenSet(row.id, row.folderId);
  };

  const questionsLabel = (n: number) =>
    `${n} ${n === 1 ? t.quizQuestionOne : t.quizQuestionMany}`;

  const meta: Record<QuizStudyStatus, { title: string; hint: string; accent: string }> = {
    notStarted: {
      title: t.quizDashNotStarted,
      hint: t.quizDashNotStartedHint,
      accent: 'bg-sky-50 dark:bg-sky-500/10',
    },
    started: {
      title: t.quizDashStarted,
      hint: t.quizDashStartedHint,
      accent: 'bg-amber-50 dark:bg-amber-500/10',
    },
    done: {
      title: t.quizDashDone,
      hint: t.quizDashDoneHint,
      accent: 'bg-emerald-50 dark:bg-emerald-500/10',
    },
  };

  return (
    <div className="bg-app-bg p-3 dark:bg-white/[0.03] sm:p-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4">
          <h2 className="text-[17px] font-bold text-app-text dark:text-gray-100">{t.quizDashTitle}</h2>
          <p className="mt-0.5 text-[12px] text-app-text-secondary dark:text-gray-400">
            {t.quizDashSubtitle}
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Column
            title={meta.notStarted.title}
            hint={meta.notStarted.hint}
            accent={meta.notStarted.accent}
            rows={columns.notStarted}
            empty={t.quizDashEmpty}
            onOpen={openRow}
            questionsLabel={questionsLabel}
          />
          <Column
            title={meta.started.title}
            hint={meta.started.hint}
            accent={meta.started.accent}
            rows={columns.started}
            empty={t.quizDashEmpty}
            onOpen={openRow}
            questionsLabel={questionsLabel}
          />
          <Column
            title={meta.done.title}
            hint={meta.done.hint}
            accent={meta.done.accent}
            rows={columns.done}
            empty={t.quizDashEmpty}
            onOpen={openRow}
            questionsLabel={questionsLabel}
          />
        </div>
      </div>
    </div>
  );
}
