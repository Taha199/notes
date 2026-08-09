import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  readAiAnswerStyle,
  writeAiAnswerStyle,
  type AiAnswerStyle,
} from '../../lib/aiAnswerStyle';

export function useAiAnswerStyle(): [AiAnswerStyle, (style: AiAnswerStyle) => void] {
  const [style, setStyleState] = useState<AiAnswerStyle>(() => readAiAnswerStyle());
  const setStyle = (next: AiAnswerStyle) => {
    setStyleState(next);
    writeAiAnswerStyle(next);
  };
  return [style, setStyle];
}

/** Compact segmented control for AI Answer length — place next to the AI Answer button. */
export function AiAnswerStyleToggle({
  value,
  onChange,
  className = '',
}: {
  value: AiAnswerStyle;
  onChange: (style: AiAnswerStyle) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const options: { id: AiAnswerStyle; label: string }[] = [
    { id: 'short', label: t.quizAiStyleShort },
    { id: 'long', label: t.quizAiStyleLong },
  ];

  return (
    <div
      role="group"
      aria-label={t.quizAiStyleLabel}
      className={
        'inline-flex h-7 max-w-full shrink-0 overflow-hidden rounded-lg border border-app-border dark:border-white/15 ' +
        className
      }
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            title={opt.label}
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={
              'max-w-[9.5rem] truncate px-2 text-[10px] font-semibold leading-none transition-all ' +
              (active
                ? 'bg-violet-100 text-violet-800 dark:bg-violet-500/25 dark:text-violet-200'
                : 'bg-transparent text-app-text-secondary/70 hover:bg-app-bg hover:text-app-text dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200')
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
