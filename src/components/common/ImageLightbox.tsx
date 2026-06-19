import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Global click-to-zoom for content images. Listens for clicks on <img> elements
 * that are NOT inside an editable area, and shows them enlarged in an overlay.
 */
export function ImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target || target.tagName !== 'IMG') return;
      // Don't zoom while editing inside a contentEditable
      if (target.closest('[contenteditable="true"]')) return;
      const img = target as HTMLImageElement;
      if (!img.src) return;
      e.preventDefault();
      e.stopPropagation();
      setSrc(img.src);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSrc(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src]);

  if (!src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={() => setSrc(null)}
    >
      <img
        src={src}
        alt=""
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'lightboxZoom 0.22s cubic-bezier(.2,.8,.2,1)' }}
        className="max-h-[92vh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
      />
      <style>{`@keyframes lightboxZoom{from{transform:scale(.85);opacity:0}to{transform:scale(1);opacity:1}}`}</style>
      <button
        onClick={() => setSrc(null)}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25"
        aria-label="Close"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
