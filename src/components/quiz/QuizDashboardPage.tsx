import { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import {
  buildQuizDashboardRows,
  saveQuizSelection,
  type QuizDashboardRow,
  type QuizStudyStatus,
} from '../../lib/quizProgress';

const STATUS_OPTS: QuizStudyStatus[] = ['notStarted', 'started', 'done'];

function formatCreatedAt(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Column({
  title,
  hint,
  rows,
  empty,
  accent,
  onOpen,
  onMove,
  questionsLabel,
  createdLabel,
  statusLabels,
  locale,
}: {
  title: string;
  hint: string;
  rows: QuizDashboardRow[];
  empty: string;
  accent: string;
  onOpen: (row: QuizDashboardRow) => void;
  onMove: (row: QuizDashboardRow, status: QuizStudyStatus) => void;
  questionsLabel: (n: number) => string;
  createdLabel: string;
  statusLabels: Record<QuizStudyStatus, string>;
  locale: string;
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
          rows.map((row) => {
            const created = formatCreatedAt(row.createdAt, locale);
            return (
              <div
                key={row.id}
                className="rounded-xl border border-transparent px-2.5 py-2 transition hover:border-primary/20 hover:bg-primary/[0.04] dark:hover:bg-primary/10"
              >
                <button
                  type="button"
                  onClick={() => onOpen(row)}
                  className="flex w-full flex-col gap-0.5 text-left"
                >
                  <span className="text-[13.5px] font-semibold leading-snug text-app-text dark:text-gray-100">
                    {row.name}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-app-text-secondary">
                    {row.folderName && (
                      <span className="truncate font-medium text-app-text-secondary/80">{row.folderName}</span>
                    )}
                    <span className="tabular-nums">{questionsLabel(row.total)}</span>
                    {created && (
                      <span className="tabular-nums text-app-text-secondary/70">
                        {createdLabel} {created}
                      </span>
                    )}
                  </span>
                </button>
                <div className="mt-1.5 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                  {STATUS_OPTS.map((status) => {
                    const active = row.status === status;
                    const tone =
                      status === 'notStarted'
                        ? active
                          ? 'border-sky-500 bg-sky-500 text-white'
                          : 'border-sky-200/80 bg-sky-50/80 text-sky-800 hover:border-sky-400 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200'
                        : status === 'started'
                          ? active
                            ? 'border-amber-500 bg-amber-500 text-white'
                            : 'border-amber-200/80 bg-amber-50/80 text-amber-900 hover:border-amber-400 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200'
                          : active
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-emerald-200/80 bg-emerald-50/80 text-emerald-900 hover:border-emerald-400 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200';
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={active}
                        onClick={() => onMove(row, status)}
                        className={
                          'rounded-lg border px-2 py-0.5 text-[10px] font-semibold transition disabled:cursor-default ' +
                          tone
                        }
                        title={statusLabels[status]}
                      >
                        {statusLabels[status]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
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
  const { t, lang } = useLanguage();
  const { quizSets, quizFolders, setQuizSetDashboardStatus } = useNotes();
  const locale = lang === 'sv' ? 'sv-SE' : 'en-GB';

  const columns = useMemo(
    () => buildQuizDashboardRows(quizSets, quizFolders),
    [quizSets, quizFolders],
  );

  const openRow = (row: QuizDashboardRow) => {
    saveQuizSelection(row.folderId, row.id);
    onOpenSet(row.id, row.folderId);
  };

  const moveRow = (row: QuizDashboardRow, status: QuizStudyStatus) => {
    if (row.status === status) return;
    setQuizSetDashboardStatus(row.id, status);
  };

  const questionsLabel = (n: number) =>
    `${n} ${n === 1 ? t.quizQuestionOne : t.quizQuestionMany}`;

  const statusLabels: Record<QuizStudyStatus, string> = {
    notStarted: t.quizDashNotStarted,
    started: t.quizDashStarted,
    done: t.quizDashDone,
  };

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
          {(STATUS_OPTS).map((key) => (
            <Column
              key={key}
              title={meta[key].title}
              hint={meta[key].hint}
              accent={meta[key].accent}
              rows={columns[key]}
              empty={t.quizDashEmpty}
              onOpen={openRow}
              onMove={moveRow}
              questionsLabel={questionsLabel}
              createdLabel={t.quizDashCreated}
              statusLabels={statusLabels}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
