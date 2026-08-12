import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function ArabicInputHost() {
  const { enabled, setEnabled } = useArabicInput();
  const { t } = useLanguage();
  const lastEditable = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    const remember = (e: FocusEvent) => {
      if (isEditableTarget(e.target)) lastEditable.current = e.target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPos(null);
      return;
    }

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

  useLayoutEffect(() => {
    if (!enabled || pos) return;
    const el = panelRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: clamp((window.innerWidth - width) / 2, 8, Math.max(8, window.innerWidth - width - 8)),
      y: clamp(window.innerHeight - height - 24, 8, Math.max(8, window.innerHeight - height - 8)),
    });
  }, [enabled, pos]);

  useEffect(() => {
    if (!enabled) return;

    const onMove = (e: PointerEvent) => {
      if (!drag.current || !panelRef.current) return;
      const { width, height } = panelRef.current.getBoundingClientRect();
      const dx = e.clientX - drag.current.startX;
      const dy = e.clientY - drag.current.startY;
      setPos({
        x: clamp(drag.current.originX + dx, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(drag.current.originY + dy, 8, Math.max(8, window.innerHeight - height - 8)),
      });
    };

    const onUp = () => {
      drag.current = null;
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
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

  const startDrag = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (!panelRef.current || !pos) return;
    e.preventDefault();
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    document.body.style.userSelect = 'none';
  };

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-40 w-[min(44rem,calc(100vw-1.5rem))]"
      style={{
        left: pos?.x ?? 8,
        top: pos?.y ?? 8,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="rounded-2xl border border-app-border bg-white/95 p-2 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-gray-900/95">
        <div
          onPointerDown={startDrag}
          className="mb-1.5 flex cursor-grab items-center gap-2 rounded-xl px-1 py-0.5 active:cursor-grabbing"
          title={t.arabicKbDragHint}
        >
          <span className="select-none text-app-text-secondary/50" aria-hidden="true">⋮⋮</span>
          <p className="min-w-0 flex-1 select-none text-[11px] font-medium text-app-text-secondary dark:text-gray-400">
            {t.arabicKbOptionalHint}
          </p>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEnabled(false)}
            aria-label={t.arabicKbToggleOff}
            title={t.arabicKbToggleOff}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-app-text-secondary transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <ArabicOnScreenKeyboard onInsert={insert} onBackspace={backspace} />
      </div>
    </div>,
    document.body,
  );
}
