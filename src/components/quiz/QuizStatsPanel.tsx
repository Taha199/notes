import { useEffect, useMemo, useRef, useState } from 'react';
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
  type DayBar,
} from '../../lib/quizStats';

type Mode = 'month' | 'compareMonths' | 'compareYears';

const SERIES_A = '#534AB7';
const SERIES_B = '#0d9488';

function capitalizeLabel(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function StatsMenuSelect({
  value,
  options,
  onChange,
  ariaLabel,
  align = 'right',
}: {
  value: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'flex min-w-[9.5rem] items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[12px] font-semibold transition ' +
          (open
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-app-border bg-white text-app-text hover:bg-app-bg dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10')
        }
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? value}</span>
        <span className={'text-[10px] opacity-60 transition ' + (open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={
            'absolute top-full z-[30] mt-1.5 max-h-64 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-app-border bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-gray-900 dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] ' +
            (align === 'left' ? 'left-0' : 'right-0')
          }
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={
                  'mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ' +
                  (active
                    ? 'bg-primary/10 text-primary'
                    : 'text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5')
                }
              >
                <span className={'min-w-0 flex-1 text-[12.5px] leading-snug ' + (active ? 'font-bold' : 'font-semibold')}>
                  {opt.label}
                </span>
                {opt.hint && (
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-app-text-secondary/55">
                    {opt.hint}
                  </span>
                )}
                {active && <span className="shrink-0 text-[12px] font-bold text-primary">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One column per calendar day — number, weekday, bar, count. */
function MonthDayChart({
  bars,
  locale,
  questionsOne,
  questionsMany,
}: {
  bars: DayBar[];
  locale: string;
  questionsOne: string;
  questionsMany: string;
}) {
  const yMax = Math.max(1, maxCount(bars.map((b) => b.count)));
  return (
    <div className="w-full overflow-x-auto pb-1">
      <div
        className="flex min-w-max items-end gap-1 px-1 pt-2"
        style={{ height: 260 }}
        role="img"
        aria-label="day chart"
      >
        {bars.map((b) => {
          const date = new Date(`${b.key}T12:00:00`);
          const weekday = date.toLocaleDateString(locale, { weekday: 'short' });
          const h = b.count > 0 ? Math.max(12, (b.count / yMax) * 160) : 4;
          const active = b.count > 0;
          return (
            <div
              key={b.key}
              title={`${date.toLocaleDateString(locale, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}: ${b.count} ${b.count === 1 ? questionsOne : questionsMany}`}
              className={
                'flex w-9 flex-col items-center justify-end gap-1 rounded-lg px-0.5 py-1 ' +
                (active ? 'bg-primary/5 dark:bg-primary/10' : '')
              }
            >
              <span
                className={
                  'text-[11px] font-bold tabular-nums ' +
                  (active ? 'text-primary' : 'text-transparent')
                }
              >
                {active ? b.count : '0'}
              </span>
              <div
                className={
                  'w-5 rounded-t-md transition-all ' +
                  (active
                    ? 'bg-primary shadow-sm shadow-primary/25'
                    : 'bg-app-border/50 dark:bg-white/10')
                }
                style={{ height: h }}
              />
              <span
                className={
                  'text-[12px] font-bold tabular-nums leading-none ' +
                  (active ? 'text-app-text dark:text-gray-100' : 'text-app-text-secondary/45')
                }
              >
                {b.day}
              </span>
              <span
                className={
                  'text-[9px] font-semibold uppercase leading-none ' +
                  (active ? 'text-app-text-secondary' : 'text-app-text-secondary/35')
                }
              >
                {weekday.replace(/\.$/, '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BarChart({
  labels,
  series,
  maxY,
  labelEvery = false,
  showValues = false,
  slotPx = 14,
}: {
  labels: string[];
  series: { label: string; color: string; values: number[] }[];
  maxY: number;
  labelEvery?: boolean;
  showValues?: boolean;
  slotPx?: number;
}) {
  const n = labels.length;
  const height = 240;
  const padL = 28;
  const padR = 8;
  const padT = showValues ? 22 : 16;
  const padB = 40;
  const width = Math.max(320, n * slotPx + padL + padR);
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const groupW = innerW / Math.max(n, 1);
  const barW = Math.min(series.length > 1 ? slotPx * 0.35 : slotPx * 0.55, groupW / (series.length + 0.6));
  const yMax = Math.max(1, maxY);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
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
          const showLabel = labelEvery || i === 0 || i === n - 1 || i % Math.ceil(n / 12) === 0;
          return (
            <g key={`${label}-${i}`}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0;
                const h = (v / yMax) * innerH;
                const x = gx - (series.length * barW) / 2 + si * barW;
                const y = padT + innerH - h;
                return (
                  <g key={s.label}>
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(v > 0 ? 2 : 0, h)}
                      rx={2}
                      fill={s.color}
                      opacity={v > 0 ? 1 : 0.12}
                    >
                      <title>{`${s.label}: ${label} — ${v}`}</title>
                    </rect>
                    {showValues && v > 0 && series.length === 1 && (
                      <text
                        x={x + barW / 2}
                        y={y - 4}
                        textAnchor="middle"
                        className="fill-primary"
                        fontSize={9}
                        fontWeight={700}
                      >
                        {v}
                      </text>
                    )}
                  </g>
                );
              })}
              {showLabel && (
                <text
                  x={gx}
                  y={height - 14}
                  textAnchor="middle"
                  className="fill-app-text-secondary dark:fill-gray-400"
                  fontSize={labelEvery ? 10 : 9}
                  fontWeight={labelEvery ? 700 : 400}
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
    return capitalizeLabel(
      new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
    );
  };
  const shortMonth = (m: number) =>
    capitalizeLabel(new Date(2000, m - 1, 1).toLocaleDateString(locale, { month: 'short' }));

  const monthMenuOptions = useMemo(
    () => monthOptions.map((key) => {
      const count = sumCounts(
        buildMonthDayBars(byDay, Number(key.slice(0, 4)), Number(key.slice(5, 7))).map((b) => b.count),
      );
      return {
        value: key,
        label: monthLabel(key),
        hint: count > 0 ? String(count) : undefined,
      };
    }),
    // monthLabel depends on locale; rebuild when options/day map change
    [monthOptions, byDay, locale],
  );
  const yearMenuOptions = useMemo(() => {
    const years = [...new Set([...yearOptions, compareYearB, now.year - 1])].sort((a, b) => b - a);
    return years.map((y) => ({
      value: String(y),
      label: String(y),
      hint: String(sumCounts(buildYearMonthBars(byMonth, y).map((b) => b.count))),
    }));
  }, [yearOptions, compareYearB, now.year, byMonth]);

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
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-[#1e1e2e]"
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
              <StatsMenuSelect
                ariaLabel={t.quizStatsModeMonth}
                value={monthKey}
                options={monthMenuOptions}
                onChange={setMonthKey}
              />
            )}
            {mode === 'compareMonths' && (
              <>
                <StatsMenuSelect
                  ariaLabel={t.quizStatsModeCompareMonths}
                  value={compareMonthA}
                  options={monthMenuOptions}
                  onChange={setCompareMonthA}
                />
                <span className="text-[11px] font-semibold text-app-text-secondary/70">vs</span>
                <StatsMenuSelect
                  ariaLabel={t.quizStatsModeCompareMonths}
                  value={compareMonthB}
                  options={monthMenuOptions}
                  onChange={setCompareMonthB}
                />
              </>
            )}
            {mode === 'compareYears' && (
              <>
                <StatsMenuSelect
                  ariaLabel={t.quizStatsModeCompareYears}
                  value={String(compareYearA)}
                  options={yearMenuOptions}
                  onChange={(v) => setCompareYearA(Number(v))}
                />
                <span className="text-[11px] font-semibold text-app-text-secondary/70">vs</span>
                <StatsMenuSelect
                  ariaLabel={t.quizStatsModeCompareYears}
                  value={String(compareYearB)}
                  options={yearMenuOptions}
                  onChange={(v) => setCompareYearB(Number(v))}
                />
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
          ) : mode === 'month' ? (
            <div className="rounded-xl border border-app-border bg-white p-2 dark:border-white/10 dark:bg-gray-950/40">
              <p className="mb-1 px-1 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/60">
                {t.quizStatsDayByDay}
              </p>
              <MonthDayChart
                bars={monthBars}
                locale={locale}
                questionsOne={t.quizQuestionOne}
                questionsMany={t.quizQuestionMany}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-app-border bg-white p-2 dark:border-white/10 dark:bg-gray-950/40">
              <BarChart
                labels={chartLabels}
                series={chartSeries}
                maxY={yMax}
                labelEvery={mode === 'compareMonths' || mode === 'compareYears'}
                showValues={mode === 'compareMonths'}
                slotPx={mode === 'compareMonths' ? 26 : 36}
              />
            </div>
          )}

          {mode === 'month' && monthBars.some((b) => b.count > 0) && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-app-text-secondary/70">
                {t.quizStatsDailyList}
              </p>
              <div className="overflow-hidden rounded-xl border border-app-border dark:border-white/10">
                {[...monthBars].filter((b) => b.count > 0).reverse().map((b) => (
                  <div
                    key={b.key}
                    className="flex items-center justify-between border-b border-app-border/60 px-3 py-2 text-[13px] last:border-b-0 dark:border-white/10"
                  >
                    <span className="font-medium text-app-text dark:text-gray-200">
                      {new Date(b.key + 'T12:00:00').toLocaleDateString(locale, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </span>
                    <span className="rounded-lg bg-primary/10 px-2 py-0.5 text-[12px] font-bold tabular-nums text-primary">
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
