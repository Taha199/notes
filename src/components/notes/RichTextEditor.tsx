import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import { Extension } from '@tiptap/core';
import type { Editor as TipTapEditorType } from '@tiptap/core';

/* ── Custom font-size extension ─────────────────────────────────────── */
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => el.style.fontSize || null,
          renderHTML: (attrs) => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: { chain: () => unknown }) =>
        (chain() as ReturnType<TipTapEditorType['chain']>).setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: { chain: () => unknown }) =>
        (chain() as ReturnType<TipTapEditorType['chain']>).setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    } as Record<string, unknown>;
  },
});

/* ── Custom direction extension ─────────────────────────────────────── */
const Direction = Extension.create({
  name: 'direction',
  addOptions() { return { types: ['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList'] }; },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        dir: {
          default: null,
          parseHTML: (el) => el.getAttribute('dir') || null,
          renderHTML: (attrs) => attrs.dir ? { dir: attrs.dir } : {},
        },
      },
    }];
  },
  addCommands() {
    return {
      setDir: (direction: string) => ({ commands }: { commands: Record<string, (...args: unknown[]) => boolean> }) =>
        this.options.types.every((type: string) => commands.updateAttributes(type, { dir: direction })),
    } as Record<string, unknown>;
  },
});

/* ── Prop interface (same as before) ────────────────────────────────── */
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

/* ── Constants ───────────────────────────────────────────────────────── */
const FONT_FAMILIES = [
  { label: 'Aptos', value: 'Aptos, Calibri, Arial, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
];

const FONT_SIZES = ['8', '9', '10', '11', '12', '13', '14', '16', '18', '20', '22', '24', '28', '32', '36', '42', '48', '56', '64', '72'];

const HEADING_OPTIONS = [
  { label: 'Normal text', value: 0 },
  { label: 'Heading 1', value: 1 },
  { label: 'Heading 2', value: 2 },
  { label: 'Heading 3', value: 3 },
  { label: 'Heading 4', value: 4 },
  { label: 'Heading 5', value: 5 },
  { label: 'Heading 6', value: 6 },
];

const TEXT_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#B7B7B7', '#CCCCCC', '#D9D9D9', '#FFFFFF',
  '#FF0000', '#FF9900', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#9900FF', '#FF00FF',
  '#F4CCCC', '#FCE5CD', '#FFF2CC', '#D9EAD3', '#D0E0E3', '#CFE2F3', '#D9D2E9', '#EAD1DC',
  '#EA9999', '#F9CB9C', '#FFE599', '#B6D7A8', '#A2C4C9', '#9FC5E8', '#B4A7D6', '#D5A6BD',
  '#E06666', '#F6B26B', '#FFD966', '#93C47D', '#76A5AF', '#6FA8DC', '#8E7CC3', '#C27BA0',
  '#CC0000', '#E69138', '#F1C232', '#6AA84F', '#45818E', '#3D85C8', '#674EA7', '#A61C00',
  '#990000', '#B45309', '#BF9000', '#38761D', '#134F5C', '#1155CC', '#351C75', '#741B47',
  '#5D0000', '#783F04', '#7F6000', '#274E13', '#0C343D', '#1C4587', '#20124D', '#4C1130',
];

const HIGHLIGHT_COLORS = ['#FFFF00', '#00FF00', '#00FFFF', '#FF00FF', '#FF0000', '#0000FF', '#FFB3BA', '#FFDFBA', '#FFFFBA', '#BAFFC9', '#BAE1FF', '#FFFFFF', '#E8D5B7', '#D4E6B5'];

/* ── SVG icon helpers ────────────────────────────────────────────────── */
function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/* ── Toolbar button ──────────────────────────────────────────────────── */
function TBtn({ onClick, active, disabled, title, children, className = '' }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title?: string; children: ReactNode; className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={
        'flex h-7 min-w-[28px] items-center justify-center rounded px-1 text-[12px] transition-colors ' +
        (active
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-600/30 dark:text-blue-300'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10') +
        (disabled ? ' opacity-30 cursor-not-allowed' : '') +
        ' ' + className
      }
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-gray-300 dark:bg-white/15 flex-shrink-0" />;
}

/* ── Color picker popover ────────────────────────────────────────────── */
function ColorPicker({ colors, onSelect, onClose }: { colors: string[]; onSelect: (c: string) => void; onClose: () => void; }) {
  return (
    <div
      className="absolute z-50 mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-800"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-8 gap-0.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            style={{ background: c }}
            className="h-5 w-5 rounded border border-gray-200 dark:border-white/20 hover:scale-110 transition-transform"
            onMouseDown={(e) => { e.preventDefault(); onSelect(c); onClose(); }}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Link dialog ─────────────────────────────────────────────────────── */
function LinkDialog({ onConfirm, onCancel, initial }: { onConfirm: (url: string) => void; onCancel: () => void; initial: string; }) {
  const [url, setUrl] = useState(initial || 'https://');
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onCancel}>
      <div className="rounded-xl bg-white p-5 shadow-2xl dark:bg-gray-800" onClick={(e) => e.stopPropagation()}>
        <p className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Insert Link</p>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(url); if (e.key === 'Escape') onCancel(); }}
          className="w-72 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/20 dark:bg-gray-700 dark:text-gray-100"
          placeholder="https://"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-gray-400">Cancel</button>
          <button type="button" onClick={() => onConfirm(url)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700">Insert</button>
        </div>
      </div>
    </div>
  );
}

/* ── Table insertion dialog ─────────────────────────────────────────── */
function TablePicker({ onSelect, onClose }: { onSelect: (rows: number, cols: number) => void; onClose: () => void; }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  const MAX = 8;
  return (
    <div className="absolute z-50 mt-1 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-gray-800" onMouseDown={(e) => e.preventDefault()}>
      <p className="mb-1.5 text-center text-[10px] text-gray-500 dark:text-gray-400">{hover.r}×{hover.c} table</p>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${MAX}, 1fr)` }}>
        {Array.from({ length: MAX * MAX }, (_, i) => {
          const r = Math.floor(i / MAX) + 1, c = (i % MAX) + 1;
          return (
            <div
              key={i}
              className={`h-5 w-5 rounded-sm border transition-colors ${r <= hover.r && c <= hover.c ? 'bg-blue-200 border-blue-400 dark:bg-blue-600/40 dark:border-blue-500' : 'border-gray-200 dark:border-white/15'}`}
              onMouseEnter={() => setHover({ r, c })}
              onMouseDown={() => { onSelect(r, c); onClose(); }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Image preview modal (preserved from original) ──────────────────── */
function ImagePreviewModal({ src, onClose }: { src: string; onClose: () => void; }) {
  const [zoom, setZoom] = useState(1);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const [, forceUpdate] = useState(0);

  return (
    <div
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        onClick={onClose}
      >✕</button>

      <div className="flex-1 flex items-center justify-center overflow-auto p-8 w-full">
        {zoom === 1 ? (
          <img
            src={src}
            alt="Preview"
            style={{ maxWidth: '90vw', maxHeight: '82vh', objectFit: 'contain', display: 'block' }}
            onLoad={(e) => { const img = e.currentTarget; naturalRef.current = { w: img.naturalWidth, h: img.naturalHeight }; forceUpdate(n => n + 1); }}
            onClick={(e) => e.stopPropagation()}
            className="rounded-lg shadow-2xl"
          />
        ) : (() => {
          const nat = naturalRef.current;
          if (!nat) return null;
          const w = nat.w * zoom, h = nat.h * zoom;
          return (
            <img
              src={src}
              alt="Preview"
              style={{ width: `${w}px`, height: `${h}px`, display: 'block', flexShrink: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg shadow-2xl"
            />
          );
        })()}
      </div>

      <div className="flex items-center gap-3 rounded-full bg-black/50 px-4 py-2 backdrop-blur-sm mb-4" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))} className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 text-lg">−</button>
        <button type="button" onClick={() => setZoom(1)} className="min-w-[56px] text-center text-[11px] font-semibold text-white">
          {zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}
        </button>
        <button type="button" onClick={() => setZoom(z => Math.min(5, +(z + 0.25).toFixed(2)))} className="flex h-7 w-7 items-center justify-center rounded-full text-white hover:bg-white/20 text-lg">+</button>
      </div>
    </div>
  );
}

/* ── Toolbar component ───────────────────────────────────────────────── */
function Toolbar({ editor, onImageUpload, toolbarEnd }: { editor: Editor; onImageUpload: () => void; toolbarEnd?: ReactNode; }) {
  const [fontSizeInput, setFontSizeInput] = useState('12');
  const [headingOpen, setHeadingOpen] = useState(false);
  const [fontFamilyOpen, setFontFamilyOpen] = useState(false);
  const [textColorOpen, setTextColorOpen] = useState(false);
  const [hlColorOpen, setHlColorOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [currentTextColor, setCurrentTextColor] = useState('#000000');
  const [currentHlColor, setCurrentHlColor] = useState('#FFFF00');
  const fontSizeInputRef = useRef<HTMLInputElement>(null);

  // Sync font size from editor selection
  useEffect(() => {
    const update = () => {
      const attrs = editor.getAttributes('textStyle');
      const fs = attrs.fontSize ? attrs.fontSize.replace('px', '') : '12';
      setFontSizeInput(fs);
    };
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update); };
  }, [editor]);

  const applyFontSize = (val: string) => {
    const n = parseInt(val);
    if (!n || n < 6 || n > 400) return;
    setFontSizeInput(String(n));
    (editor.chain().focus() as unknown as Record<string, (...a: unknown[]) => { run: () => void }>)
      .setFontSize(`${n}px`).run();
  };

  const currentFont = editor.getAttributes('textStyle').fontFamily || 'Aptos, Calibri, Arial, sans-serif';
  const currentFontLabel = FONT_FAMILIES.find(f => f.value === currentFont)?.label ?? 'Aptos';

  const getHeadingLabel = () => {
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) return `Heading ${i}`;
    }
    return 'Normal text';
  };

  return (
    <div className="word-toolbar sticky top-0 z-10 border-b border-gray-200 bg-[#f3f2f1] dark:border-white/10 dark:bg-[#1e1e1e] select-none">
      {/* Row 1: file-level actions */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200/60 px-2 py-1 dark:border-white/8">
        {/* Undo / Redo */}
        <TBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></svg>
        </TBtn>

        <Divider />

        {/* Heading style */}
        <div className="relative">
          <button
            type="button"
            title="Paragraph style"
            onMouseDown={(e) => { e.preventDefault(); setHeadingOpen(o => !o); setFontFamilyOpen(false); setTextColorOpen(false); setHlColorOpen(false); setTablePickerOpen(false); }}
            className="flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
          >
            <span className="w-20 truncate text-left">{getHeadingLabel()}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {headingOpen && (
            <div className="absolute z-50 mt-1 min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800" onMouseDown={(e) => e.preventDefault()}>
              {HEADING_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (opt.value === 0) editor.chain().focus().setParagraph().run();
                    else editor.chain().focus().setHeading({ level: opt.value as 1|2|3|4|5|6 }).run();
                    setHeadingOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-white/10 ${opt.value === 0 ? 'text-[13px] text-gray-700 dark:text-gray-200' : `text-gray-800 dark:text-gray-100 font-bold`}`}
                  style={{ fontSize: opt.value === 0 ? 13 : Math.max(11, 22 - opt.value * 2) }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* Font family */}
        <div className="relative">
          <button
            type="button"
            title="Font family"
            onMouseDown={(e) => { e.preventDefault(); setFontFamilyOpen(o => !o); setHeadingOpen(false); setTextColorOpen(false); setHlColorOpen(false); setTablePickerOpen(false); }}
            className="flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
          >
            <span className="w-20 truncate text-left">{currentFontLabel}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {fontFamilyOpen && (
            <div className="absolute z-50 mt-1 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800" onMouseDown={(e) => e.preventDefault()}>
              {FONT_FAMILIES.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    editor.chain().focus().setFontFamily(f.value).run();
                    setFontFamilyOpen(false);
                  }}
                  className="flex w-full items-center px-3 py-1.5 text-left text-[13px] hover:bg-gray-100 dark:hover:bg-white/10 dark:text-gray-200"
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Font size */}
        <div className="flex items-center rounded border border-gray-300 dark:border-white/20 overflow-hidden bg-white dark:bg-gray-700 h-7">
          <button type="button" title="Decrease font size" onMouseDown={(e) => { e.preventDefault(); const cur = parseInt(fontSizeInput) || 12; const i = FONT_SIZES.indexOf(String(cur)); const next = i > 0 ? FONT_SIZES[i - 1] : FONT_SIZES[0]; applyFontSize(next); }} className="px-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10 h-full">−</button>
          <input
            ref={fontSizeInputRef}
            type="text"
            value={fontSizeInput}
            onChange={(e) => setFontSizeInput(e.target.value)}
            onBlur={(e) => applyFontSize(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { applyFontSize(fontSizeInput); fontSizeInputRef.current?.blur(); } }}
            className="w-8 bg-transparent text-center text-[11px] font-medium text-gray-700 outline-none dark:text-gray-200"
          />
          <button type="button" title="Increase font size" onMouseDown={(e) => { e.preventDefault(); const cur = parseInt(fontSizeInput) || 12; const i = FONT_SIZES.indexOf(String(cur)); const next = i < FONT_SIZES.length - 1 ? FONT_SIZES[i + 1] : FONT_SIZES[FONT_SIZES.length - 1]; applyFontSize(next); }} className="px-1.5 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10 h-full">+</button>
        </div>

        <Divider />

        {/* Bold / Italic / Underline / Strike */}
        <TBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <strong className="text-[13px]">B</strong>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <em className="text-[13px] font-serif">I</em>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <span className="text-[13px] underline">U</span>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <span className="text-[13px] line-through">S</span>
        </TBtn>

        <Divider />

        {/* Text color */}
        <div className="relative flex flex-col items-center">
          <button
            type="button"
            title="Text color"
            onMouseDown={(e) => { e.preventDefault(); setTextColorOpen(o => !o); setHlColorOpen(false); setHeadingOpen(false); setFontFamilyOpen(false); setTablePickerOpen(false); }}
            className="flex h-7 w-8 flex-col items-center justify-center gap-0.5 rounded hover:bg-gray-200 dark:hover:bg-white/10"
          >
            <span className="text-[13px] font-bold text-gray-700 dark:text-gray-200" style={{ color: currentTextColor }}>A</span>
            <div className="h-1 w-5 rounded-sm" style={{ background: currentTextColor }} />
          </button>
          {textColorOpen && (
            <ColorPicker colors={TEXT_COLORS} onSelect={(c) => { setCurrentTextColor(c); editor.chain().focus().setColor(c).run(); }} onClose={() => setTextColorOpen(false)} />
          )}
        </div>

        {/* Highlight color */}
        <div className="relative flex flex-col items-center">
          <button
            type="button"
            title="Highlight color"
            onMouseDown={(e) => { e.preventDefault(); setHlColorOpen(o => !o); setTextColorOpen(false); setHeadingOpen(false); setFontFamilyOpen(false); setTablePickerOpen(false); }}
            className="flex h-7 w-8 flex-col items-center justify-center gap-0.5 rounded hover:bg-gray-200 dark:hover:bg-white/10"
          >
            <span className="text-[12px] font-bold text-gray-700 dark:text-gray-200">ab</span>
            <div className="h-1 w-5 rounded-sm" style={{ background: currentHlColor }} />
          </button>
          {hlColorOpen && (
            <ColorPicker colors={HIGHLIGHT_COLORS} onSelect={(c) => { setCurrentHlColor(c); editor.chain().focus().toggleHighlight({ color: c }).run(); }} onClose={() => setHlColorOpen(false)} />
          )}
        </div>

        <Divider />

        {/* Alignment */}
        <TBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="12" height="2" rx="1"/></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Center">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="9" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="9" y="20" width="12" height="2" rx="1"/></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="18" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="18" height="2" rx="1"/></svg>
        </TBtn>

        <Divider />

        {/* RTL / LTR */}
        <TBtn
          onClick={() => (editor.chain().focus() as unknown as Record<string, (...a: unknown[]) => { run: () => void }>).setDir('rtl').run()}
          active={editor.isActive({ dir: 'rtl' })}
          title="Right to Left (Arabic)"
        >
          <span className="text-[10px] font-bold">RTL</span>
        </TBtn>
        <TBtn
          onClick={() => (editor.chain().focus() as unknown as Record<string, (...a: unknown[]) => { run: () => void }>).setDir('ltr').run()}
          active={editor.isActive({ dir: 'ltr' })}
          title="Left to Right"
        >
          <span className="text-[10px] font-bold">LTR</span>
        </TBtn>

        <Divider />

        {/* Lists */}
        <TBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="4" cy="6" r="1.5"/><rect x="7" y="5" width="14" height="2" rx="1"/><circle cx="4" cy="12" r="1.5"/><rect x="7" y="11" width="14" height="2" rx="1"/><circle cx="4" cy="18" r="1.5"/><rect x="7" y="17" width="14" height="2" rx="1"/></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 12c0-1 2-1 2 0s-2 2-2 2h2M4 20h2"/></svg>
        </TBtn>

        <Divider />

        {/* Indent / Outdent */}
        <TBtn onClick={() => editor.chain().focus().sinkListItem('listItem').run()} title="Increase indent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18M3 12h18M3 19h18M8 8l4 4-4 4" /></svg>
        </TBtn>
        <TBtn onClick={() => editor.chain().focus().liftListItem('listItem').run()} title="Decrease indent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h18M3 12h18M3 19h18M12 8l-4 4 4 4" /></svg>
        </TBtn>

        <Divider />

        {/* Blockquote */}
        <TBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5 3.871 3.871 0 01-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5 3.871 3.871 0 01-2.748-1.179z"/></svg>
        </TBtn>

        {/* Link */}
        <TBtn onClick={() => setLinkDialogOpen(true)} active={editor.isActive('link')} title="Insert link (Ctrl+K)">
          <Icon d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        </TBtn>

        {/* Table */}
        <div className="relative">
          <TBtn onClick={() => { setTablePickerOpen(o => !o); setHeadingOpen(false); setFontFamilyOpen(false); setTextColorOpen(false); setHlColorOpen(false); }} title="Insert table">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
          </TBtn>
          {tablePickerOpen && (
            <TablePicker
              onSelect={(rows, cols) => { editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run(); }}
              onClose={() => setTablePickerOpen(false)}
            />
          )}
        </div>

        {/* Image upload */}
        <TBtn onClick={onImageUpload} title="Insert image">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        </TBtn>

        <Divider />

        {/* Clear formatting */}
        <TBtn onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()} title="Clear formatting">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M7 12h7M9 17h5M3 3l18 18" /></svg>
        </TBtn>

        {toolbarEnd && <div className="ml-auto">{toolbarEnd}</div>}
      </div>

      {linkDialogOpen && (
        <LinkDialog
          initial={editor.getAttributes('link').href || ''}
          onConfirm={(url) => {
            if (url === '' || url === 'https://') {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
            } else {
              editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run();
            }
            setLinkDialogOpen(false);
          }}
          onCancel={() => setLinkDialogOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Ruler ───────────────────────────────────────────────────────────── */
function Ruler() {
  const ticks = [];
  for (let i = 0; i <= 16; i++) {
    ticks.push(
      <div key={i} className="relative flex flex-col items-center" style={{ flex: 1 }}>
        <div className={`bg-gray-400 dark:bg-gray-500 ${i % 2 === 0 ? 'h-2.5 w-px' : 'h-1.5 w-px'}`} />
        {i % 2 === 0 && i > 0 && (
          <span className="absolute top-3 text-[8px] text-gray-400 dark:text-gray-500 select-none">{i / 2}</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-start border-b border-gray-200 bg-[#f3f2f1] px-8 pt-1 pb-0 dark:border-white/10 dark:bg-[#1e1e1e]" style={{ minHeight: 20 }}>
      {ticks}
    </div>
  );
}

/* ── Main exported component ─────────────────────────────────────────── */
export function RichTextEditor({ html, onChange, placeholder, editable = true, minHeight = '120px', maxHeight, toolbarEnd, onLockedTripleClick }: Props) {
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({}),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      FontSize,
      Direction,
      Link.configure({ openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      CharacterCount,
      Placeholder.configure({ placeholder }),
    ],
    content: html,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync content when html prop changes externally
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== html && !editor.isFocused) {
      editor.commands.setContent(html);
    }
  }, [html, editor]);

  // Sync editable
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  // Handle triple-click in locked mode
  const handleTripleClick = useCallback(() => {
    if (!editable && onLockedTripleClick) onLockedTripleClick();
  }, [editable, onLockedTripleClick]);

  // Click on images to preview
  useEffect(() => {
    if (!editor) return;
    const el = editorContainerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'IMG') {
        setPreviewImage((target as HTMLImageElement).src);
        e.preventDefault();
      }
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [editor]);

  const handleImageUpload = () => imgInputRef.current?.click();

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editor) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const wordCount = editor ? editor.storage.characterCount.words() : 0;
  const charCount = editor ? editor.storage.characterCount.characters() : 0;

  if (!editor) return null;

  return (
    <div className="word-editor-wrap flex flex-col bg-[#e8e8e8] dark:bg-[#141414]">
      {editable && (
        <>
          <Toolbar editor={editor} onImageUpload={handleImageUpload} toolbarEnd={toolbarEnd} />
          <Ruler />
        </>
      )}

      {/* Page canvas */}
      <div
        ref={editorContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8"
        style={{ maxHeight: maxHeight || undefined }}
        onClick={(e) => { if (e.detail === 3) handleTripleClick(); }}
      >
        <div
          className="mx-auto w-full max-w-[816px] rounded-sm bg-white px-12 py-10 shadow-[0_1px_4px_rgba(0,0,0,0.12),0_0_1px_rgba(0,0,0,0.08)] dark:bg-[#1c1c1e] dark:shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
          style={{ minHeight }}
        >
          <EditorContent editor={editor} className="word-editor-content" />
        </div>
      </div>

      {/* Status bar */}
      {editable && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-[#f3f2f1] px-4 py-1 text-[10px] text-gray-500 dark:border-white/10 dark:bg-[#1e1e1e] dark:text-gray-500">
          <span>Words: {wordCount} | Characters: {charCount}</span>
          <span className="hidden sm:block">100%</span>
        </div>
      )}

      <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />
      {previewImage && <ImagePreviewModal src={previewImage} onClose={() => setPreviewImage(null)} />}
    </div>
  );
}
