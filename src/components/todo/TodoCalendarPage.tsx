import { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTodos } from '../../contexts/TodosContext';
import {
  addMonths,
  expandRecurringTodoDates,
  monthWeekRows,
  toDateKey,
  todosForDate,
  type TodoRecurrenceMode,
} from '../../lib/todosStore';
import { normalizeSearch } from '../../lib/noteSearch';

function weekdayLabels(locale: string): string[] {
  const monday = new Date(2026, 7, 10);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day);
  });
}

/** Monday-first labels → JS getDay() (0=Sun … 6=Sat). */
const WEEKDAY_JS_FROM_MONDAY = [1, 2, 3, 4, 5, 6, 0] as const;

function capitalizeLabel(value: string) {
  if (!value) return value;
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function MonthYearPicker({
  cursor,
  onChange,
  locale,
  ariaLabel,
  openByMonth,
}: {
  cursor: Date;
  onChange: (next: Date) => void;
  locale: string;
  ariaLabel: string;
  /** Open (incomplete) task counts keyed by YYYY-MM. */
  openByMonth: Map<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(cursor.getFullYear());
  const wrapRef = useRef<HTMLDivElement>(null);
  const monthLabel = capitalizeLabel(
    new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(cursor),
  );

  useEffect(() => {
    if (open) setPickerYear(cursor.getFullYear());
  }, [open, cursor]);

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

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        capitalizeLabel(new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(pickerYear, month, 1))),
      ),
    [locale, pickerYear],
  );

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'flex min-w-[10.5rem] items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-lg font-bold capitalize tracking-tight transition ' +
          (open
            ? 'bg-primary/10 text-primary'
            : 'text-app-text hover:bg-app-bg dark:text-gray-100 dark:hover:bg-white/5')
        }
      >
        <span>{monthLabel}</span>
        <span className={'text-[11px] opacity-55 transition ' + (open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel}
          className="absolute left-1/2 top-full z-30 mt-2 w-[18.5rem] -translate-x-1/2 rounded-2xl border border-app-border bg-white p-3 shadow-[0_12px_32px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-gray-900 dark:shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setPickerYear((y) => y - 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-app-border text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10"
              aria-label="Previous year"
            >
              ‹
            </button>
            <span className="text-[14px] font-bold tabular-nums text-app-text dark:text-gray-100">{pickerYear}</span>
            <button
              type="button"
              onClick={() => setPickerYear((y) => y + 1)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-app-border text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10"
              aria-label="Next year"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {months.map((label, month) => {
              const active = cursor.getFullYear() === pickerYear && cursor.getMonth() === month;
              const monthKey = `${pickerYear}-${String(month + 1).padStart(2, '0')}`;
              const openCount = openByMonth.get(monthKey) ?? 0;
              const now = new Date();
              const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
              const isPast = monthKey < currentMonthKey;
              return (
                <button
                  key={label + month}
                  type="button"
                  onClick={() => {
                    onChange(new Date(pickerYear, month, 1));
                    setOpen(false);
                  }}
                  className={
                    'flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 transition ' +
                    (active
                      ? 'bg-primary text-white'
                      : 'text-app-text hover:bg-app-bg dark:text-gray-200 dark:hover:bg-white/5')
                  }
                >
                  <span className="text-[12.5px] font-semibold capitalize leading-none">{label}</span>
                  <span
                    className={
                      'text-[11px] font-bold tabular-nums leading-none ' +
                      (active
                        ? isPast && openCount > 0
                          ? 'text-red-200'
                          : openCount > 0
                            ? 'text-white/90'
                            : 'text-white/55'
                        : isPast && openCount > 0
                          ? 'text-red-600 dark:text-red-400'
                          : openCount > 0
                            ? 'text-primary'
                            : 'text-app-text-secondary/45')
                    }
                  >
                    {openCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function TodoCalendarPage({ search = '' }: { search?: string }) {
  const { t } = useLanguage();
  const { todos, addTodo, addRecurringTodos, toggleTodo, renameTodo, setTodoTime, deleteTodo } = useTodos();
  const todayKey = toDateKey(new Date());
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [draft, setDraft] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [panel, setPanel] = useState<'day' | 'recurring'>('day');
  const [recTitle, setRecTitle] = useState('');
  const [recMode, setRecMode] = useState<TodoRecurrenceMode>('daily');
  const [recWeekdays, setRecWeekdays] = useState<number[]>(() => {
    const js = new Date(`${todayKey}T12:00:00`).getDay();
    return [js];
  });
  const [recMonthDay, setRecMonthDay] = useState(1);
  const [recFrom, setRecFrom] = useState(todayKey);
  const [recTo, setRecTo] = useState(() => {
    const d = new Date(`${todayKey}T12:00:00`);
    d.setMonth(d.getMonth() + 3);
    return toDateKey(d);
  });
  const dayInputRef = useRef<HTMLInputElement>(null);

  const query = normalizeSearch(search);
  const visibleTodos = useMemo(
    () => (query ? todos.filter((todo) => normalizeSearch(todo.title).includes(query)) : todos),
    [todos, query],
  );
  const weeks = useMemo(() => monthWeekRows(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const weekdays = useMemo(() => weekdayLabels(t.dateLocale), [t.dateLocale]);
  const selectedLabel = new Intl.DateTimeFormat(t.dateLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${selectedKey}T12:00:00`));
  const dayTodos = todosForDate(visibleTodos, selectedKey);
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; open: number }>();
    for (const todo of visibleTodos) {
      const row = map.get(todo.date) ?? { total: 0, open: 0 };
      row.total += 1;
      if (!todo.done) row.open += 1;
      map.set(todo.date, row);
    }
    return map;
  }, [visibleTodos]);

  const openByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const todo of visibleTodos) {
      if (todo.done) continue;
      const monthKey = todo.date.slice(0, 7);
      if (monthKey.length !== 7) continue;
      map.set(monthKey, (map.get(monthKey) ?? 0) + 1);
    }
    return map;
  }, [visibleTodos]);

  const submitDraft = () => {
    addTodo(draft, selectedKey, draftTime);
    setDraft('');
    setDraftTime('');
  };

  const recPreviewCount = useMemo(() => expandRecurringTodoDates(recFrom, recTo, recMode, {
    weekdays: recMode === 'weekly' ? recWeekdays : undefined,
    monthDay: recMode === 'monthly' ? recMonthDay : undefined,
  }).length, [recFrom, recTo, recMode, recWeekdays, recMonthDay]);

  const openRecurringPanel = () => {
    setRecTitle('');
    setRecMode('daily');
    const js = new Date(`${selectedKey}T12:00:00`).getDay();
    setRecWeekdays([js]);
    setRecMonthDay(Math.min(28, Math.max(1, new Date(`${selectedKey}T12:00:00`).getDate())));
    setRecFrom(selectedKey);
    const end = new Date(`${selectedKey}T12:00:00`);
    end.setMonth(end.getMonth() + 3);
    setRecTo(toDateKey(end));
    setPanel('recurring');
  };

  const openDayPanel = () => {
    setPanel('day');
    window.setTimeout(() => dayInputRef.current?.focus(), 50);
  };

  const toggleRecWeekday = (jsDay: number) => {
    setRecWeekdays((prev) => {
      if (prev.includes(jsDay)) {
        const next = prev.filter((d) => d !== jsDay);
        return next.length ? next : prev;
      }
      return [...prev, jsDay].sort((a, b) => a - b);
    });
  };

  const submitRecurring = () => {
    if (!recTitle.trim() || recPreviewCount <= 0) return;
    const n = addRecurringTodos({
      title: recTitle,
      mode: recMode,
      weekdays: recMode === 'weekly' ? recWeekdays : undefined,
      monthDay: recMode === 'monthly' ? recMonthDay : undefined,
      startDate: recFrom,
      endDate: recTo,
    });
    if (n > 0) {
      setPanel('day');
      setRecTitle('');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor((prev) => addMonths(prev, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-app-border bg-white text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
            title={t.todoPrevMonth}
          >
            ‹
          </button>
          <MonthYearPicker
            cursor={cursor}
            onChange={setCursor}
            locale={t.dateLocale}
            ariaLabel={t.todoPickMonth}
            openByMonth={openByMonth}
          />
          <button
            type="button"
            onClick={() => setCursor((prev) => addMonths(prev, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-app-border bg-white text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
            title={t.todoNextMonth}
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
              setSelectedKey(todayKey);
              setPanel('day');
            }}
            className="rounded-xl border border-app-border bg-white px-3.5 py-2 text-[13px] font-semibold text-app-text hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
          >
            {t.todoToday}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={openDayPanel}
            className={
              'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition ' +
              (panel === 'day'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-app-border bg-white text-app-text hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100')
            }
          >
            <span aria-hidden="true">+</span>
            {t.todoAddTask}
          </button>
          <button
            type="button"
            onClick={openRecurringPanel}
            className={
              'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-semibold transition ' +
              (panel === 'recurring'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-app-border bg-white text-app-text hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100')
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 1l4 4-4 4" />
              <path d="M3 11V9a4 4 0 014-4h14" />
              <path d="M7 23l-4-4 4-4" />
              <path d="M21 13v2a4 4 0 01-4 4H3" />
            </svg>
            {t.todoAddRecurring}
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.95fr)]">
        <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))] border-b border-app-border bg-app-bg/80 px-1 py-2 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center justify-center">
              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary dark:bg-primary/25">
                {t.todoWeekShort}
              </span>
            </div>
            {weekdays.map((label) => (
              <div key={label} className="text-center text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/80">
                {label}
              </div>
            ))}
          </div>
          <div>
            {weeks.map((row) => (
              <div key={`${row.week}-${toDateKey(row.days[0]!)}`} className="grid grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]">
                <div
                  className="flex items-start justify-center border-b border-r border-app-border/70 bg-primary/[0.06] pt-2 dark:border-white/10 dark:bg-primary/10"
                  title={`${t.todoWeek} ${row.week}`}
                >
                  <span className="inline-flex min-w-[1.65rem] items-center justify-center rounded-lg bg-primary/15 px-1 py-1 text-[12px] font-bold tabular-nums text-primary shadow-sm dark:bg-primary/25 dark:text-primary">
                    {row.week}
                  </span>
                </div>
                {row.days.map((day) => {
                  const key = toDateKey(day);
                  const inMonth = day.getMonth() === cursor.getMonth();
                  const selected = key === selectedKey;
                  const isToday = key === todayKey;
                  const stats = counts.get(key);
                  const overdue = !!stats?.open && key < todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedKey(key);
                        if (panel === 'recurring') setPanel('day');
                      }}
                      className={
                        'relative flex min-h-[4.4rem] flex-col items-center gap-0.5 border-b border-r border-app-border/70 px-1 py-1.5 text-sm transition-colors dark:border-white/10 ' +
                        (selected
                          ? 'bg-primary/12 text-primary'
                          : overdue
                            ? 'bg-red-50 text-red-700 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.35)] dark:bg-red-500/15 dark:text-red-200 dark:shadow-[inset_0_0_0_1px_rgba(248,113,113,0.35)]'
                            : isToday
                              ? 'bg-sky-50 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200'
                              : 'hover:bg-app-bg dark:hover:bg-white/5') +
                        (inMonth ? '' : ' text-app-text-secondary/40')
                      }
                    >
                      <span className={
                        'flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-semibold ' +
                        (selected
                          ? 'bg-primary text-white'
                          : overdue
                            ? 'bg-red-500 text-white shadow-[0_0_12px_rgba(239,68,68,0.55)]'
                            : isToday
                              ? 'bg-white text-sky-700 ring-2 ring-sky-400/80 dark:bg-sky-500/20 dark:text-sky-100 dark:ring-sky-300/70'
                              : '')
                      }>
                        {day.getDate()}
                      </span>
                      {isToday && (
                        <span className="rounded-full bg-sky-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-400/20 dark:text-sky-200">
                          {t.todoToday}
                        </span>
                      )}
                      {stats && (
                        <span className="flex items-center gap-0.5">
                          {stats.open > 0 ? (
                            <span className={'h-1.5 w-1.5 rounded-full ' + (overdue ? 'bg-red-500' : 'bg-primary')} />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          )}
                          <span className={'text-[10px] font-bold ' + (overdue ? 'text-red-600 dark:text-red-300' : 'text-app-text-secondary')}>
                            {stats.total}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {panel === 'recurring' ? (
          <section className="flex min-h-[22rem] flex-col rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/70">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h4 className="text-base font-bold text-app-text dark:text-gray-100">{t.todoRecurringTitle}</h4>
              <button
                type="button"
                onClick={() => setPanel('day')}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-app-text-secondary hover:bg-app-bg hover:text-app-text dark:hover:bg-white/10"
                aria-label={t.todoRecurringCancel}
              >
                ✕
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
              <input
                value={recTitle}
                onChange={(e) => setRecTitle(e.target.value)}
                placeholder={t.todoRecurringPh}
                autoFocus
                className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-[13.5px] text-app-text outline-none placeholder:text-app-text-secondary/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 dark:border-white/15 dark:bg-gray-800/90 dark:text-gray-100"
              />

              <div>
                <p className="mb-2 text-[12px] font-bold text-app-text dark:text-gray-100">{t.todoRecurringRepeat}</p>
                <div className="space-y-2">
                  {([
                    { key: 'daily' as const, label: t.todoRecurringEveryDay },
                    { key: 'weekly' as const, label: t.todoRecurringEveryWeekday },
                    { key: 'monthly' as const, label: t.todoRecurringEveryMonth },
                  ]).map((opt) => (
                    <label
                      key={opt.key}
                      className={
                        'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition ' +
                        (recMode === opt.key
                          ? 'border-primary/40 bg-primary/5 dark:bg-primary/10'
                          : 'border-app-border/80 hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5')
                      }
                    >
                      <input
                        type="radio"
                        name="todo-recurrence"
                        checked={recMode === opt.key}
                        onChange={() => setRecMode(opt.key)}
                        className="mt-0.5 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-app-text dark:text-gray-100">{opt.label}</span>
                        {opt.key === 'weekly' && recMode === 'weekly' && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {WEEKDAY_JS_FROM_MONDAY.map((jsDay, i) => {
                              const on = recWeekdays.includes(jsDay);
                              return (
                                <button
                                  key={jsDay}
                                  type="button"
                                  onClick={() => toggleRecWeekday(jsDay)}
                                  className={
                                    'rounded-lg px-2 py-1 text-[11px] font-bold transition ' +
                                    (on
                                      ? 'bg-primary text-white'
                                      : 'bg-white text-app-text-secondary ring-1 ring-app-border hover:text-primary dark:bg-gray-800 dark:ring-white/15')
                                  }
                                >
                                  {weekdays[i]}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {opt.key === 'monthly' && recMode === 'monthly' && (
                          <label className="mt-2 flex items-center gap-2 text-[12px] text-app-text-secondary">
                            {t.todoRecurringMonthDay}
                            <select
                              value={recMonthDay}
                              onChange={(e) => setRecMonthDay(Number(e.target.value))}
                              className="rounded-lg border border-app-border bg-white px-2 py-1 text-[12px] font-semibold text-app-text dark:border-white/15 dark:bg-gray-800 dark:text-gray-100"
                            >
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <option key={d} value={d}>{d}</option>
                              ))}
                            </select>
                          </label>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-[12px] font-bold text-app-text dark:text-gray-100">{t.todoRecurringRange}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-app-text-secondary">
                    {t.todoRecurringFrom}
                    <input
                      type="date"
                      value={recFrom}
                      onChange={(e) => setRecFrom(e.target.value)}
                      className="rounded-xl border border-app-border bg-app-bg px-2.5 py-2 text-[13px] font-normal text-app-text outline-none focus:border-primary/50 dark:border-white/15 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold text-app-text-secondary">
                    {t.todoRecurringTo}
                    <input
                      type="date"
                      value={recTo}
                      onChange={(e) => setRecTo(e.target.value)}
                      className="rounded-xl border border-app-border bg-app-bg px-2.5 py-2 text-[13px] font-normal text-app-text outline-none focus:border-primary/50 dark:border-white/15 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </label>
                </div>
                <p className={
                  'mt-2 text-[12px] ' +
                  (recPreviewCount > 0 ? 'text-app-text-secondary' : 'text-red-600 dark:text-red-400')
                }>
                  {recPreviewCount > 0
                    ? t.todoRecurringCount.replace('{count}', String(recPreviewCount))
                    : t.todoRecurringInvalidRange}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPanel('day')}
                className="rounded-xl border border-app-border px-4 py-2.5 text-[13px] font-semibold text-app-text-secondary hover:bg-app-bg dark:border-white/10"
              >
                {t.todoRecurringCancel}
              </button>
              <button
                type="button"
                onClick={submitRecurring}
                disabled={!recTitle.trim() || recPreviewCount <= 0}
                className="rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t.todoRecurringCreate}
              </button>
            </div>
          </section>
        ) : (
          <section className="flex min-h-[22rem] flex-col rounded-2xl border border-app-border bg-white p-4 shadow-sm dark:border-white/10 dark:bg-gray-900/70">
            <div className="mb-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/70">{t.pageTodo}</p>
              <h4 className="mt-0.5 text-base font-bold capitalize text-app-text dark:text-gray-100">{selectedLabel}</h4>
            </div>
            <form
              className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-nowrap sm:items-stretch"
              onSubmit={(e) => {
                e.preventDefault();
                submitDraft();
              }}
            >
              <input
                ref={dayInputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t.todoAddPh}
                className="min-w-0 w-full flex-1 rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-[13.5px] text-app-text outline-none placeholder:text-app-text-secondary/60 focus:border-primary/50 focus:ring-4 focus:ring-primary/10 sm:py-2 dark:border-white/15 dark:bg-gray-800/90 dark:text-gray-100"
              />
              <div className="flex items-stretch gap-2">
                <input
                  type="time"
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                  aria-label={t.todoTimeOptional}
                  title={t.todoTimeOptional}
                  className="w-[7.25rem] flex-shrink-0 rounded-xl border border-app-border bg-app-bg px-2 py-2.5 text-[13px] text-app-text outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/10 sm:w-[5.1rem] sm:px-1 sm:py-2 sm:text-[12px] dark:border-white/15 dark:bg-gray-800/90 dark:text-gray-100"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="min-w-0 flex-1 rounded-xl bg-primary px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none sm:px-3.5 sm:py-2"
                >
                  {t.todoAdd}
                </button>
              </div>
            </form>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {dayTodos.length === 0 && (
                <p className="py-8 text-center text-sm text-app-text-secondary/70">{t.todoEmptyDay}</p>
              )}
              {dayTodos.map((todo) => (
                <div
                  key={todo.id}
                  className="flex flex-col gap-2 rounded-xl border border-app-border/80 bg-app-bg/60 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-2 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggleTodo(todo.id)}
                      className={
                        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border text-[11px] ' +
                        (todo.done
                          ? 'border-emerald-400 bg-emerald-500 text-white'
                          : 'border-app-border bg-white dark:border-white/20 dark:bg-gray-900')
                      }
                      title={todo.done ? t.todoUndone : t.todoDone}
                    >
                      {todo.done ? '✓' : ''}
                    </button>
                    {editingId === todo.id ? (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => {
                          renameTodo(todo.id, editValue);
                          setEditingId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            renameTodo(todo.id, editValue);
                            setEditingId(null);
                          }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-primary/40 bg-white px-2 py-1 text-[13.5px] text-app-text outline-none dark:bg-gray-800 dark:text-gray-100"
                      />
                    ) : (
                      <button
                        type="button"
                        onDoubleClick={() => {
                          setEditingId(todo.id);
                          setEditValue(todo.title);
                        }}
                        onClick={() => {
                          if (window.matchMedia('(pointer: coarse)').matches) {
                            setEditingId(todo.id);
                            setEditValue(todo.title);
                          }
                        }}
                        className={'min-w-0 flex-1 text-left text-[13.5px] leading-5 ' + (todo.done ? 'text-app-text-secondary line-through' : 'text-app-text dark:text-gray-100')}
                      >
                        {todo.title}
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 pl-7 sm:pl-0 sm:justify-end">
                    <input
                      type="time"
                      value={todo.time ?? ''}
                      onChange={(e) => setTodoTime(todo.id, e.target.value)}
                      aria-label={t.todoTimeOptional}
                      title={t.todoTimeOptional}
                      className="w-[7.25rem] flex-shrink-0 rounded-lg border border-app-border/80 bg-white px-2 py-1.5 text-[12px] text-app-text outline-none focus:border-primary/50 sm:w-[5rem] sm:px-1 sm:py-1 sm:text-[11px] dark:border-white/15 dark:bg-gray-800 dark:text-gray-100"
                    />
                    {todo.time && (
                      <button
                        type="button"
                        onClick={() => setTodoTime(todo.id)}
                        className="rounded-lg px-1.5 py-1 text-[11px] text-app-text-secondary hover:bg-app-bg hover:text-app-text dark:hover:bg-white/10"
                        title={t.todoClearTime}
                        aria-label={t.todoClearTime}
                      >
                        ×
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteTodo(todo.id)}
                      className="ml-auto rounded-lg px-2 py-1.5 text-xs text-app-text-secondary hover:bg-red-50 hover:text-red-600 sm:ml-0 dark:hover:bg-red-500/10"
                      title={t.todoDelete}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
