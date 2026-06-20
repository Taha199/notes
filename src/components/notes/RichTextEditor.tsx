import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const HIGHLIGHT_COLORS = ['#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA', '#CE93D8', '#F48FB1', '#FFCC80', '#EF9A9A', '#B0BEC5', '#FFFFFF'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const STATE_COMMANDS = [...TOGGLE_COMMANDS, 'justifyRight', 'justifyCenter', 'justifyLeft'];
type ToggleCommand = typeof TOGGLE_COMMANDS[number];

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
  const pendingMarks = useRef<Partial<Record<ToggleCommand, boolean>>>({});
  const [fontSize, setFontSize] = useState(14);
  const [baseSize, setBaseSize] = useState(14);
  const [activeCmds, setActiveCmds] = useState<Set<string>>(new Set());
  const [palOpen, setPalOpen] = useState(false);
  const [palPos, setPalPos] = useState({ left: 0, top: 0 });
  const [barColor, setBarColor] = useState('#534AB7');
  const [hlPalOpen, setHlPalOpen] = useState(false);
  const [hlPalPos, setHlPalPos] = useState({ left: 0, top: 0 });
  const [hlColor, setHlColor] = useState('#FFEB3B');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [hoveredImg, setHoveredImg] = useState<{ el: HTMLImageElement; rect: DOMRect } | null>(null);
  const colorWrapRef = useRef<HTMLDivElement>(null);
  const hlWrapRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);

  // Set initial HTML once (avoid overwriting cursor on each keystroke)
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

  const saveSel = () => {
    const s = window.getSelection();
    if (s && s.rangeCount > 0 && editorRef.current?.contains(s.anchorNode)) {
      savedRange.current = s.getRangeAt(0).cloneRange();
    }
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

  const readCommandState = () => {
    const active = new Set<string>();
    STATE_COMMANDS.forEach((c) => {
      try {
        if (document.queryCommandState(c)) active.add(c);
      } catch {
        /* noop */
      }
    });
    TOGGLE_COMMANDS.forEach((cmd) => {
      const pending = pendingMarks.current[cmd];
      if (pending === true) active.add(cmd);
      if (pending === false) active.delete(cmd);
    });
    setActiveCmds(active);
    return active;
  };

  const isToggleCommand = (cmd: string): cmd is ToggleCommand => TOGGLE_COMMANDS.includes(cmd as ToggleCommand);

  const readToggleState = (cmd: ToggleCommand) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return activeCmds.has(cmd);
    }
  };

  const setButtonState = (cmd: ToggleCommand, enabled: boolean) => {
    setActiveCmds((prev) => {
      const next = new Set(prev);
      next[enabled ? 'add' : 'delete'](cmd);
      return next;
    });
  };

  const hasPendingMarks = () => Object.keys(pendingMarks.current).length > 0;

  // Keep the size indicator in sync with whatever text the caret/selection is on.
  const syncFontSizeFromCaret = () => {
    const ed = editorRef.current;
    const sel = window.getSelection();
    if (!ed || !sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    // Only adopt the size from actual styled content (a child span). When the
    // caret sits on the bare editor root, the base size is driven by the
    // indicator itself — reading it back here would clobber a size the user
    // just picked (the size button would appear to do nothing).
    if (node instanceof Element && node !== ed && ed.contains(node)) {
      const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
      if (px && px !== fontSize) setFontSize(px);
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
  }, []);

  const focusEditor = () => {
    editorRef.current?.focus({ preventScroll: true });
    restoreSel();
  };

  const exec = (cmd: string, value?: string) => {
    focusEditor();
    const toggleCmd = isToggleCommand(cmd) ? cmd : null;
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const hasSelection = !!range && !range.collapsed;

    if (toggleCmd && !hasSelection) {
      const current = pendingMarks.current[toggleCmd] ?? readToggleState(toggleCmd);
      const shouldEnable = !current;
      pendingMarks.current[toggleCmd] = shouldEnable;
      setButtonState(toggleCmd, shouldEnable);
      saveSel();
      return;
    }

    document.execCommand(cmd, false, value);
    saveSel();
    readCommandState();
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const insertPendingText = (text: string) => {
    const ed = editorRef.current;
    if (!ed) return false;
    const active = readCommandState();
    const underline = pendingMarks.current.underline ?? active.has('underline');
    const strike = pendingMarks.current.strikeThrough ?? active.has('strikeThrough');
    const decoration = [underline ? 'underline' : '', strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    const style = [
      `font-weight: ${(pendingMarks.current.bold ?? active.has('bold')) ? '700' : '400'}`,
      `font-style: ${(pendingMarks.current.italic ?? active.has('italic')) ? 'italic' : 'normal'}`,
      `text-decoration-line: ${decoration}`,
      `color: ${barColor}`,
    ].filter(Boolean).join('; ');

    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br>');

    document.execCommand('insertHTML', false, `<span style="${style}">${escaped}</span>`);
    saveSel();
    onChange(ed.innerHTML);
    return true;
  };

  const applyPx = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (document.activeElement !== ed) ed.focus();
    restoreSel();
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const hasSelection = !!range && !range.collapsed;

    // No selection → change the editor's base size (affects new typing). The
    // indicator and typed text stay in lockstep — no per-character span trickery.
    if (!hasSelection) {
      setBaseSize(px);
      saveSel();
      return;
    }

    // Selection → resize just that run via a span (overrides the base size).
    document.execCommand('fontSize', false, '7');
    ed.querySelectorAll('font[size="7"]').forEach((f) => {
      const sp = document.createElement('span');
      sp.style.fontSize = px + 'px';
      sp.innerHTML = f.innerHTML;
      f.replaceWith(sp);
    });
    saveSel();
    onChange(ed.innerHTML);
  };

  const nextSz = (cur: number, d: number) => {
    const i = SIZES.indexOf(cur);
    const ni = d > 0 ? Math.min(i + 1, SIZES.length - 1) : Math.max(i - 1, 0);
    return SIZES[ni] ?? cur;
  };

  const changeSize = (d: number) => {
    saveSel();
    const s = nextSz(fontSize, d);
    setFontSize(s);
    applyPx(s);
  };

  const togglePalette = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    saveSel();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPalPos({ left: rect.left, top: rect.bottom + 8 });
    setPalOpen((o) => !o);
  };

  const applyColor = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBarColor(c);
    focusEditor();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, c);
    saveSel();
    setPalOpen(false);
    onChange(ed.innerHTML);
  };

  const toggleHlPalette = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    saveSel();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHlPalPos({ left: rect.left, top: rect.bottom + 8 });
    setHlPalOpen((o) => !o);
  };

  const applyHighlight = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setHlColor(c);
    focusEditor();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('backColor', false, c);
    saveSel();
    setHlPalOpen(false);
    onChange(ed.innerHTML);
  };

  const insertImage = (file: File) => {
    const ed = editorRef.current;
    if (!ed || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      focusEditor();
      document.execCommand('insertHTML', false, `<img src="${url}" style="display:block;max-width:160px;max-height:160px;height:auto;border-radius:8px;margin:4px 0;cursor:zoom-in;" /><br>`);
      saveSel();
      onChange(ed.innerHTML);
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (!palOpen) return;
    const closeOutside = (e: MouseEvent) => {
      if (!colorWrapRef.current?.contains(e.target as Node)) setPalOpen(false);
    };
    const closePalette = () => setPalOpen(false);
    document.addEventListener('mousedown', closeOutside);
    window.addEventListener('resize', closePalette);
    window.addEventListener('scroll', closePalette, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('resize', closePalette);
      window.removeEventListener('scroll', closePalette, true);
    };
  }, [palOpen]);

  useEffect(() => {
    if (!hlPalOpen) return;
    const closeOutside = (e: MouseEvent) => {
      if (!hlWrapRef.current?.contains(e.target as Node)) setHlPalOpen(false);
    };
    const close = () => setHlPalOpen(false);
    document.addEventListener('mousedown', closeOutside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [hlPalOpen]);

  useEffect(() => {
    if (!previewImage) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [previewImage]);

  const btnCls = (active: boolean) =>
    'flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all ' +
    (active
      ? 'bg-gray-900 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.8)] -translate-y-px'
      : 'text-app-text-secondary hover:bg-white dark:hover:bg-white/10');

  return (
    <div ref={editorWrapRef} className={'relative ' + (editable ? '' : '[&_img]:cursor-zoom-in')}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-app-border bg-app-bg px-3 py-1.5 dark:border-white/10 dark:bg-white/5" style={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.4 }}>
        <div className="flex items-center overflow-hidden rounded-lg border border-app-border bg-white dark:border-white/10 dark:bg-gray-900">
          <button type="button" onMouseDown={(e) => { e.preventDefault(); changeSize(-1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">
            −
          </button>
          <input
            value={fontSize}
            onChange={(e) => setFontSize(+e.target.value || 13)}
            onBlur={() => applyPx(fontSize)}
            className="h-[26px] w-8 border-x border-app-border bg-transparent text-center text-xs font-semibold outline-none dark:border-white/10"
          />
          <button type="button" onMouseDown={(e) => { e.preventDefault(); changeSize(1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">
            +
          </button>
        </div>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <div ref={colorWrapRef} className="relative">
          <button type="button" onMouseDown={togglePalette} title={t.titleColor} className="flex h-7 w-7 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-white dark:hover:bg-white/10">
            <span className="text-xs font-bold leading-none">A</span>
            <span className="h-[3px] w-4 rounded-sm" style={{ background: barColor }} />
          </button>
          {palOpen && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="fixed z-[9999] grid w-[184px] grid-cols-6 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
              style={{ left: palPos.left, top: palPos.top }}
            >
              {COLORS.map((c) => (
                <div
                  key={c}
                  onMouseDown={(e) => { e.preventDefault(); applyColor(c); }}
                  className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125"
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </div>
        <div ref={hlWrapRef} className="relative">
          <button type="button" onMouseDown={toggleHlPalette} title="تلوين الخط / Highlight" className="flex h-7 w-7 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-white dark:hover:bg-white/10">
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
                <div
                  key={c}
                  onMouseDown={(e) => { e.preventDefault(); applyHighlight(c); }}
                  className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125"
                  style={{ background: c }}
                />
              ))}
              <div
                onMouseDown={(e) => { e.preventDefault(); applyHighlight('transparent'); }}
                className="col-span-5 mt-0.5 flex cursor-pointer items-center justify-center rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5"
              >
                ✕ إزالة التلوين
              </div>
            </div>
          )}
        </div>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); imgInputRef.current?.click(); }} title="Infoga bild" className={btnCls(false)}>🖼</button>
        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }}
        />
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => {
          e.preventDefault();
          focusEditor();
          document.execCommand('removeFormat');
          document.execCommand('styleWithCSS', false, 'true');
          document.execCommand('foreColor', false, '#000000');
          applyPx(12);
          setFontSize(12);
          setBarColor('#000000');
          saveSel();
          onChange(editorRef.current?.innerHTML ?? '');
        }} title={t.titleClr} className={btnCls(false)}>⌫</button>
        {toolbarEnd && <div className="ml-auto flex items-center pl-2">{toolbarEnd}</div>}
      </div>

      <div
        ref={editorRef}
        contentEditable={editable}
        data-placeholder={placeholder}
        dir="auto"
        onBeforeInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          if (native.inputType === 'insertText' && native.data && hasPendingMarks()) {
            e.preventDefault();
            insertPendingText(native.data);
          }
        }}
        onInput={() => {
          // Ensure each child block gets dir="auto" so Arabic lines go RTL independently.
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
            const rect = target.getBoundingClientRect();
            setHoveredImg({ el: target, rect });
          } else {
            setHoveredImg(null);
          }
        }}
        onMouseLeave={() => setHoveredImg(null)}
        onClick={(event) => {
          if (!editable && event.detail >= 3) {
            event.preventDefault();
            onLockedTripleClick?.();
            return;
          }
          const target = event.target;
          if (!editable && target instanceof HTMLImageElement) { setPreviewImage(target.currentSrc || target.src); setPreviewZoom(1); setNaturalSize(null); }
        }}
        suppressContentEditableWarning
        className="overflow-y-auto px-4 py-3 leading-[1.75] text-app-text outline-none dark:text-gray-100 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5"
        style={{ minHeight, maxHeight, fontSize: `${baseSize}px`, cursor: editable ? 'text' : 'default' }}
      />

      {editable && hoveredImg && (() => {
        const r = hoveredImg.rect;
        return (
          <div
            onMouseEnter={() => setHoveredImg(hoveredImg)}
            onMouseLeave={() => setHoveredImg(null)}
            style={{ position: 'fixed', left: r.right - 56, top: r.top + 4, zIndex: 9999, display: 'flex', gap: 4 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPreviewImage(hoveredImg.el.currentSrc || hoveredImg.el.src);
                setPreviewZoom(1);
                setNaturalSize(null);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800/80 text-xs text-white shadow-lg hover:bg-gray-900"
              title="Zoom image"
            >🔍</button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const img = hoveredImg.el;
                const next = img.nextSibling;
                if (next && next.nodeName === 'BR') next.parentNode?.removeChild(next);
                img.parentNode?.removeChild(img);
                setHoveredImg(null);
                onChange(editorRef.current?.innerHTML ?? '');
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white shadow-lg hover:bg-red-700"
              title="Delete image"
            >✕</button>
          </div>
        );
      })()}

      {previewImage && (() => {
        const maxW = window.innerWidth * 0.9;
        const maxH = window.innerHeight * 0.82;
        const nw = naturalSize?.w ?? maxW;
        const nh = naturalSize?.h ?? maxH;
        const fitScale = Math.min(1, maxW / nw, maxH / nh);
        const displayW = nw * fitScale * previewZoom;
        const displayH = nh * fitScale * previewZoom;
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={() => setPreviewImage(null)}
            className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
          >
            {/* Top bar */}
            <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <a
                href={previewImage}
                download="taha-note-image"
                aria-label="Download image"
                title="Download"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl font-bold text-white transition-colors hover:bg-white/25"
              >↓</a>
              <button type="button" onClick={() => setPreviewImage(null)} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-xl text-white transition-colors hover:bg-white/25">✕</button>
            </div>

            {/* Scrollable image area */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="overflow-auto rounded-xl"
              style={{ maxWidth: '90vw', maxHeight: '82vh' }}
            >
              <img
                src={previewImage}
                alt="Expanded note attachment"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
                }}
                className="block rounded-xl shadow-2xl"
                style={{ width: displayW, height: displayH, minWidth: displayW }}
              />
            </div>

            {/* Zoom bar */}
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-4 flex items-center gap-1 rounded-full bg-black/50 px-2 py-1 backdrop-blur-sm"
            >
              <button type="button" onClick={() => setPreviewZoom((z) => Math.max(0.1, +(z - 0.25).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-white hover:bg-white/20">−</button>
              <button type="button" onClick={() => setPreviewZoom(1)} className="min-w-[52px] text-center text-[13px] font-semibold text-white hover:opacity-70">{Math.round(fitScale * previewZoom * 100)}%</button>
              <button type="button" onClick={() => setPreviewZoom((z) => Math.min(8, +(z + 0.25).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full text-xl font-bold text-white hover:bg-white/20">+</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
