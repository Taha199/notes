import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const HIGHLIGHT_COLORS = ['#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA', '#CE93D8', '#F48FB1', '#FFCC80', '#EF9A9A', '#B0BEC5', '#FFFFFF', '#000000'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);
type BlockAlign = 'left' | 'center' | 'right';
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const DEFAULT_FONT_PX = 15;
const FONT_LINE_HEIGHT = '1.35';

interface Props {
  html: string;
  onChange: (html: string) => void;
  placeholder: string;
  editable?: boolean;
  minHeight?: string;
  maxHeight?: string;
  toolbarEnd?: ReactNode;
  onLockedTripleClick?: () => void;
  resizable?: boolean;
  stickyToolbar?: boolean;
}

export function RichTextEditor({ html, onChange, placeholder, editable = true, minHeight = '120px', maxHeight, toolbarEnd, onLockedTripleClick, resizable, stickyToolbar = true }: Props) {
  const { t } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const savedFormattingRange = useRef<Range | null>(null);
  const pendingFontSize = useRef<number | null>(null);
  const [fontSize, setFontSizeState] = useState(15);
  const fontSizeRef = useRef(15);
  const fontInputFocused = useRef(false);
  const [sizeInput, setSizeInput] = useState('15');
  const setFontSize = (v: number) => { fontSizeRef.current = v; setFontSizeState(v); if (!fontInputFocused.current) setSizeInput(String(v)); };
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
    if (!r) return;
    savedRange.current = r.cloneRange();
    if (!r.collapsed) savedFormattingRange.current = r.cloneRange();
    else savedFormattingRange.current = null;
  };

  const captureFormattingSelection = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return;
    savedRange.current = range.cloneRange();
    if (!range.collapsed) savedFormattingRange.current = range.cloneRange();
    else savedFormattingRange.current = null;
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

  const stripEmptyFontSpans = (ed: HTMLElement) => {
    ed.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
      const text = span.textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (!text) span.remove();
    });
  };

  const finalizePendingFontMarkers = (ed: HTMLElement) => {
    ed.querySelectorAll<HTMLElement>('[data-font-marker]').forEach((s) => {
      s.innerHTML = s.innerHTML.replace(/\u200B/g, '');
      if (!s.textContent?.trim()) s.remove();
      else s.removeAttribute('data-font-marker');
    });
    pendingFontSize.current = null;
  };

  const readFontSizeAtCaret = (ed: HTMLElement): number => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return DEFAULT_FONT_PX;
    let node: Node | null = sel.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node instanceof HTMLElement && node !== ed) {
      if (node.tagName === 'SPAN' && node.style.fontSize) {
        const px = parseInt(node.style.fontSize, 10);
        if (px) return px;
      }
      node = node.parentElement;
    }
    if (node === ed) return DEFAULT_FONT_PX;
    if (node instanceof Element && ed.contains(node)) {
      const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
      if (px) return px;
    }
    return DEFAULT_FONT_PX;
  };

  const sanitizeCaretFontContext = (ed: HTMLElement) => {
    stripEmptyFontSpans(ed);
    pendingFontSize.current = null;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;

    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    while (node instanceof HTMLElement && node !== ed) {
      if (node.tagName === 'SPAN' && node.style.fontSize) {
        const visible = node.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (!visible) {
          const pos = document.createRange();
          pos.setStartBefore(node);
          pos.collapse(true);
          node.remove();
          sel.removeAllRanges();
          sel.addRange(pos);
          savedRange.current = pos.cloneRange();
        }
        break;
      }
      node = node.parentElement;
    }

    setFontSize(readFontSizeAtCaret(ed));
  };

  const getBlockParent = (node: Node | null, ed: HTMLElement): HTMLElement | null => {
    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el instanceof HTMLElement && el !== ed) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  };

  const getLineBlock = (node: Node | null, ed: HTMLElement): HTMLElement | null => {
    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el instanceof HTMLElement && el !== ed) {
      if (el.tagName === 'CENTER') return el;
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  };

  const getAlignmentTargetBlock = (node: Node | null, ed: HTMLElement): HTMLElement | null => {
    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    let innermost: HTMLElement | null = null;
    let outermostAligned: HTMLElement | null = null;
    while (el instanceof HTMLElement && el !== ed) {
      if (el.tagName === 'CENTER') outermostAligned = el;
      if (BLOCK_TAGS.has(el.tagName)) {
        if (!innermost) innermost = el;
        if (readBlockAlignment(el) !== 'left' || el.style.textAlign || el.getAttribute('align')) {
          outermostAligned = el;
        }
      }
      el = el.parentElement;
    }
    return outermostAligned ?? innermost;
  };

  const clearParentCentering = (block: HTMLElement, ed: HTMLElement) => {
    let parent = block.parentElement;
    while (parent && parent !== ed) {
      if (parent.tagName === 'CENTER') {
        normalizeCenterElement(parent, ed);
      } else if (BLOCK_TAGS.has(parent.tagName) || parent.hasAttribute('dir')) {
        stripBlockCenteringStyles(parent);
      }
      parent = parent.parentElement;
    }
  };

  const unwrapCenterTags = (root: HTMLElement) => {
    root.querySelectorAll('center').forEach((center) => {
      const parent = center.parentNode;
      if (!parent) return;
      while (center.firstChild) parent.insertBefore(center.firstChild, center);
      parent.removeChild(center);
    });
  };

  const readBlockAlignment = (block: HTMLElement): BlockAlign => {
    if (block.tagName === 'CENTER') return 'center';
    const inline = block.style.textAlign || block.getAttribute('align') || '';
    if (inline === 'center') return 'center';
    if (inline === 'right' || inline === 'end') return 'right';
    if (block.style.marginLeft === 'auto' && block.style.marginRight === 'auto') return 'center';
    const computed = getComputedStyle(block);
    if (computed.textAlign === 'center') return 'center';
    if (computed.textAlign === 'right' || computed.textAlign === 'end') return 'right';
    if (computed.marginLeft === 'auto' && computed.marginRight === 'auto' && block.style.width) return 'center';
    return 'left';
  };

  const readAlignmentAtCaret = (ed: HTMLElement): BlockAlign => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return 'left';
    const block = getAlignmentTargetBlock(sel.anchorNode, ed);
    return block ? readBlockAlignment(block) : 'left';
  };

  const getBlocksForAlignment = (range: Range, ed: HTMLElement, align: BlockAlign): HTMLElement[] => {
    const blocks = new Set<HTMLElement>();
    const collectChain = (node: Node | null) => {
      let el: Node | null = node;
      if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
      while (el instanceof HTMLElement && el !== ed) {
        if (BLOCK_TAGS.has(el.tagName) || el.tagName === 'CENTER') blocks.add(el);
        el = el.parentElement;
      }
    };

    if (align === 'left' || align === 'right') {
      collectChain(range.startContainer);
      if (!range.collapsed) collectChain(range.endContainer);
      if (blocks.size === 0) {
        const target = getAlignmentTargetBlock(range.startContainer, ed);
        if (target) blocks.add(target);
      }
      return [...blocks];
    }

    const target = getAlignmentTargetBlock(range.startContainer, ed);
    if (target) return [target];
    collectChain(range.startContainer);
    return [...blocks];
  };

  const placeCaretInBlock = (block: HTMLElement, atStart: boolean) => {
    const range = document.createRange();
    range.selectNodeContents(block);
    range.collapse(atStart);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
  };

  const handleCenteredLineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const ed = editorRef.current;
    if (!ed || !editable || e.button !== 0) return;

    const x = e.clientX;
    const y = e.clientY;
    let targetNode: Node | null = null;
    if (document.caretRangeFromPoint) {
      targetNode = document.caretRangeFromPoint(x, y)?.startContainer ?? null;
    } else {
      const pos = (document as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node } | null }).caretPositionFromPoint?.(x, y);
      targetNode = pos?.offsetNode ?? null;
    }
    if (!targetNode) {
      const el = document.elementFromPoint(x, y);
      if (el instanceof Node && ed.contains(el)) targetNode = el;
    }
    if (!targetNode || !ed.contains(targetNode)) return;

    const block = getAlignmentTargetBlock(targetNode, ed);
    if (!block || readBlockAlignment(block) === 'left') return;

    const rect = block.getBoundingClientRect();
    if (rect.width <= 0) return;

    const relX = (x - rect.left) / rect.width;
    const rtl = getComputedStyle(block).direction === 'rtl';
    const atStart = rtl ? relX > 0.65 : relX < 0.35;
    const atEnd = rtl ? relX < 0.35 : relX > 0.65;
    if (!atStart && !atEnd) return;

    e.preventDefault();
    ed.focus({ preventScroll: true });
    placeCaretInBlock(block, atStart);
    readCommandState();
    syncFontSizeFromCaret();
  };

  const stripBlockCenteringStyles = (block: HTMLElement) => {
    const clean = (el: HTMLElement) => {
      el.style.removeProperty('text-align');
      el.removeAttribute('align');
      el.style.removeProperty('margin-left');
      el.style.removeProperty('margin-right');
      el.style.removeProperty('margin-inline');
      el.style.removeProperty('margin-inline-start');
      el.style.removeProperty('margin-inline-end');
      el.style.removeProperty('width');
      el.style.removeProperty('max-width');
      if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
    };
    clean(block);
    block.querySelectorAll<HTMLElement>('[align], [style]').forEach((el) => {
      if (
        el.hasAttribute('align')
        || el.style.textAlign
        || el.style.marginLeft === 'auto'
        || el.style.marginRight === 'auto'
        || el.style.width
        || el.style.maxWidth
      ) {
        clean(el);
      }
    });
  };

  const normalizeCenterElement = (center: HTMLElement, ed: HTMLElement): HTMLDivElement => {
    const parent = center.parentElement ?? ed;
    const replacement = document.createElement('div');
    replacement.setAttribute('dir', 'auto');
    while (center.firstChild) replacement.appendChild(center.firstChild);
    parent.replaceChild(replacement, center);
    return replacement;
  };

  const clearNestedAlignment = (block: HTMLElement) => {
    unwrapCenterTags(block);
    stripBlockCenteringStyles(block);
  };

  const applyBlockAlignment = (align: BlockAlign) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });
    restoreSel();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

    let blocks = getBlocksForAlignment(range, ed, align);
    if (blocks.length === 0) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('formatBlock', false, 'div');
      const block = getAlignmentTargetBlock(sel.anchorNode, ed);
      if (block) blocks = [block];
    }
    if (blocks.length === 0) return;

    blocks.forEach((rawBlock) => {
      let block = rawBlock;
      if (block.tagName === 'CENTER') block = normalizeCenterElement(block, ed);
      if (align !== 'center') clearParentCentering(block, ed);
      clearNestedAlignment(block);
      block.style.display = 'block';
      block.style.width = '100%';
      block.style.textAlign = align;
      block.style.marginLeft = '0';
      block.style.marginRight = '0';
      block.removeAttribute('align');
    });

    if (align === 'left') {
      const line = getLineBlock(sel.anchorNode, ed) ?? blocks[blocks.length - 1];
      placeCaretInBlock(line, true);
    }

    saveSel();
    readCommandState();
    onChange(ed.innerHTML);
    ed.focus({ preventScroll: true });
  };

  const normalizeEmptyFontBlocks = (ed: HTMLElement) => {
    ed.querySelectorAll<HTMLElement>('div, p').forEach((block) => {
      block.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
        const text = span.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (!text) span.remove();
      });
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (!text) {
        block.innerHTML = '<br>';
        block.style.removeProperty('font-size');
        block.style.removeProperty('line-height');
      }
    });

    const topBlocks = Array.from(ed.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    for (let i = 1; i < topBlocks.length - 1; i++) {
      const block = topBlocks[i];
      if (!['DIV', 'P'].includes(block.tagName)) continue;
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (text) continue;
      const prevText = topBlocks[i - 1].textContent?.replace(/\u200B/g, '').trim() ?? '';
      const nextText = topBlocks[i + 1].textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (prevText && nextText) block.remove();
    }
  };

  const handleEditorEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    const ed = editorRef.current;
    if (!ed) return;

    clearPendingFontMarker();
    document.execCommand('insertParagraph');

    requestAnimationFrame(() => {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;

      const block = getBlockParent(sel.anchorNode, ed);
      if (block) {
        const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (!text) {
          block.innerHTML = '<br>';
          block.style.removeProperty('font-size');
          block.style.removeProperty('line-height');
          const range = document.createRange();
          range.setStart(block, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }

      normalizeEmptyFontBlocks(ed);
      stripEmptyFontSpans(ed);
      pendingFontSize.current = null;
      setFontSize(DEFAULT_FONT_PX);
      saveSel();
      onChange(ed.innerHTML);
    });
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
    TOGGLE_COMMANDS.forEach((c) => {
      try { if (document.queryCommandState(c)) active.add(c); } catch { /* noop */ }
    });
    const ed = editorRef.current;
    const sel = window.getSelection();
    if (ed && sel?.rangeCount) {
      const align = readAlignmentAtCaret(ed);
      if (align === 'left') active.add('justifyLeft');
      else if (align === 'center') active.add('justifyCenter');
      else active.add('justifyRight');
    }
    setActiveCmds(active);
    return active;
  };

  // ── Font size indicator in sync with caret ────────────────────────────
  const syncFontSizeFromCaret = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const px = readFontSizeAtCaret(ed);
    if (px !== fontSizeRef.current) setFontSize(px);
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

  const applyFontSizeStyle = (span: HTMLSpanElement, px: number) => {
    span.style.fontSize = `${px}px`;
    span.style.lineHeight = FONT_LINE_HEIGHT;
  };

  // ── Font size ─────────────────────────────────────────────────────────
  const clearPendingFontMarker = () => {
    const ed = editorRef.current;
    if (!ed) return;
    finalizePendingFontMarkers(ed);
    stripEmptyFontSpans(ed);
  };

  const setFutureFontSize = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    if (document.activeElement !== ed) {
      ed.focus({ preventScroll: true });
      restoreSel();
    }
    const sel = window.getSelection();
    let range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!range || !range.collapsed) { setFontSize(px); return; }

    // If caret landed at the root editor level (startContainer === ed), move it
    // into the last block child so we don't create an orphan root-level span.
    if (range.startContainer === ed) {
      const lastChild = ed.lastChild;
      if (lastChild) {
        range = document.createRange();
        range.selectNodeContents(lastChild);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }

    // Finalize any previous marker instead of leaving orphan styled spans behind.
    finalizePendingFontMarkers(ed);
    stripEmptyFontSpans(ed);
    // Insert a zero-width-space span at the caret so the browser types INTO it.
    const span = document.createElement('span');
    span.setAttribute('data-font-marker', 'true');
    applyFontSizeStyle(span, px);
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

  const restoreSavedRange = (saved: Range | null, ed: HTMLElement): Range | null => {
    if (!saved || saved.collapsed || !ed.contains(saved.commonAncestorContainer)) return null;
    ed.focus({ preventScroll: true });
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(saved);
    return s?.getRangeAt(0) ?? saved;
  };

  const resolveFormatRange = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;

    if (document.activeElement === ed) {
      const s = window.getSelection();
      if (s && s.rangeCount > 0 && !s.isCollapsed && ed.contains(s.anchorNode)) {
        return s.getRangeAt(0);
      }
    }

    return (
      restoreSavedRange(savedFormattingRange.current?.cloneRange() ?? null, ed)
      ?? restoreSavedRange(savedRange.current?.cloneRange() ?? null, ed)
    );
  };

  const getStylingSpanForRange = (range: Range, ed: HTMLElement): HTMLSpanElement | null => {
    const ancestor = range.commonAncestorContainer;
    let span: HTMLSpanElement | null = null;
    if (ancestor instanceof HTMLSpanElement && ancestor.style.fontSize && ed.contains(ancestor)) {
      span = ancestor;
    } else if (
      ancestor.nodeType === Node.TEXT_NODE
      && ancestor.parentElement instanceof HTMLSpanElement
      && ancestor.parentElement.style.fontSize
      && ed.contains(ancestor.parentElement)
    ) {
      span = ancestor.parentElement;
    }
    if (!span) return null;

    const spanRange = document.createRange();
    spanRange.selectNodeContents(span);
    if (
      range.compareBoundaryPoints(Range.START_TO_START, spanRange) === 0
      && range.compareBoundaryPoints(Range.END_TO_END, spanRange) === 0
    ) {
      return span;
    }
    return null;
  };

  const readFontSizeFromRange = (range: Range, ed: HTMLElement): number => {
    const styled = getStylingSpanForRange(range, ed);
    if (styled) {
      const px = parseInt(styled.style.fontSize, 10);
      if (px) return px;
    }
    let node: Node | null = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!(node instanceof Element) || !ed.contains(node)) return fontSizeRef.current;
    const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
    return px || fontSizeRef.current;
  };

  const applyPx = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;

    const range = resolveFormatRange();
    if (!range || range.collapsed) {
      setFutureFontSize(px);
      return;
    }

    savedFormattingRange.current = null;

    const existingSpan = getStylingSpanForRange(range, ed);
    if (existingSpan) {
      applyFontSizeStyle(existingSpan, px);
      const nextRange = document.createRange();
      nextRange.selectNodeContents(existingSpan);
      const finalSel = window.getSelection();
      finalSel?.removeAllRanges();
      finalSel?.addRange(nextRange);
      setFontSize(px);
      saveSel();
      onChange(ed.innerHTML);
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
    applyFontSizeStyle(span, px);
    span.appendChild(contents);
    range.insertNode(span);
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    const finalSel = window.getSelection();
    finalSel?.removeAllRanges();
    finalSel?.addRange(nextRange);
    setFontSize(px);
    saveSel();
    onChange(ed.innerHTML);
  };

  const nextSz = (cur: number, d: number) => {
    if (d > 0) return SIZES.find((s) => s > cur) ?? SIZES[SIZES.length - 1];
    return [...SIZES].reverse().find((s) => s < cur) ?? SIZES[0];
  };

  const changeSize = (d: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    const range = resolveFormatRange();
    if (range && !range.collapsed) {
      applyPx(nextSz(readFontSizeFromRange(range, ed), d));
    } else {
      setFutureFontSize(nextSz(fontSizeRef.current, d));
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

  // Remove explicit text color so the text follows the theme (white in dark, dark in light).
  const clearTextColor = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const rangeToUse = savedRange.current?.cloneRange() ?? null;
    ed.focus({ preventScroll: true });
    if (rangeToUse) { const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(rangeToUse); }
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    // Strip inline color from spans the selection touches; leave background-color intact.
    ed.querySelectorAll<HTMLElement>('[style*="color"]').forEach((el) => {
      if (!range || range.intersectsNode(el)) {
        el.style.color = '';
        if (!el.getAttribute('style')) el.removeAttribute('style');
      }
    });
    ed.querySelectorAll('font[color]').forEach((el) => {
      if (!range || range.intersectsNode(el)) el.removeAttribute('color');
    });
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
    if (c === 'transparent') {
      // backColor only adds a transparent layer — strip background from the
      // actual spans that the selection touches so the highlight truly clears.
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
      ed.querySelectorAll<HTMLElement>('[style*="background"]').forEach((el) => {
        if (!range || range.intersectsNode(el)) {
          el.style.backgroundColor = '';
          el.style.background = '';
          if (!el.getAttribute('style')) el.removeAttribute('style');
        }
      });
    }
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

  // ── Divider: underline the current line + start a new paragraph below ──
  const insertDivider = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ensureFocus(true);
    document.execCommand('insertHTML', false, '<hr style="border:0;border-top:1px solid currentColor;opacity:0.3;margin:10px 0" /><div dir="auto"><br></div>');
    saveSel();
    onChange(ed.innerHTML);
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
        className={
          'flex flex-wrap items-center gap-0.5 border-b border-app-border bg-app-bg px-3 py-1.5 dark:border-white/10 dark:bg-white/5 ' +
          (stickyToolbar && editable ? 'sticky top-0 z-20 bg-app-bg/95 shadow-sm backdrop-blur-sm dark:bg-gray-900/95' : '')
        }
        style={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.4 }}
      >
        {/* Font size */}
        <div
          className="flex items-center overflow-hidden rounded-lg border border-app-border bg-white dark:border-white/10 dark:bg-gray-900"
          onMouseDownCapture={captureFormattingSelection}
        >
          <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); changeSize(-1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">−</button>
          <input
            value={sizeInput}
            onChange={(e) => setSizeInput(e.target.value)}
            onFocus={() => { captureFormattingSelection(); fontInputFocused.current = true; }}
            onBlur={() => { fontInputFocused.current = false; const v = parseInt(sizeInput, 10); if (v > 0) { setFontSize(v); applyPx(v); } else { setSizeInput(String(fontSize)); } }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const v = parseInt(sizeInput, 10); (e.target as HTMLInputElement).blur(); if (v > 0) { setTimeout(() => { setFontSize(v); applyPx(v); }, 0); } } }}
            className="h-[26px] w-8 border-x border-app-border bg-transparent text-center text-xs font-semibold text-app-text outline-none dark:border-white/10 dark:text-gray-100"
          />
          <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); changeSize(1); }} className="flex h-[26px] w-6 items-center justify-center text-sm font-bold text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10">+</button>
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
              <div onMouseDown={(e) => { e.preventDefault(); clearTextColor(); }} className="col-span-6 mt-0.5 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5">✕ Standardfärg (auto)</div>
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
              <div onMouseDown={(e) => { e.preventDefault(); applyHighlight('transparent'); }} className="col-span-5 mt-0.5 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5">✕ Ta bort markering</div>
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
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('left'); }} title="Align left" className={btnCls(activeCmds.has('justifyLeft'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('center'); }} title="Center" className={btnCls(activeCmds.has('justifyCenter'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('right'); }} title="Align right" className={btnCls(activeCmds.has('justifyRight'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="9" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="9" y="20" width="12" height="2" rx="1"/></svg>
        </button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Image */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); imgInputRef.current?.click(); }} title="Insert image" className={btnCls(false)}>🖼</button>
        <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = ''; }} />

        {/* Divider line + new paragraph */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); insertDivider(); }} title="Avdelare (linje + ny rad)" className={btnCls(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="11" width="18" height="2" rx="1"/></svg>
        </button>

        {toolbarEnd && <div className="ml-auto flex items-center pl-2">{toolbarEnd}</div>}
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable={editable}
        data-placeholder={placeholder}
        dir="auto"
        onMouseDown={(e) => {
          const ed = editorRef.current;
          if (!ed) return;
          handleCenteredLineClick(e);
          clearPendingFontMarker();
          requestAnimationFrame(() => sanitizeCaretFontContext(ed));
        }}
        onFocus={() => {
          const ed = editorRef.current;
          if (ed) sanitizeCaretFontContext(ed);
        }}
        onKeyDown={(e) => {
          if (NAV_KEYS.has(e.key)) clearPendingFontMarker();
          handleEditorEnter(e);
        }}
        onInput={() => {
          const ed = editorRef.current;
          if (ed) {
            ed.childNodes.forEach((node) => {
              if (node instanceof HTMLElement && !node.hasAttribute('dir')) {
                node.setAttribute('dir', 'auto');
              }
            });
            stripEmptyFontSpans(ed);
            syncFontSizeFromCaret();
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
        className={'overflow-y-auto px-4 py-3 leading-normal text-app-text outline-none dark:text-gray-100 [&_div]:my-0 [&_p]:my-0 [&_ul]:list-disc [&_ul]:pr-5 [&_ol]:list-decimal [&_ol]:pr-5' + (resizable && editable ? ' resize-y' : '')}
        style={{ minHeight, maxHeight: resizable ? undefined : maxHeight, fontSize: `${DEFAULT_FONT_PX}px`, lineHeight: FONT_LINE_HEIGHT, cursor: editable ? 'text' : 'default' }}
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
