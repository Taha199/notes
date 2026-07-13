import { useLayoutEffect, useRef } from 'react';

type Props = {
  text: string;
  maxSize?: number;
  minSize?: number;
  className?: string;
};

export function AutoFitText({ text, maxSize = 13, minSize = 8, className = '' }: Props) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

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
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [text, maxSize, minSize]);

  return (
    <span ref={containerRef} className={`min-w-0 overflow-hidden ${className}`}>
      <span ref={textRef} className="block whitespace-nowrap leading-tight">
        {text}
      </span>
    </span>
  );
}
