import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
const COMPARE_COLORS = [
  '#534AB7',
  '#0d9488',
  '#d97706',
  '#db2777',
  '#2563eb',
  '#059669',
  '#ea580c',
  '#7c3aed',
];

function capitalizeLabel(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function useMenuDismiss(
  open: boolean,
  setOpen: (open: boolean) => void,
  wrapRef: RefObject<HTMLDivElement | null>,
) {
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
  }, [open, setOpen, wrapRef]);
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
  useMenuDismiss(open, setOpen, wrapRef);

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

/** Multi-check month picker — stays open while toggling. */
function StatsMultiSelect({
  values,
  options,
  onChange,
  ariaLabel,
  emptyLabel,
  manyLabel,
  align = 'right',
}: {
  values: string[];
  options: { value: string; label: string; hint?: string }[];
  onChange: (values: string[]) => void;
  ariaLabel: string;
  emptyLabel: string;
  manyLabel: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useMenuDismiss(open, setOpen, wrapRef);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedLabels = options.filter((o) => selectedSet.has(o.value)).map((o) => o.label);
  const buttonText =
    selectedLabels.length === 0
      ? emptyLabel
      : selectedLabels.length === 1
        ? selectedLabels[0]!
        : selectedLabels.length === 2
          ? `${selectedLabels[0]}, ${selectedLabels[1]}`
          : manyLabel.replace('{n}', String(selectedLabels.length));

  const toggle = (value: string) => {
    if (selectedSet.has(value)) {
      onChange(values.filter((v) => v !== value));
    } else {
      onChange([...values, value]);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'flex min-w-[11rem] max-w-[18rem] items-center gap-2 rounded-xl border px-3 py-1.5 text-left text-[12px] font-semibold transition ' +
          (open
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-app-border bg-white text-app-text hover:bg-app-bg dark:border-white/10 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-white/10')
        }
      >
        <span className="min-w-0 flex-1 truncate">{buttonText}</span>
        <span className={'text-[10px] opacity-60 transition ' + (open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          aria-label={ariaLabel}
          className={
            'absolute top-full z-[30] mt-1.5 max-h-64 w-[min(16rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-app-border bg-white py-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-gray-900 dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)] ' +
            (align === 'left' ? 'left-0' : 'right-0')
          }
        >
          {options.map((opt) => {
            const active = selectedSet.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => toggle(opt.value)}
                className={
                  'mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ' +
                  (active
                    ? 'bg-primary/10 text-primary'
                    : 'text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5')
                }
              >
                <span
                  className={
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ' +
                    (active
                      ? 'border-primary bg-primary text-white'
                      : 'border-app-border text-transparent dark:border-white/20')
                  }
                  aria-hidden
                >
                  ✓
                </span>
                <span className={'min-w-0 flex-1 text-[12.5px] leading-snug ' + (active ? 'font-bold' : 'font-semibold')}>
                  {opt.label}
                </span>
                {opt.hint && (
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-app-text-secondary/55">
                    {opt.hint}
                  </span>
                )}
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

/** Big bars for month/year totals comparison. */
function TotalsCompareChart({
  items,
}: {
  items: { id: string; label: string; value: number; color: string }[];
}) {
  const yMax = Math.max(1, ...items.map((i) => i.value), 0);
  if (items.length === 0) {
    return <div className="flex min-h-[200px] items-center justify-center text-sm text-app-text-secondary" />;
  }
  return (
    <div className="flex min-h-[260px] items-end justify-center gap-6 overflow-x-auto px-4 py-6 sm:gap-10">
      {items.map((item) => {
        const h = item.value > 0 ? Math.max(28, (item.value / yMax) * 180) : 8;
        return (
          <div key={item.id} className="flex w-[6.5rem] shrink-0 flex-col items-center gap-2 sm:w-32">
            <span className="text-2xl font-bold tabular-nums text-app-text dark:text-gray-100">
              {item.value}
            </span>
            <div
              className="w-12 rounded-t-2xl shadow-sm sm:w-14"
              style={{ height: h, background: item.color }}
              title={`${item.label}: ${item.value}`}
            />
            <span className="text-center text-[12px] font-semibold leading-snug text-app-text dark:text-gray-200">
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function QuizStatsPanel({
  quizzes,
  quizSets,
  onClose,
  variant = 'modal',
}: {
  quizzes: QuizItem[];
  quizSets: QuizSet[];
  onClose?: () => void;
  variant?: 'modal' | 'page';
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
  const [compareMonths, setCompareMonths] = useState<string[]>(() => {
    const a = monthOptions[0] ?? now.key;
    const b = monthOptions[1];
    return b && b !== a ? [a, b] : [a];
  });
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

  let compareTotals: { id: string; label: string; value: number; color: string }[] | null = null;
  let periodTotal = 0;
  let periodSubtitle = '';
  let activeDays = 0;
  let best = 0;

  if (mode === 'month') {
    periodTotal = sumCounts(monthBars.map((b) => b.count));
    periodSubtitle = monthLabel(monthKey);
    activeDays = monthBars.filter((b) => b.count > 0).length;
    best = maxCount(monthBars.map((b) => b.count));
  } else if (mode === 'compareMonths') {
    // Keep chart order stable: newest months first (same as menu), among selected only
    const selected = monthOptions.filter((k) => compareMonths.includes(k));
    compareTotals = selected.map((key, i) => {
      const parts = key.split('-').map(Number);
      const bars = buildMonthDayBars(byDay, parts[0]!, parts[1]!);
      const total = sumCounts(bars.map((x) => x.count));
      return {
        id: key,
        label: monthLabel(key),
        value: total,
        color: COMPARE_COLORS[i % COMPARE_COLORS.length]!,
      };
    });
    periodTotal = sumCounts(compareTotals.map((x) => x.value));
    periodSubtitle = compareTotals.map((x) => x.label).join(' · ');
    activeDays = selected.reduce((acc, key) => {
      const parts = key.split('-').map(Number);
      return acc + buildMonthDayBars(byDay, parts[0]!, parts[1]!).filter((x) => x.count > 0).length;
    }, 0);
    best = maxCount(compareTotals.map((x) => x.value));
  } else {
    const barsA = buildYearMonthBars(byMonth, compareYearA);
    const barsB = buildYearMonthBars(byMonth, compareYearB);
    const totalA = sumCounts(barsA.map((x) => x.count));
    const totalB = sumCounts(barsB.map((x) => x.count));
    compareTotals = [
      { id: `y-${compareYearA}`, label: String(compareYearA), value: totalA, color: SERIES_A },
      { id: `y-${compareYearB}`, label: String(compareYearB), value: totalB, color: SERIES_B },
    ];
    periodTotal = totalA + totalB;
    periodSubtitle = `${compareYearA} · ${compareYearB}`;
    activeDays = barsA.filter((x) => x.count > 0).length + barsB.filter((x) => x.count > 0).length;
    best = Math.max(totalA, totalB);
  }

  const modeBtn = (active: boolean) =>
    'rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ' +
    (active
      ? 'bg-primary text-white'
      : 'bg-app-bg text-app-text-secondary hover:bg-app-border/40 dark:bg-white/5 dark:text-gray-400');

  const shell = (
      <div
        role={variant === 'modal' ? 'dialog' : undefined}
        aria-modal={variant === 'modal' ? true : undefined}
        aria-label={t.quizStatsTitle}
        className={
          variant === 'modal'
            ? 'flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-2xl dark:border-white/10 dark:bg-[#1e1e2e]'
            : 'flex w-full flex-col overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-[#1e1e2e]'
        }
        onClick={variant === 'modal' ? (e) => e.stopPropagation() : undefined}
      >
        <div className="flex items-start justify-between gap-3 border-b border-app-border px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="text-[15px] font-bold text-app-text dark:text-gray-100">{t.quizStatsTitle}</h2>
            <p className="mt-0.5 text-[11px] text-app-text-secondary dark:text-gray-400">
              {t.quizStatsSubtitle.replace('{n}', String(items.length))}
            </p>
          </div>
          {variant === 'modal' && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-[13px] font-semibold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10"
            >
              ✕
            </button>
          )}
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
              <StatsMultiSelect
                ariaLabel={t.quizStatsModeCompareMonths}
                values={compareMonths}
                options={monthMenuOptions}
                onChange={setCompareMonths}
                emptyLabel={t.quizStatsSelectMonths}
                manyLabel={t.quizStatsMonthsSelected}
              />
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

          {compareTotals && compareTotals.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-3 text-[11px] font-semibold">
              {compareTotals.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 text-app-text dark:text-gray-200">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                  <span className="tabular-nums text-app-text-secondary">({s.value})</span>
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
              <TotalsCompareChart items={compareTotals ?? []} />
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
  );

  if (variant === 'page') {
    return shell;
  }

  return (
    <div
      className="fixed inset-0 z-[220] flex items-end justify-center bg-black/35 p-3 sm:items-center"
      onClick={onClose}
    >
      {shell}
    </div>
  );
}
