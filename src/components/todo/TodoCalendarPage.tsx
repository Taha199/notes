import { useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useTodos } from '../../contexts/TodosContext';
import { addMonths, monthGrid, toDateKey, todosForDate } from '../../lib/todosStore';
import { normalizeSearch } from '../../lib/noteSearch';

function weekdayLabels(locale: string): string[] {
  const monday = new Date(2026, 7, 10);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day);
  });
}

export function TodoCalendarPage({ search = '' }: { search?: string }) {
  const { t } = useLanguage();
  const { todos, addTodo, toggleTodo, renameTodo, setTodoTime, deleteTodo } = useTodos();
  const todayKey = toDateKey(new Date());
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [draft, setDraft] = useState('');
  const [draftTime, setDraftTime] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const query = normalizeSearch(search);
  const visibleTodos = useMemo(
    () => (query ? todos.filter((todo) => normalizeSearch(todo.title).includes(query)) : todos),
    [todos, query],
  );
  const cells = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const weekdays = useMemo(() => weekdayLabels(t.dateLocale), [t.dateLocale]);
  const monthLabel = new Intl.DateTimeFormat(t.dateLocale, { month: 'long', year: 'numeric' }).format(cursor);
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

  const submitDraft = () => {
    addTodo(draft, selectedKey, draftTime);
    setDraft('');
    setDraftTime('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor((prev) => addMonths(prev, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-app-border bg-white text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
            title={t.todoPrevMonth}
          >
            ‹
          </button>
          <h3 className="min-w-[10.5rem] text-center text-lg font-bold capitalize tracking-tight text-app-text dark:text-gray-100">
            {monthLabel}
          </h3>
          <button
            type="button"
            onClick={() => setCursor((prev) => addMonths(prev, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-app-border bg-white text-app-text-secondary hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5"
            title={t.todoNextMonth}
          >
            ›
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const now = new Date();
            setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
            setSelectedKey(todayKey);
          }}
          className="rounded-xl border border-app-border bg-white px-3.5 py-2 text-[13px] font-semibold text-app-text hover:border-primary/40 hover:text-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
        >
          {t.todoToday}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
        <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900/70">
          <div className="grid grid-cols-7 border-b border-app-border bg-app-bg/80 px-1 py-2 dark:border-white/10 dark:bg-white/5">
            {weekdays.map((label) => (
              <div key={label} className="text-center text-[11px] font-bold uppercase tracking-wider text-app-text-secondary/80">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((day) => {
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
                  onClick={() => setSelectedKey(key)}
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
        </div>

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
                        // Mobile: single tap to rename (double-click is awkward on phones).
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
      </div>
    </div>
  );
}
