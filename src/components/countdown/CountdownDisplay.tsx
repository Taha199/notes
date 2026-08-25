import { useEffect, useMemo, useState } from 'react';
import type { CountdownBackground, CountdownItem } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  computeCountdownParts,
  enabledFormatUnits,
  padCountdownUnit,
  type CountdownUnit,
} from '../../lib/countdownStore';

const BACKGROUNDS: Record<CountdownBackground, string> = {
  sunset: 'linear-gradient(90deg, rgba(88,28,135,0.72) 0%, rgba(236,72,153,0.45) 45%, rgba(14,116,144,0.55) 100%), linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #0f766e 100%)',
  ocean: 'linear-gradient(90deg, rgba(14,165,233,0.55) 0%, rgba(2,132,199,0.75) 100%), linear-gradient(135deg, #0c4a6e 0%, #0369a1 50%, #164e63 100%)',
  night: 'linear-gradient(90deg, rgba(15,23,42,0.92) 0%, rgba(30,41,59,0.98) 100%), radial-gradient(circle at 15% 50%, rgba(148,163,184,0.2), transparent 45%)',
  minimal: 'linear-gradient(90deg, rgba(108,99,255,0.14) 0%, rgba(255,255,255,0.96) 100%)',
};

function unitLabel(unit: CountdownUnit, t: Record<string, string>): string {
  switch (unit) {
    case 'years': return t.countdownUnitYears;
    case 'months': return t.countdownUnitMonths;
    case 'weeks': return t.countdownUnitWeeks;
    case 'days': return t.countdownUnitDays;
    case 'hours': return t.countdownUnitHours;
    case 'minutes': return t.countdownUnitMinutes;
    case 'seconds': return t.countdownUnitSeconds;
    default: return '';
  }
}

export function CountdownDisplay({
  item,
  onEdit,
  pinned = false,
  onTogglePin,
  className = '',
}: {
  item: CountdownItem;
  onEdit?: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const parts = useMemo(
    () => computeCountdownParts(item.targetAt, item.repeat, item.format, now),
    [item, now],
  );
  const units = useMemo(() => enabledFormatUnits(item.format), [item.format]);
  const shadow = item.textShadow ? '0 1px 10px rgba(0,0,0,0.35)' : undefined;
  const bg = BACKGROUNDS[item.background] ?? BACKGROUNDS.sunset;
  const isMinimal = item.background === 'minimal';

  return (
    <div
      className={
        'group relative overflow-hidden rounded-2xl border shadow-md ' +
        (isMinimal ? 'border-app-border text-app-text dark:border-white/10 dark:text-gray-100' : 'border-white/10 text-white') +
        ' ' + className
      }
      style={{ background: bg }}
    >
      <div className="absolute inset-0 bg-black/10" aria-hidden="true" />
      <div className="relative flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5 sm:py-4">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-xl font-bold leading-tight tracking-tight sm:text-2xl"
            style={{ textShadow: shadow }}
          >
            {item.title}
          </h2>
          {parts.expired && (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider opacity-80">{t.countdownExpired}</p>
          )}
        </div>

        <div className="flex flex-shrink-0 items-end gap-2 overflow-x-auto sm:gap-2.5">
          {units.map((unit, index) => {
            const value = parts[unit];
            const label = unitLabel(unit, t as unknown as Record<string, string>);
            const highlight = unit === 'hours' && units.includes('days') && units.includes('minutes');
            const showColon = index > 0 && (unit === 'minutes' || unit === 'seconds') && units[index - 1] === 'hours';
            return (
              <div key={unit} className="flex items-end gap-2 sm:gap-2.5">
                {showColon && (
                  <span className="mb-5 text-xl font-extralight opacity-80 sm:text-2xl" style={{ textShadow: shadow }}>:</span>
                )}
                <div className="flex flex-col items-center">
                  <div
                    className={
                      'flex min-w-[2.4rem] items-center justify-center rounded-lg px-1.5 py-0.5 sm:min-w-[2.75rem] ' +
                      (highlight ? 'bg-sky-300/25 ring-1 ring-sky-100/30 backdrop-blur-sm' : '')
                    }
                  >
                    <span
                      className="text-2xl font-extralight tabular-nums tracking-tight sm:text-3xl"
                      style={{ textShadow: shadow }}
                    >
                      {padCountdownUnit(value, unit)}
                    </span>
                  </div>
                  <span
                    className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.18em] opacity-85 sm:text-[9px]"
                    style={{ textShadow: shadow }}
                  >
                    {label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {(onTogglePin || onEdit) && (
          <div className="flex flex-shrink-0 items-center justify-end gap-1 self-end sm:self-center">
            {onTogglePin && (
              <button
                type="button"
                onClick={onTogglePin}
                title={pinned ? t.countdownUnpinHeader : t.countdownPinHeader}
                aria-pressed={pinned}
                className={
                  'rounded-lg border px-2 py-1 text-[13px] leading-none backdrop-blur-md transition ' +
                  (pinned
                    ? (isMinimal
                      ? 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-400/40 dark:bg-sky-500/20 dark:text-sky-300'
                      : 'border-sky-200/50 bg-sky-400/30 text-white ring-1 ring-sky-100/40')
                    : (isMinimal
                      ? 'border-app-border bg-white/90 text-app-text-secondary opacity-0 hover:bg-white group-hover:opacity-100 dark:border-white/10 dark:bg-gray-900/90 dark:text-gray-300'
                      : 'border-white/25 bg-black/30 text-white opacity-0 hover:bg-black/45 group-hover:opacity-100'))
                }
              >
                📌
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className={
                  'rounded-lg border px-2 py-1 text-[11px] font-semibold opacity-0 backdrop-blur-md transition group-hover:opacity-100 ' +
                  (isMinimal
                    ? 'border-app-border bg-white/90 text-app-text-secondary hover:bg-white dark:border-white/10 dark:bg-gray-900/90 dark:text-gray-300'
                    : 'border-white/25 bg-black/30 text-white hover:bg-black/45')
                }
              >
                ⚙
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
