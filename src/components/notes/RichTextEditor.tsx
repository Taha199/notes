import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const HIGHLIGHT_COLORS = ['#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA', '#CE93D8', '#F48FB1', '#FFCC80', '#EF9A9A', '#B0BEC5', '#FFFFFF'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const STATE_COMMANDS = [...TOGGLE_COMMANDS, 'justifyRight', 'justifyCenter', 'justifyLeft'];
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

interface Props {
  html: string;
  onChange: (html: string) => void;
  placeholder: string;
  editable?: boolean;
  minHeight?: string;
  maxHeight?: string;
  toolbarEnd?: ReactNode;
  onLockedTripleClick?: () => void;
}

export function RichTextEditor({ html, onChange, placeholder, editable = true, minHeight = '120px', maxHeight, toolbarEnd, onLockedTripleClick }: Props) {
  const { t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const pendingFontSize = useRef<number | null>(null);
  const [fontSize, setFontSizeState] = useState(12);
  const fontSizeRef = useRef(12); // ref so selectionchange closure always sees current value
  const setFontSize = (v: number) => { fontSizeRef.current = v; setFontSizeState(v); };
  const [activeCmds, setActiveCmds] = useState<Set<string>>(new Set());
  const [palOpen, setPalOpen] = useState(false);
  const [palPos, setPalPos] = useState({ left: 0, top: 0 });
  const [barColor, setBarColor] = useState('#534AB7');
  const [hlPalOpen, setHlPalOpen] = useState(false);
  const [hlPalPos, setHlPalPos] = useState({ left: 0, top: 0 });
  const [hlColor, setHlColor] = useState('#FFEB3B');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const naturalSizeRef = useRef<{ w: number; h: number } | null>(null);
  const [hoveredImg, setHoveredImg] = useState<{ el: HTMLImageElement; rect: DOMRect } | null>(null);
  const colorWrapRef = useRef<HTMLDivElement>(null);
  const hlWrapRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);

  // ── Helpers ──────────────────────────────────────────────────────────
  // Get the live selection inside the editor right now (returns null if focus is elsewhere).
  const liveRange = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return null;
    return range;
  };

  const saveSel = () => {
    const r = liveRange();
    if (r) savedRange.current = r.cloneRange();
  };

  const selectEditorEnd = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    savedRange.current = range.cloneRange();
  };

  const restoreSel = () => {
    if (!savedRange.current) selectEditorEnd();
    if (!savedRange.current) return;
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(savedRange.current);
  };

  // Ensure the editor has focus. If it already has focus the selection is
  // untouched (buttons use e.preventDefault to prevent focus theft).
  const ensureFocus = (restoreIfNeeded = false) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (document.activeElement !== ed) {
      ed.focus({ preventScroll: true });
      if (restoreIfNeeded) restoreSel();
    }
  };

  const clearPendingAll = () => {
    pendingFontSize.current = null;
  };

  // ── Initial content ───────────────────────────────────────────────────
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editorRef.current && document.activeElement !== editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
    }
  }, [html]);

  // ── Command state ─────────────────────────────────────────────────────
  const readCommandState = () => {
    const active = new Set<string>();
    STATE_COMMANDS.forEach((c) => {
      try { if (document.queryCommandState(c)) active.add(c); } catch { /* noop */ }
    });
    setActiveCmds(active);
    return active;
  };

  // ── Font size indicator in sync with caret ────────────────────────────
  const syncFontSizeFromCaret = () => {
    const ed = editorRef.current;
    const sel = window.getSelection();
    if (!ed || !sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (node === ed) {
      if (fontSizeRef.current !== 12) setFontSize(12);
    } else if (node instanceof Element && ed.contains(node)) {
      const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
      if (px && px !== fontSizeRef.current) setFontSize(px);
    }
  };

  useEffect(() => {
    const handler = () => {
      const ed = editorRef.current;
      if (ed && (document.activeElement === ed || ed.contains(document.activeElement))) {
        saveSel();
        readCommandState();
        syncFontSizeFromCaret();
      }
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── exec: apply a formatting command ─────────────────────────────────
  const exec = (cmd: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    // Buttons use e.preventDefault so editor keeps focus & selection intact.
    // Only restore savedRange when editor actually lost focus (e.g. after palette).
    if (document.activeElement !== ed) {
      const saved = savedRange.current?.cloneRange() ?? null;
      ed.focus({ preventScroll: true });
      if (saved) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(saved); }
    }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    saveSel();
    readCommandState();
    onChange(ed.innerHTML);
  };

  // ── Font size ─────────────────────────────────────────────────────────
  const clearPendingFontMarker = () => {
    const ed = editorRef.current;
    if (ed) {
      ed.querySelectorAll<HTMLElement>('[data-font-marker]').forEach((s) => {
        // Remove the zero-width space; if span is now empty, remove it entirely.
        s.innerHTML = s.innerHTML.replace(/​/g, '');
        if (!s.textContent?.trim()) s.remove();
        else s.removeAttribute('data-font-marker');
      });
    }
    pendingFontSize.current = null;
  };

  const setFutureFontSize = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (document.activeElement !== ed) {
      ed.focus({ preventScroll: true });
      restoreSel();
    }
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!range || !range.collapsed) { setFontSize(px); return; }
    // Finalize any previous marker (keep its text, just stop tracking it).
    ed.querySelectorAll<HTMLElement>('[data-font-marker]').forEach((s) => s.removeAttribute('data-font-marker'));
    // Insert a zero-width-space span at the caret so the browser types INTO it.
    const span = document.createElement('span');
    span.setAttribute('data-font-marker', 'true');
    span.style.fontSize = `${px}px`;
    const zws = document.createTextNode('​');
    span.appendChild(zws);
    range.insertNode(span);
    // Place cursor after the zero-width space (inside the span).
    range.setStart(zws, zws.length);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    pendingFontSize.current = px;
    setFontSize(px);
    saveSel();
    onChange(ed.innerHTML);
  };

  const applyPx = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;

    let range: Range | null = null;
    if (document.activeElement === ed) {
      // Editor has focus: trust the live selection (e.g. +/− buttons with e.preventDefault).
      const s = window.getSelection();
      if (s && s.rangeCount > 0 && !s.isCollapsed && ed.contains(s.anchorNode)) {
        range = s.getRangeAt(0);
      }
    } else {
      // Editor blurred (e.g. typed a value in the font-size input): restore savedRange.
      const saved = savedRange.current?.cloneRange() ?? null;
      if (saved && !saved.collapsed) {
        ed.focus({ preventScroll: true });
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(saved);
        range = s?.getRangeAt(0) ?? null;
      }
    }

    if (!range) {
      setFutureFontSize(px);
      return;
    }

    const contents = range.extractContents();
    contents.querySelectorAll?.('[style]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.removeProperty('font-size');
      if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
    });
    contents.querySelectorAll?.('font[size]').forEach((node) => node.removeAttribute('size'));
    const span = document.createElement('span');
    span.style.fontSize = `${px}px`;
    span.appendChild(contents);
    range.insertNode(span);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    const finalSel = window.getSelection();
    finalSel?.removeAllRanges();
    finalSel?.addRange(nextRange);
    saveSel();
    onChange(ed.innerHTML);
  };

  const nextSz = (cur: number, d: number) => {
    if (d > 0) return SIZES.find((s) => s > cur) ?? SIZES[SIZES.length - 1];
    return [...SIZES].reverse().find((s) => s < cur) ?? SIZES[0];
  };

  const changeSize = (d: number) => {
    const s = nextSz(fontSizeRef.current, d);
    const ed = editorRef.current;
    const sel = window.getSelection();
    const hasLiveSelection = !!(ed && sel && sel.rangeCount > 0 && !sel.isCollapsed && ed.contains(sel.anchorNode));
    if (hasLiveSelection) {
      applyPx(s);
    } else {
      setFutureFontSize(s);
    }
  };

  // ── Color / highlight ─────────────────────────────────────────────────
  // Color palette is a floating overlay so the editor may have lost focus.
  // We MUST restore selection here.
  const togglePalette = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    saveSel();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPalPos({ left: rect.left, top: rect.bottom + 8 });
    setPalOpen((o) => !o);
  };

  const applyColor = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBarColor(c);
    const rangeToUse = savedRange.current?.cloneRange() ?? null;
    ed.focus({ preventScroll: true });
    if (rangeToUse) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(rangeToUse); }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, c);
    saveSel();
    setPalOpen(false);
    onChange(ed.innerHTML);
  };

  const toggleHlPalette = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    saveSel();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHlPalPos({ left: rect.left, top: rect.bottom + 8 });
    setHlPalOpen((o) => !o);
  };

  const applyHighlight = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setHlColor(c);
    const rangeToUse = savedRange.current?.cloneRange() ?? null;
    ed.focus({ preventScroll: true });
    if (rangeToUse) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(rangeToUse); }
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('backColor', false, c);
    saveSel();
    setHlPalOpen(false);
    onChange(ed.innerHTML);
  };

  // ── Image ─────────────────────────────────────────────────────────────
  const insertImage = (file: File) => {
    const ed = editorRef.current;
    if (!ed || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      ensureFocus(true);
      document.execCommand('insertHTML', false, `<img src="${url}" style="display:block;max-width:160px;max-height:160px;height:auto;border-radius:8px;margin:4px 0;cursor:zoom-in;" /><br>`);
      saveSel();
      onChange(ed.innerHTML);
    };
    reader.readAsDataURL(file);
  };

  // ── Close palette on outside click ────────────────────────────────────
  useEffect(() => {
    if (!palOpen) return;
    const close = (e: MouseEvent) => { if (!colorWrapRef.current?.contains(e.target as Node)) setPalOpen(false); };
    const closeAll = () => setPalOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [palOpen]);

  useEffect(() => {
    if (!hlPalOpen) return;
    const close = (e: MouseEvent) => { if (!hlWrapRef.current?.contains(e.target as Node)) setHlPalOpen(false); };
    const closeAll = () => setHlPalOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [hlPalOpen]);

  useEffect(() => {
    if (!previewImage) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreviewImage(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewImage]);

  // ── Button class ──────────────────────────────────────────────────────
  const btnCls = (active: boolean) =>
    'flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all ' +
    (active
      ? 'bg-gray-900 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.8)] -translate-y-px dark:bg-primary dark:shadow-[0_3px_0_0_rgba(108,99,255,0.6)]'
      : 'text-app-text-secondary hover:bg-white dark:hover:bg-white/10');

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div ref={editorWrapRef} className={'relative ' + (editable ? '' : '[&_img]:cursor-zoom-in')}>
      {/* Toolbar */}
      <div
        className="flex flex-wrap items-center gap-0.5 border-b border-app-border bg-app-bg px-3 py-1.5 dark:border-white/10 dark:bg-white/5"
        style={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.4 }}
      >
        {/* Font size */}
        <div className="flex items-center overflow-hidden rounded-lg border border-app-border bg-white dark:border-white/10 dark:bg-gray-900">
          <button type="button" onMouseDown={(e) => { e.preventDefault(); changeSize(-1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">−</button>
          <input
            value={fontSize}
            onChange={(e) => setFontSize(+e.target.value || 12)}
            onBlur={() => applyPx(fontSize)}
            onKeyDown={(e) => { if (e.key === 'Enter') { applyPx(fontSize); (e.target as HTMLInputElement).blur(); } }}
            className="h-[26px] w-8 border-x border-app-border bg-transparent text-center text-xs font-semibold outline-none dark:border-white/10"
          />
          <button type="button" onMouseDown={(e) => { e.preventDefault(); changeSize(1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">+</button>
        </div>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Text color */}
        <div ref={colorWrapRef} className="relative">
          <button type="button" onMouseDown={togglePalette} title={t.titleColor} className="flex h-7 w-7 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-white dark:hover:bg-white/10">
            <span className="text-xs font-bold leading-none">A</span>
            <span className="h-[3px] w-4 rounded-sm" style={{ background: barColor }} />
          </button>
          {palOpen && (
            <div
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="fixed z-[9999] grid w-[184px] grid-cols-6 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
              style={{ left: palPos.left, top: palPos.top }}
            >
              {COLORS.map((c) => (
                <div key={c} onMouseDown={(e) => { e.preventDefault(); applyColor(c); }} className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125" style={{ background: c }} />
              ))}
            </div>
          )}
        </div>

        {/* Highlight */}
        <div ref={hlWrapRef} className="relative">
          <button type="button" onMouseDown={toggleHlPalette} title="Highlight" className="flex h-7 w-7 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-white dark:hover:bg-white/10">
            <span className="text-xs font-bold leading-none" style={{ WebkitTextStroke: '0.5px #555' }}>A</span>
            <span className="h-[3px] w-4 rounded-sm" style={{ background: hlColor }} />
          </button>
          {hlPalOpen && (
            <div
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
              className="fixed z-[9999] grid w-[164px] grid-cols-5 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
              style={{ left: hlPalPos.left, top: hlPalPos.top }}
            >
              {HIGHLIGHT_COLORS.map((c) => (
                <div key={c} onMouseDown={(e) => { e.preventDefault(); applyHighlight(c); }} className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125" style={{ background: c }} />
              ))}
              <div onMouseDown={(e) => { e.preventDefault(); applyHighlight('transparent'); }} className="col-span-5 mt-0.5 flex cursor-pointer items-center justify-center rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5">✕ إزالة التلوين</div>
            </div>
          )}
        </div>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* B I U S */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Alignment */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyLeft'); }} title="Align left" className={btnCls(activeCmds.has('justifyLeft'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyCenter'); }} title="Center" className={btnCls(activeCmds.has('justifyCenter'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyRight'); }} title="Align right" className={btnCls(activeCmds.has('justifyRight'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="9" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="9" y="20" width="12" height="2" rx="1"/></svg>
        </button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Image */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); imgInputRef.current?.click(); }} title="Insert image" className={btnCls(false)}>🖼</button>
        <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }} />

        {toolbarEnd && <div className="ml-auto flex items-center pl-2">{toolbarEnd}</div>}
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable={editable}
        data-placeholder={placeholder}
        dir="auto"
        onMouseDown={() => { clearPendingFontMarker(); }}
        onKeyDown={(e) => {
          if (NAV_KEYS.has(e.key)) clearPendingFontMarker();
        }}
        onInput={() => {
          const ed = editorRef.current;
          if (ed) {
            ed.childNodes.forEach((node) => {
              if (node instanceof HTMLElement && !node.hasAttribute('dir')) {
                node.setAttribute('dir', 'auto');
              }
            });
          }
          onChange(ed?.innerHTML ?? '');
        }}
        onMouseMove={(event) => {
          if (!editable) return;
          const target = event.target;
          if (target instanceof HTMLImageElement) {
            setHoveredImg({ el: target, rect: target.getBoundingClientRect() });
          } else {
            setHoveredImg(null);
          }
        }}
        onMouseLeave={() => setHoveredImg(null)}
        onClick={(event) => {
          if (!editable && event.detail >= 3) { event.preventDefault(); onLockedTripleClick?.(); return; }
          const target = event.target;
          if (target instanceof HTMLImageElement) { setPreviewImage(target.currentSrc || target.src); setPreviewZoom(1); naturalSizeRef.current = null; }
        }}
        suppressContentEditableWarning
        className="overflow-y-auto px-4 py-3 leading-[1.75] text-app-text outline-none dark:text-gray-100 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5"
        style={{ minHeight, maxHeight, fontSize: '12px', cursor: editable ? 'text' : 'default' }}
      />

      {/* Image hover buttons */}
      {editable && hoveredImg && (() => {
        const r = hoveredImg.rect;
        return (
          <div
            onMouseEnter={() => setHoveredImg(hoveredImg)}
            onMouseLeave={() => setHoveredImg(null)}
            style={{ position: 'fixed', left: r.right - 56, top: r.top + 4, zIndex: 9999, display: 'flex', gap: 4 }}
          >
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewImage(hoveredImg.el.currentSrc || hoveredImg.el.src); setPreviewZoom(1); naturalSizeRef.current = null; }} className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800/80 text-xs text-white shadow-lg hover:bg-gray-900" title="Zoom">🔍</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const img = hoveredImg.el; const next = img.nextSibling; if (next?.nodeName === 'BR') next.parentNode?.removeChild(next); img.parentNode?.removeChild(img); setHoveredImg(null); onChange(editorRef.current?.innerHTML ?? ''); }} className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow-lg hover:bg-red-700" title="Delete">✕</button>
          </div>
        );
      })()}

      {/* Image preview modal */}
      {previewImage && (() => {
        const ns = naturalSizeRef.current;
        const imgStyle: React.CSSProperties = previewZoom === 1
          ? { maxWidth: '90vw', maxHeight: '82vh', width: 'auto', height: 'auto' }
          : ns
            ? (() => { const maxW = window.innerWidth * 0.9; const maxH = window.innerHeight * 0.82; const fitScale = Math.min(1, maxW / ns.w, maxH / ns.h); return { width: ns.w * fitScale * previewZoom, height: ns.h * fitScale * previewZoom }; })()
            : { width: `${previewZoom * 90}vw`, height: 'auto' };
        const zoomLabel = previewZoom === 1 ? 'Fit' : `${Math.round(previewZoom * 100)}%`;
        return (
          <div role="dialog" aria-modal="true" onClick={() => setPreviewImage(null)} className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <a href={previewImage} download="taha-note-image" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl font-bold text-white hover:bg-white/25">↓</a>
              <button type="button" onClick={() => setPreviewImage(null)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl text-white hover:bg-white/25">✕</button>
            </div>
            <div onClick={(e) => e.stopPropagation()} className="overflow-auto rounded-xl" style={{ maxWidth: '90vw', maxHeight: '82vh' }}>
              <img src={previewImage} alt="Preview" onLoad={(e) => { naturalSizeRef.current = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }; }} onClick={(e) => e.stopPropagation()} className="block rounded-xl shadow-2xl" style={imgStyle} />
            </div>
            <div onClick={(e) => e.stopPropagation()} className="mt-4 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 backdrop-blur-sm">
              <button type="button" onClick={() => setPreviewZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-white hover:bg-white/20">−</button>
              <button type="button" onClick={() => setPreviewZoom(1)} className="min-w-[52px] text-center text-[13px] font-semibold text-white hover:opacity-70">{zoomLabel}</button>
              <button type="button" onClick={() => setPreviewZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-white hover:bg-white/20">+</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
