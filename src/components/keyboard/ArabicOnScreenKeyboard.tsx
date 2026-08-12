import { useState } from 'react';
import { ARABIC_ROWS } from '../../lib/arabicKeyboard';

export function ArabicOnScreenKeyboard({
  onInsert,
  onBackspace,
}: {
  onInsert: (chunk: string) => void;
  onBackspace: () => void;
}) {
  const [shift, setShift] = useState(false);

  return (
    <div className="flex flex-col gap-1.5" dir="ltr">
      {ARABIC_ROWS.map((row, rowIdx) => (
        <div key={rowIdx} className="flex justify-center gap-1">
          {row.map((key) => {
            const label = key.wide === 'shift' || key.wide === 'backspace' || key.wide === 'enter' || key.wide === 'space'
              ? key.label
              : (shift ? key.shift : key.normal);
            const width =
              key.wide === 'space' ? 'flex-[6]'
                : key.wide === 'shift' || key.wide === 'enter' || key.wide === 'backspace' ? 'flex-[1.6]'
                  : 'flex-1';
            const activeShift = key.wide === 'shift' && shift;
            return (
              <button
                key={key.code}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (key.wide === 'shift') {
                    setShift((prev) => !prev);
                    return;
                  }
                  if (key.wide === 'backspace') {
                    onBackspace();
                    return;
                  }
                  onInsert(shift ? key.shift || key.normal : key.normal);
                  if (shift && key.wide !== 'space' && key.wide !== 'enter') setShift(false);
                }}
                className={
                  `${width} min-h-10 rounded-lg border px-1 py-1.5 text-[14px] font-semibold transition-colors sm:min-h-11 sm:py-2 sm:text-[15px] ` +
                  (activeShift
                    ? 'border-primary bg-primary text-white'
                    : 'border-app-border bg-app-bg text-app-text hover:border-primary/40 hover:bg-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100')
                }
                dir="rtl"
              >
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
