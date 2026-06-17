import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'];
const STATE_COMMANDS = [...TOGGLE_COMMANDS, 'justifyRight', 'justifyCenter', 'justifyLeft'];

interface Props {
  html: string;
  onChange: (html: string) => void;
  placeholder: string;
  editable?: boolean;
  minHeight?: string;
  maxHeight?: string;
}

export function RichTextEditor({ html, onChange, placeholder, editable = true, minHeight = '120px', maxHeight }: Props) {
  const { t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [fontSize, setFontSize] = useState(13);
  const [activeCmds, setActiveCmds] = useState<Set<string>>(new Set());
  const [palOpen, setPalOpen] = useState(false);
  const [barColor, setBarColor] = useState('#534AB7');
  const colorWrapRef = useRef<HTMLDivElement>(null);

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
    setActiveCmds(active);
    return active;
  };

  useEffect(() => {
    const handler = () => {
      const ed = editorRef.current;
      if (ed && (document.activeElement === ed || ed.contains(document.activeElement))) {
        saveSel();
        readCommandState();
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
    const wasActive = activeCmds.has(cmd);
    document.execCommand(cmd, false, value);
    saveSel();
    const next = readCommandState();
    if (TOGGLE_COMMANDS.includes(cmd)) {
      next[wasActive ? 'delete' : 'add'](cmd);
      setActiveCmds(new Set(next));
    }
    onChange(editorRef.current?.innerHTML ?? '');
  };

  const applyPx = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (document.activeElement !== ed) ed.focus();
    restoreSel();
    document.execCommand('fontSize', false, '7');
    ed.querySelectorAll('font[size="7"]').forEach((f) => {
      const sp = document.createElement('span');
      sp.style.fontSize = px + 'px';
      sp.innerHTML = f.innerHTML;
      f.replaceWith(sp);
    });
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
    setPalOpen((o) => !o);
  };

  const applyColor = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBarColor(c);
    ed.focus();
    restoreSel();
    const s = window.getSelection();
    if (s && s.rangeCount > 0 && ed.contains(s.anchorNode) && !s.getRangeAt(0).collapsed) {
      const range = s.getRangeAt(0);
      const span = document.createElement('span');
      span.style.color = c;
      span.appendChild(range.extractContents());
      range.insertNode(span);
      range.selectNodeContents(span);
      range.collapse(false);
      s.removeAllRanges();
      s.addRange(range);
      savedRange.current = range.cloneRange();
    } else {
      document.execCommand('foreColor', false, c);
    }
    setPalOpen(false);
    onChange(ed.innerHTML);
  };

  useEffect(() => {
    if (!palOpen) return;
    const close = (e: MouseEvent) => {
      if (!colorWrapRef.current?.contains(e.target as Node)) setPalOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [palOpen]);

  const btnCls = (active: boolean) =>
    'flex h-7 w-7 items-center justify-center rounded-md text-[14px] transition-all ' +
    (active
      ? 'bg-gray-900 text-white shadow-[0_3px_0_0_rgba(0,0,0,0.8)] -translate-y-px'
      : 'text-app-text-secondary hover:bg-white dark:hover:bg-white/10');

  return (
    <div className={editable ? '' : 'pointer-events-none opacity-40'}>
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
              className="absolute left-0 top-full z-[9999] mt-2 grid w-[184px] grid-cols-6 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
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
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <div className="flex items-center overflow-hidden rounded-lg border border-app-border bg-white dark:border-white/10 dark:bg-gray-900">
          <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyLeft'); }} title={t.titleLeft} className={btnCls(activeCmds.has('justifyLeft')) + ' !rounded-none'}>☰</button>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyCenter'); }} title={t.titleCenter} className={btnCls(activeCmds.has('justifyCenter')) + ' !rounded-none border-x border-app-border dark:border-white/10'}>≣</button>
          <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('justifyRight'); }} title={t.titleRight} className={btnCls(activeCmds.has('justifyRight')) + ' !rounded-none'}>☷</button>
        </div>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} title={t.titleClr} className={btnCls(false)}>⌫</button>
      </div>

      <div
        ref={editorRef}
        contentEditable={editable}
        data-placeholder={placeholder}
        dir="auto"
        onInput={() => onChange(editorRef.current?.innerHTML ?? '')}
        suppressContentEditableWarning
        className="overflow-y-auto px-4 py-3 text-sm leading-[1.75] text-app-text outline-none dark:text-gray-100 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5"
        style={{ minHeight, maxHeight, cursor: editable ? 'text' : 'default' }}
      />
    </div>
  );
}
