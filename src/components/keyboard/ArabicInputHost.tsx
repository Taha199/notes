import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useArabicInput } from '../../contexts/ArabicInputContext';
import { useLanguage } from '../../contexts/LanguageContext';
import {
  arabicFromCode,
  backspaceInEditable,
  insertIntoEditable,
  isEditableTarget,
  shouldRemapPhysicalKey,
} from '../../lib/arabicKeyboard';
import { ArabicOnScreenKeyboard } from './ArabicOnScreenKeyboard';

export function ArabicInputHost() {
  const { enabled, setEnabled } = useArabicInput();
  const { t } = useLanguage();
  const lastEditable = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const remember = (e: FocusEvent) => {
      if (isEditableTarget(e.target)) lastEditable.current = e.target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!shouldRemapPhysicalKey(e)) return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('[data-arabic-local]')) return;
      if (!isEditableTarget(target)) return;
      const mapped = arabicFromCode(e.code, e.shiftKey);
      if (mapped == null) return;
      e.preventDefault();
      lastEditable.current = target;
      insertIntoEditable(target, mapped);
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);

  if (!enabled) return null;

  const insert = (chunk: string) => {
    const el = lastEditable.current;
    if (!el || !document.contains(el)) return;
    el.focus();
    insertIntoEditable(el, chunk);
  };

  const backspace = () => {
    const el = lastEditable.current;
    if (!el || !document.contains(el)) return;
    el.focus();
    backspaceInEditable(el);
  };

  return createPortal(
    <div className="fixed bottom-20 left-3 right-20 z-40 max-w-3xl sm:bottom-5 sm:left-1/2 sm:right-auto sm:w-[min(44rem,calc(100vw-7.5rem))] sm:-translate-x-[calc(50%+1.5rem)]">
      <div className="rounded-2xl border border-app-border bg-white/95 p-2 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-gray-900/95">
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
          <p className="text-[11px] font-medium text-app-text-secondary dark:text-gray-400">
            {t.arabicKbOptionalHint}
          </p>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEnabled(false)}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-app-text-secondary hover:bg-app-bg hover:text-app-text dark:hover:bg-white/10 dark:hover:text-gray-100"
          >
            {t.arabicKbToggleOff}
          </button>
        </div>
        <ArabicOnScreenKeyboard onInsert={insert} onBackspace={backspace} />
      </div>
    </div>,
    document.body,
  );
}
