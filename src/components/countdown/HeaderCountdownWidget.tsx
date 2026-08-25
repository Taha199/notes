import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { useCountdowns } from '../../contexts/CountdownsContext';
import {
  computeCountdownParts,
  enabledFormatUnits,
  padCountdownUnit,
  type CountdownUnit,
} from '../../lib/countdownStore';

const UNIT_SHORT: Record<CountdownUnit, string> = {
  years: 'y',
  months: 'mo',
  weeks: 'w',
  days: 'd',
  hours: 'h',
  minutes: 'm',
  seconds: 's',
};

export function HeaderCountdownWidget({ className = '' }: { className?: string }) {
  const { t } = useLanguage();
  const { countdowns, headerCountdownId, setHeaderCountdownId } = useCountdowns();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const selected = useMemo(
    () => countdowns.find((row) => row.id === headerCountdownId) ?? null,
    [countdowns, headerCountdownId],
  );

  const timerText = useMemo(() => {
    if (!selected) return '';
    const parts = computeCountdownParts(selected.targetAt, selected.repeat, selected.format, now);
    const units = enabledFormatUnits(selected.format);
    return units.map((unit) => `${padCountdownUnit(parts[unit], unit)}${UNIT_SHORT[unit]}`).join(' ');
  }, [selected, now]);

  if (!countdowns.length) return null;

  return (
    <div className={'inline-flex min-w-0 items-center gap-1.5 ' + className}>
      {selected && (
        <span
          className="hidden max-w-[11rem] truncate text-[11px] font-semibold text-app-text-secondary dark:text-gray-300 lg:inline"
          title={selected.title}
        >
          {selected.title}
        </span>
      )}
      {selected && (
        <span className="hidden whitespace-nowrap text-[11px] tabular-nums text-primary dark:text-primary/90 sm:inline">
          {timerText}
        </span>
      )}
      <select
        value={headerCountdownId ?? ''}
        onChange={(e) => setHeaderCountdownId(e.target.value || null)}
        aria-label={t.countdownHeaderSelect}
        title={t.countdownHeaderSelect}
        className="max-w-[7.5rem] truncate rounded-lg border border-app-border bg-app-bg px-1.5 py-0.5 text-[11px] font-medium text-app-text-secondary outline-none focus:border-primary/50 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 sm:max-w-[9rem]"
      >
        <option value="">{t.countdownHeaderNone}</option>
        {countdowns.map((item) => (
          <option key={item.id} value={item.id}>{item.title}</option>
        ))}
      </select>
    </div>
  );
}
