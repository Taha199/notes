import { useEffect, useMemo, useState } from 'react';
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
  const { countdowns, headerCountdownId } = useCountdowns();
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

  if (!selected) return null;

  return (
    <div className={'inline-flex min-w-0 items-center gap-1.5 ' + className}>
      <span
        className="max-w-[11rem] truncate text-[11px] font-semibold text-app-text-secondary dark:text-gray-300"
        title={selected.title}
      >
        {selected.title}
      </span>
      <span className="whitespace-nowrap text-[11px] tabular-nums text-primary dark:text-primary/90">
        {timerText}
      </span>
    </div>
  );
}
