import { useMemo, useState } from 'react';
import type { QuizItem, QuizSet } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  buildMonthDayBars,
  buildYearMonthBars,
  collectQuizItemsForStats,
  countQuestionsByDay,
  countQuestionsByMonth,
  currentYearMonth,
  maxCount,
  monthsWithData,
  sumCounts,
  yearsWithData,
} from '../../lib/quizStats';

type Mode = 'month' | 'compareMonths' | 'compareYears';

const SERIES_A = '#534AB7';
const SERIES_B = '#0d9488';

function BarChart({
  labels,
  series,
  maxY,
}: {
  labels: string[];
  series: { label: string; color: string; values: number[] }[];
  maxY: number;
}) {
  const n = labels.length;
  const height = 220;
  const padL = 28;
  const padR = 8;
  const padT = 16;
  const padB = 36;
  const width = Math.max(320, n * (series.length > 1 ? 22 : 14) + padL + padR);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const groupW = innerW / Math.max(n, 1);
  const barW = Math.min(series.length > 1 ? 8 : 12, groupW / (series.length + 1));
  const yMax = Math.max(1, maxY);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="min-w-full"
        role="img"
        aria-label="chart"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * (1 - t);
          const val = Math.round(yMax * t);
          return (
            <g key={t}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-app-border/70 dark:text-white/10"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-app-text-secondary/70 dark:fill-gray-500"
                fontSize={9}
              >
                {val}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const gx = padL + groupW * i + groupW / 2;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = (v / yMax) * innerH;
                const x = gx - (series.length * barW) / 2 + si * barW;
                const y = padT + innerH - h;
                return (
                  <rect
                    key={s.label}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(v > 0 ? 2 : 0, h)}
                    rx={2}
                    fill={s.color}
                    opacity={v > 0 ? 1 : 0.15}
                  >
                    <title>{`${s.label}: ${label} — ${v}`}</title>
                  </rect>
                );
              })}
              {(n <= 16 || i === 0 || i === n - 1 || i % Math.ceil(n / 10) === 0) && (
                <text
                  x={gx}
                  y={height - 12}
                  textAnchor="middle"
                  className="fill-app-text-secondary/80 dark:fill-gray-400"
                  fontSize={9}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function QuizStatsPanel({
  quizzes,
  quizSets,
  onClose,
}: {
  quizzes: QuizItem[];
  quizSets: QuizSet[];
  onClose: () => void;
}) {
  const { t, lang } = useLanguage();
  const locale = lang === 'sv' ? 'sv-SE' : 'en-GB';
  const now = currentYearMonth();

  const items = useMemo(
    () => collectQuizItemsForStats(quizzes, quizSets),
    [quizzes, quizSets],
  );
  const byDay = useMemo(() => countQuestionsByDay(items), [items]);
  const byMonth = useMemo(() => countQuestionsByMonth(items), [items]);
  const yearOptions = useMemo(() => {
    const ys = yearsWithData(byDay);
    if (!ys.includes(now.year)) ys.unshift(now.year);
    return ys.length ? ys : [now.year];
  }, [byDay, now.year]);
  const monthOptions = useMemo(() => {
    const ms = monthsWithData(byDay);
    if (!ms.includes(now.key)) ms.unshift(now.key);
    return ms.length ? ms : [now.key];
  }, [byDay, now.key]);

  const [mode, setMode] = useState<Mode>('month');
  const [monthKey, setMonthKey] = useState(now.key);
  const [compareMonthA, setCompareMonthA] = useState(monthOptions[0] ?? now.key);
  const [compareMonthB, setCompareMonthB] = useState(monthOptions[1] ?? now.key);
  const [compareYearA, setCompareYearA] = useState(yearOptions[0] ?? now.year);
  const [compareYearB, setCompareYearB] = useState(yearOptions[1] ?? now.year - 1);

  const monthParts = monthKey.split('-').map(Number);
  const monthYear = monthParts[0] ?? now.year;
  const monthNum = monthParts[1] ?? now.month;

  const monthBars = useMemo(
    () => buildMonthDayBars(byDay, monthYear, monthNum),
    [byDay, monthYear, monthNum],
  );

  const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    if (!y || !m) return key;
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  };
  const shortMonth = (m: number) =>
    new Date(2000, m - 1, 1).toLocaleDateString(locale, { month: 'short' });

  let chartLabels: string[] = [];
  let chartSeries: { label: string; color: string; values: number[] }[] = [];
  let periodTotal = 0;
  let periodSubtitle = '';

  if (mode === 'month') {
    chartLabels = monthBars.map((b) => String(b.day));
    chartSeries = [{
      label: monthLabel(monthKey),
      color: SERIES_A,
      values: monthBars.map((b) => b.count),
    }];
    periodTotal = sumCounts(monthBars.map((b) => b.count));
    periodSubtitle = monthLabel(monthKey);
  } else if (mode === 'compareMonths') {
    const a = compareMonthA.split('-').map(Number);
    const b = compareMonthB.split('-').map(Number);
    const barsA = buildMonthDayBars(byDay, a[0]!, a[1]!);
    const barsB = buildMonthDayBars(byDay, b[0]!, b[1]!);
    const len = Math.max(barsA.length, barsB.length);
    chartLabels = Array.from({ length: len }, (_, i) => String(i + 1));
    chartSeries = [
      {
        label: monthLabel(compareMonthA),
        color: SERIES_A,
        values: Array.from({ length: len }, (_, i) => barsA[i]?.count ?? 0),
      },
      {
        label: monthLabel(compareMonthB),
        color: SERIES_B,
        values: Array.from({ length: len }, (_, i) => barsB[i]?.count ?? 0),
      },
    ];
    periodTotal = sumCounts(chartSeries[0]!.values) + sumCounts(chartSeries[1]!.values);
    periodSubtitle = `${monthLabel(compareMonthA)} · ${monthLabel(compareMonthB)}`;
  } else {
    const barsA = buildYearMonthBars(byMonth, compareYearA);
    const barsB = buildYearMonthBars(byMonth, compareYearB);
    chartLabels = barsA.map((b) => shortMonth(b.month));
    chartSeries = [
      {
        label: String(compareYearA),
        color: SERIES_A,
        values: barsA.map((b) => b.count),
      },
      {
        label: String(compareYearB),
        color: SERIES_B,
        values: barsB.map((b) => b.count),
      },
    ];
    periodTotal = sumCounts(chartSeries[0]!.values) + sumCounts(chartSeries[1]!.values);
    periodSubtitle = `${compareYearA} · ${compareYearB}`;
  }

  const yMax = maxCount(chartSeries.flatMap((s) => s.values));
  const activeDays = mode === 'month'
    ? monthBars.filter((b) => b.count > 0).length
    : chartSeries[0]!.values.filter((v) => v > 0).length;
  const best = Math.max(0, ...chartSeries.flatMap((s) => s.values));

  const selectCls =
    'rounded-lg border border-app-border bg-white px-2 py-1.5 text-[12px] font-semibold text-app-text outline-none dark:border-white/10 dark:bg-gray-900 dark:text-gray-100';
  const modeBtn = (active: boolean) =>
    'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ' +
    (active
      ? 'bg-primary text-white'
      : 'bg-app-bg text-app-text-secondary hover:bg-app-border/40 dark:bg-white/5 dark:text-gray-400');

  return (
    <div
      className="fixed inset-0 z-[220] flex items-end justify-center bg-black/35 p-3 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.quizStatsTitle}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-[#1e1e2e]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-app-border px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="text-[15px] font-bold text-app-text dark:text-gray-100">{t.quizStatsTitle}</h2>
            <p className="mt-0.5 text-[11px] text-app-text-secondary dark:text-gray-400">
              {t.quizStatsSubtitle.replace('{n}', String(items.length))}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[13px] font-semibold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-app-border/70 px-4 py-2.5 dark:border-white/10">
          <button type="button" className={modeBtn(mode === 'month')} onClick={() => setMode('month')}>
            {t.quizStatsModeMonth}
          </button>
          <button type="button" className={modeBtn(mode === 'compareMonths')} onClick={() => setMode('compareMonths')}>
            {t.quizStatsModeCompareMonths}
          </button>
          <button type="button" className={modeBtn(mode === 'compareYears')} onClick={() => setMode('compareYears')}>
            {t.quizStatsModeCompareYears}
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {mode === 'month' && (
              <select className={selectCls} value={monthKey} onChange={(e) => setMonthKey(e.target.value)}>
                {monthOptions.map((key) => (
                  <option key={key} value={key}>{monthLabel(key)}</option>
                ))}
              </select>
            )}
            {mode === 'compareMonths' && (
              <>
                <select className={selectCls} value={compareMonthA} onChange={(e) => setCompareMonthA(e.target.value)}>
                  {monthOptions.map((key) => (
                    <option key={key} value={key}>{monthLabel(key)}</option>
                  ))}
                </select>
                <span className="text-[11px] text-app-text-secondary">vs</span>
                <select className={selectCls} value={compareMonthB} onChange={(e) => setCompareMonthB(e.target.value)}>
                  {monthOptions.map((key) => (
                    <option key={key} value={key}>{monthLabel(key)}</option>
                  ))}
                </select>
              </>
            )}
            {mode === 'compareYears' && (
              <>
                <select
                  className={selectCls}
                  value={compareYearA}
                  onChange={(e) => setCompareYearA(Number(e.target.value))}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
                <span className="text-[11px] text-app-text-secondary">vs</span>
                <select
                  className={selectCls}
                  value={compareYearB}
                  onChange={(e) => setCompareYearB(Number(e.target.value))}
                >
                  {[...new Set([...yearOptions, compareYearB, now.year - 1])].sort((a, b) => b - a).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        <div className="overflow-y-auto px-4 py-4">
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">{t.quizStatsTotal}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-app-text dark:text-gray-100">{periodTotal}</p>
              <p className="truncate text-[10px] text-app-text-secondary/60">{periodSubtitle}</p>
            </div>
            <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">{t.quizStatsActiveDays}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-app-text dark:text-gray-100">{activeDays}</p>
            </div>
            <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">{t.quizStatsBestDay}</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-app-text dark:text-gray-100">{best}</p>
            </div>
          </div>

          {chartSeries.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-3 text-[11px] font-semibold">
              {chartSeries.map((s) => (
                <span key={s.label} className="inline-flex items-center gap-1.5 text-app-text dark:text-gray-200">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                  <span className="tabular-nums text-app-text-secondary">({sumCounts(s.values)})</span>
                </span>
              ))}
            </div>
          )}

          {items.length === 0 ? (
            <p className="py-16 text-center text-sm text-app-text-secondary">{t.quizStatsEmpty}</p>
          ) : (
            <div className="rounded-xl border border-app-border bg-white p-2 dark:border-white/10 dark:bg-gray-950/40">
              <BarChart labels={chartLabels} series={chartSeries} maxY={yMax} />
            </div>
          )}

          {mode === 'month' && monthBars.some((b) => b.count > 0) && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">
                {t.quizStatsDailyList}
              </p>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-app-border dark:border-white/10">
                {[...monthBars].filter((b) => b.count > 0).reverse().map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between border-b border-app-border/60 px-3 py-1.5 text-[12px] last:border-b-0 dark:border-white/10"
                  >
                    <span className="text-app-text dark:text-gray-200">
                      {new Date(b.key + 'T12:00:00').toLocaleDateString(locale, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                    </span>
                    <span className="font-semibold tabular-nums text-primary">
                      {b.count} {b.count === 1 ? t.quizQuestionOne : t.quizQuestionMany}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
