import { useLayoutEffect, useRef } from 'react';
import { normalizeYouTubeEmbeds } from '../../lib/youtubeEmbed';
import { fitAllNoteTables, normalizeTablesInEditor } from '../../lib/noteTable';

function stableHtmlEqual(a: string, b: string): boolean {
  if (a === b) return true;
  return a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
}

interface StableNoteHtmlProps {
  html: string;
  className?: string;
  dir?: 'auto' | 'ltr' | 'rtl';
}

/** Renders note/quiz HTML without re-parsing when parent re-renders with the same content. */
export function StableNoteHtml({ html, className, dir = 'auto' }: StableNoteHtmlProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHtmlRef = useRef('');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || stableHtmlEqual(html, lastHtmlRef.current)) return;
    lastHtmlRef.current = html;
    el.innerHTML = html;
    normalizeYouTubeEmbeds(el);
    normalizeTablesInEditor(el);
    fitAllNoteTables(el);
  }, [html]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      fitAllNoteTables(el);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <div ref={ref} dir={dir} className={className} />;
}
