import { useMemo } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import {
  collectQuizItemsForStats,
  countQuestionsByDay,
  countQuestionsByMonth,
  lastNMonthKeys,
  maxCount,
  sumMonthKeys,
  toDayKey,
} from '../../lib/quizStats';

function capitalizeLabel(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

/** Summary page: total questions, created today, and last 12 months. */
export function QuizOverviewPage() {
  const { t, lang } = useLanguage();
  const { quizzes, quizSets } = useNotes();
  const locale = lang === 'sv' ? 'sv-SE' : 'en-GB';

  const items = useMemo(
    () => collectQuizItemsForStats(quizzes, quizSets),
    [quizzes, quizSets],
  );
  const byDay = useMemo(() => countQuestionsByDay(items), [items]);
  const byMonth = useMemo(() => countQuestionsByMonth(items), [items]);

  const todayKey = toDayKey(Date.now());
  const todayCount = todayKey ? (byDay.get(todayKey) ?? 0) : 0;
  const monthKeys = useMemo(() => lastNMonthKeys(12), []);
  const last12Total = sumMonthKeys(byMonth, monthKeys);

  const monthRows = useMemo(() => {
    return monthKeys.map((key) => {
      const [y, m] = key.split('-').map(Number);
      const label = capitalizeLabel(
        new Date(y!, m! - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
      );
      return { key, label, count: byMonth.get(key) ?? 0 };
    });
  }, [monthKeys, byMonth, locale]);

  const yMax = Math.max(1, maxCount(monthRows.map((r) => r.count)));

  return (
    <div className="bg-app-bg p-3 dark:bg-white/[0.03] sm:p-5">
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]">
          <div className="border-b border-app-border px-4 py-3 dark:border-white/10">
            <h2 className="text-[15px] font-bold text-app-text dark:text-gray-100">{t.quizOverviewTitle}</h2>
            <p className="mt-0.5 text-[11px] text-app-text-secondary dark:text-gray-400">
              {t.quizOverviewSubtitle}
            </p>
          </div>

          <div className="px-4 py-4">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">
                  {t.quizOverviewTotal}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-app-text dark:text-gray-100">
                  {items.length}
                </p>
              </div>
              <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">
                  {t.quizOverviewToday}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-primary">{todayCount}</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-app-border bg-white p-3 dark:border-white/10 dark:bg-gray-950/40">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">
                    {t.quizOverviewLast12Months}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-app-text dark:text-gray-100">
                    {last12Total}
                  </p>
                </div>
                <p className="pb-0.5 text-[11px] text-app-text-secondary/60">
                  {monthRows[0]?.label} – {monthRows[monthRows.length - 1]?.label}
                </p>
              </div>

              <div className="space-y-1.5">
                {monthRows.map((row) => {
                  const w = row.count > 0 ? Math.max(6, (row.count / yMax) * 100) : 0;
                  return (
                    <div key={row.key} className="flex items-center gap-2.5">
                      <span className="w-[7.5rem] shrink-0 truncate text-[12px] font-semibold text-app-text dark:text-gray-200 sm:w-40">
                        {row.label}
                      </span>
                      <div className="h-2.5 min-w-0 flex-1 rounded-full bg-app-bg dark:bg-white/5">
                        <div
                          className="h-full rounded-full bg-primary/80 transition-all"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums text-app-text dark:text-gray-100">
                        {row.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
