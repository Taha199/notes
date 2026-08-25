import { useEffect, useState } from 'react';
import type { CountdownBackground, CountdownFormat, CountdownItem, CountdownRepeat } from '../../types';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  DEFAULT_COUNTDOWN_FORMAT,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from '../../lib/countdownStore';
import type { CountdownDraft } from '../../contexts/CountdownsContext';

interface Props {
  open: boolean;
  initial?: CountdownItem | null;
  onClose: () => void;
  onSave: (draft: CountdownDraft) => void;
  onDelete?: () => void;
}

const REPEAT_OPTIONS: CountdownRepeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
const BACKGROUND_OPTIONS: CountdownBackground[] = ['sunset', 'ocean', 'night', 'minimal'];

function draftFromItem(item: CountdownItem): CountdownDraft {
  return {
    title: item.title,
    targetAt: item.targetAt,
    repeat: item.repeat,
    format: { ...item.format },
    textShadow: item.textShadow,
    background: item.background,
  };
}

export function CountdownSettingsModal({ open, initial, onClose, onSave, onDelete }: Props) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [targetLocal, setTargetLocal] = useState('');
  const [repeat, setRepeat] = useState<CountdownRepeat>('none');
  const [format, setFormat] = useState<CountdownFormat>({ ...DEFAULT_COUNTDOWN_FORMAT });
  const [textShadow, setTextShadow] = useState(true);
  const [background, setBackground] = useState<CountdownBackground>('sunset');

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const draft = draftFromItem(initial);
      setTitle(draft.title);
      setTargetLocal(toDateTimeLocalValue(draft.targetAt));
      setRepeat(draft.repeat);
      setFormat({ ...draft.format });
      setTextShadow(draft.textShadow);
      setBackground(draft.background);
      return;
    }
    const target = new Date();
    target.setMonth(target.getMonth() + 3);
    target.setHours(23, 0, 0, 0);
    setTitle('');
    setTargetLocal(toDateTimeLocalValue(target.toISOString()));
    setRepeat('none');
    setFormat({ ...DEFAULT_COUNTDOWN_FORMAT });
    setTextShadow(true);
    setBackground('sunset');
  }, [open, initial]);

  if (!open) return null;

  const toggleFormat = (key: keyof CountdownFormat) => {
    setFormat((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const enabled = Object.values(next).some(Boolean);
      return enabled ? next : prev;
    });
  };

  const handleSave = () => {
    if (!targetLocal) return;
    onSave({
      title,
      targetAt: fromDateTimeLocalValue(targetLocal),
      repeat,
      format,
      textShadow,
      background,
    });
    onClose();
  };

  const repeatLabel = (value: CountdownRepeat) => {
    switch (value) {
      case 'none': return t.countdownRepeatNone;
      case 'daily': return t.countdownRepeatDaily;
      case 'weekly': return t.countdownRepeatWeekly;
      case 'monthly': return t.countdownRepeatMonthly;
      case 'yearly': return t.countdownRepeatYearly;
    }
  };

  const backgroundLabel = (value: CountdownBackground) => {
    switch (value) {
      case 'sunset': return t.countdownBgSunset;
      case 'ocean': return t.countdownBgOcean;
      case 'night': return t.countdownBgNight;
      case 'minimal': return t.countdownBgMinimal;
    }
  };

  const formatLabel = (key: keyof CountdownFormat) => {
    switch (key) {
      case 'years': return t.countdownUnitYears;
      case 'months': return t.countdownUnitMonths;
      case 'weeks': return t.countdownUnitWeeks;
      case 'days': return t.countdownUnitDays;
      case 'hours': return t.countdownUnitHours;
      case 'minutes': return t.countdownUnitMinutes;
      case 'seconds': return t.countdownUnitSeconds;
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/45 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-app-border bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-gray-900 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-app-text dark:text-gray-100">{t.countdownSettingsTitle}</h2>

        <div className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-app-text-secondary/70">{t.countdownNameLabel}</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t.countdownNamePh}
              className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-app-text-secondary/70">{t.countdownDateLabel}</label>
            <p className="mb-2 text-xs text-app-text-secondary/60">{t.countdownDateHint}</p>
            <input
              type="datetime-local"
              value={targetLocal}
              onChange={(e) => setTargetLocal(e.target.value)}
              className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-app-text-secondary/70">{t.countdownRepeatLabel}</label>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as CountdownRepeat)}
              className="w-full rounded-xl border border-app-border bg-app-bg px-3 py-2.5 text-sm outline-none focus:border-primary dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option} value={option}>{repeatLabel(option)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-app-text-secondary/70">{t.countdownFormatLabel}</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(format) as Array<keyof CountdownFormat>).map((key) => (
                <label key={key} className="flex cursor-pointer items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm dark:border-white/10">
                  <input
                    type="checkbox"
                    checked={format[key]}
                    onChange={() => toggleFormat(key)}
                    className="accent-primary"
                  />
                  <span>{formatLabel(key)}</span>
                </label>
              ))}
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm dark:border-white/10">
              <input
                type="checkbox"
                checked={textShadow}
                onChange={() => setTextShadow((v) => !v)}
                className="accent-primary"
              />
              <span>{t.countdownTextShadow}</span>
            </label>
          </div>

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-app-text-secondary/70">{t.countdownBackgroundLabel}</label>
            <div className="grid grid-cols-2 gap-2">
              {BACKGROUND_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setBackground(option)}
                  className={'rounded-xl border px-3 py-2 text-sm font-medium transition ' + (background === option ? 'border-primary bg-primary/10 text-primary' : 'border-app-border text-app-text-secondary hover:border-primary/40 dark:border-white/10')}
                >
                  {backgroundLabel(option)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div>
            {onDelete && (
              <button
                type="button"
                onClick={() => { onDelete(); onClose(); }}
                className="rounded-xl px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                {t.countdownDelete}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-app-border px-4 py-2 text-sm font-medium text-app-text-secondary hover:bg-app-bg dark:border-white/10"
            >
              {t.countdownClose}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!targetLocal}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {t.countdownSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
