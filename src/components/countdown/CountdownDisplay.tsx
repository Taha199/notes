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
  sunset: 'linear-gradient(180deg, rgba(88,28,135,0.55) 0%, rgba(236,72,153,0.35) 45%, rgba(14,116,144,0.45) 100%), linear-gradient(135deg, #1e1b4b 0%, #312e81 40%, #0f766e 100%)',
  ocean: 'linear-gradient(180deg, rgba(14,165,233,0.35) 0%, rgba(2,132,199,0.55) 100%), linear-gradient(135deg, #0c4a6e 0%, #0369a1 50%, #164e63 100%)',
  night: 'linear-gradient(180deg, rgba(15,23,42,0.85) 0%, rgba(30,41,59,0.95) 100%), radial-gradient(circle at 20% 20%, rgba(148,163,184,0.25), transparent 40%)',
  minimal: 'linear-gradient(135deg, rgba(108,99,255,0.18) 0%, rgba(255,255,255,0.92) 100%)',
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
  compact = false,
  className = '',
}: {
  item: CountdownItem;
  compact?: boolean;
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
  const shadow = item.textShadow ? 'drop-shadow(0 2px 16px rgba(0,0,0,0.45))' : undefined;
  const bg = BACKGROUNDS[item.background] ?? BACKGROUNDS.sunset;

  return (
    <div
      className={
        'relative overflow-hidden rounded-3xl border border-white/10 shadow-xl ' +
        (compact ? 'min-h-[220px]' : 'min-h-[320px] sm:min-h-[380px]') +
        (item.background === 'minimal' ? ' text-app-text dark:text-gray-100' : ' text-white') +
        ' ' + className
      }
      style={{ background: bg }}
    >
      <div className="absolute inset-0 bg-black/10" aria-hidden="true" />
      <div className={'relative flex h-full flex-col ' + (compact ? 'p-5' : 'p-6 sm:p-8')}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className={'font-semibold tracking-wide ' + (compact ? 'text-sm' : 'text-base sm:text-lg')} style={{ textShadow: shadow ? '0 1px 8px rgba(0,0,0,0.35)' : undefined }}>
              {item.title}
            </p>
            {parts.expired && (
              <p className="mt-1 text-xs font-medium uppercase tracking-wider opacity-80">{t.countdownExpired}</p>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center">
          <div className={'flex flex-wrap items-end justify-center gap-x-3 gap-y-4 ' + (compact ? 'scale-90' : '')}>
            {units.map((unit, index) => {
              const value = parts[unit];
              const label = unitLabel(unit, t as unknown as Record<string, string>);
              const highlight = unit === 'hours' && units.includes('days') && units.includes('minutes');
              const showColon = index > 0 && (unit === 'minutes' || unit === 'seconds') && units[index - 1] === 'hours';
              return (
                <div key={unit} className="flex items-end gap-3">
                  {showColon && (
                    <span className={'mb-8 font-extralight ' + (compact ? 'text-3xl' : 'text-4xl sm:text-5xl')} style={{ textShadow: shadow }}>:</span>
                  )}
                  <div className="flex flex-col items-center">
                    <div
                      className={
                        'flex min-w-[4.5rem] items-center justify-center rounded-2xl px-3 py-2 ' +
                        (highlight ? 'bg-sky-300/25 ring-1 ring-sky-100/30 backdrop-blur-sm' : '')
                      }
                    >
                      <span
                        className={'font-extralight tabular-nums tracking-tight ' + (compact ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-7xl')}
                        style={{ textShadow: shadow }}
                      >
                        {padCountdownUnit(value, unit)}
                      </span>
                    </div>
                    <span
                      className={'mt-2 text-[10px] font-medium uppercase tracking-[0.22em] opacity-85 sm:text-[11px]'}
                      style={{ textShadow: shadow ? '0 1px 6px rgba(0,0,0,0.35)' : undefined }}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
