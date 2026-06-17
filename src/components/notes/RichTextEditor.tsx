import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
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
}

export function RichTextEditor({ html, onChange, placeholder, editable = true, minHeight = '120px', maxHeight }: Props) {
  const { t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const pendingMarks = useRef<Partial<Record<ToggleCommand, boolean>>>({});
  const [fontSize, setFontSize] = useState(13);
  const [activeCmds, setActiveCmds] = useState<Set<string>>(new Set());
  const [palOpen, setPalOpen] = useState(false);
  const [palPos, setPalPos] = useState({ left: 0, top: 0 });
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

  const shouldFormatKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && hasPendingMarks();
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
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>
        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} title={t.titleClr} className={btnCls(false)}>⌫</button>
      </div>

      <div
        ref={editorRef}
        contentEditable={editable}
        data-placeholder={placeholder}
        dir="auto"
        onKeyDown={(e) => {
          if (shouldFormatKey(e)) {
            e.preventDefault();
            insertPendingText(e.key);
          }
        }}
        onBeforeInput={(e) => {
          const native = e.nativeEvent as InputEvent;
          if (native.inputType === 'insertText' && native.data && hasPendingMarks()) {
            e.preventDefault();
            insertPendingText(native.data);
          }
        }}
        onInput={() => onChange(editorRef.current?.innerHTML ?? '')}
        suppressContentEditableWarning
        className="overflow-y-auto px-4 py-3 text-sm leading-[1.75] text-app-text outline-none dark:text-gray-100 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5"
        style={{ minHeight, maxHeight, cursor: editable ? 'text' : 'default' }}
      />
    </div>
  );
}
