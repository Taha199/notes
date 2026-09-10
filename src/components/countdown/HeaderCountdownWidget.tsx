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

export function HeaderCountdownWidget({
  className = '',
  onOpen,
}: {
  className?: string;
  onOpen?: () => void;
}) {
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
    <button
      type="button"
      onClick={onOpen}
      title={selected.title}
      className={'inline-flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ' + className}
    >
      <span className="max-w-[11rem] truncate text-[11px] font-semibold text-app-text-secondary dark:text-gray-300">
        {selected.title}
      </span>
      <span className="whitespace-nowrap text-[11px] tabular-nums text-primary dark:text-primary/90">
        {timerText}
      </span>
    </button>
  );
}
