import type { QuizSetColorOption } from '../../lib/quizColors';
import { QUIZ_COLOR_GRID_COLS } from '../../lib/quizColors';

type Props = {
  colors: QuizSetColorOption[];
  activeValue: string;
  onPick: (value: string) => void;
};

/**
 * Compact 6-column swatch grid for set/folder accent colors.
 * Clear (✕) sits alone on the first row; the rest fill a rainbow grid.
 */
export function QuizColorPickerGrid({ colors, activeValue, onPick }: Props) {
  const clear = colors.find((c) => !c.value);
  const swatches = colors.filter((c) => c.value);

  return (
    <div className="px-3 py-2.5">
      {clear && (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            title={clear.name}
            onClick={() => onPick('')}
            className={
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-white text-[11px] text-app-text-secondary transition ' +
              'hover:border-app-text/40 hover:bg-app-bg dark:bg-gray-900 dark:hover:bg-white/5 ' +
              (!activeValue
                ? 'border-app-text ring-2 ring-primary/35 dark:border-white'
                : 'border-app-border dark:border-white/20')
            }
          >
            ✕
          </button>
          <span className="text-[11px] text-app-text-secondary/80 dark:text-gray-400">{clear.name}</span>
        </div>
      )}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${QUIZ_COLOR_GRID_COLS}, minmax(0, 1fr))` }}
      >
        {swatches.map((c) => {
          const active = activeValue === c.value;
          return (
            <button
              key={c.value}
              type="button"
              title={c.name}
              onClick={() => onPick(c.value)}
              className={
                'aspect-square w-full rounded-full border transition ' +
                'hover:scale-110 hover:shadow-sm ' +
                (active
                  ? 'border-white ring-2 ring-app-text/80 ring-offset-1 ring-offset-white dark:border-gray-900 dark:ring-white dark:ring-offset-gray-800'
                  : 'border-black/10 dark:border-white/15')
              }
              style={{ backgroundColor: c.value }}
            />
          );
        })}
      </div>
    </div>
  );
}
