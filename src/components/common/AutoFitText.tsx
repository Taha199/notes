import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  text: string;
  maxSize?: number;
  minSize?: number;
  className?: string;
};

export function AutoFitText({ text, maxSize = 13, minSize = 8, className = '' }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const compressedRef = useRef(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const fit = () => {
      let size = maxSize;
      textEl.style.fontSize = `${size}px`;
      const maxWidth = container.clientWidth;
      if (!maxWidth) return;
      while (textEl.scrollWidth > maxWidth && size > minSize) {
        size -= 0.5;
        textEl.style.fontSize = `${size}px`;
      }
      compressedRef.current = size < maxSize;
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text, maxSize, minSize]);

  const showTooltip = () => {
    if (!compressedRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({ x: rect.left, y: rect.bottom + 6 });
  };

  const hideTooltip = () => setTooltip(null);

  return (
    <>
      <span
        ref={containerRef}
        className={`min-w-0 overflow-hidden ${className}`}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
      >
        <span ref={textRef} className="block whitespace-nowrap leading-tight">
          {text}
        </span>
      </span>
      {tooltip && createPortal(
        <span
          role="tooltip"
          style={{ position: 'fixed', left: tooltip.x, top: tooltip.y, zIndex: 9999 }}
          className="pointer-events-none max-w-[240px] rounded-lg border border-app-border bg-white px-2.5 py-1.5 text-[11px] font-medium leading-snug text-app-text shadow-lg dark:border-white/10 dark:bg-gray-800 dark:text-gray-100"
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
