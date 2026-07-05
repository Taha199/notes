import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { NOTE_IMG_FRAME, NOTE_IMG_TOOLBAR, NOTE_IMG_TOOLBAR_HOST, resolveNoteImage } from '../../lib/noteImage';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const HIGHLIGHT_COLORS = ['#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA', '#CE93D8', '#F48FB1', '#FFCC80', '#EF9A9A', '#B0BEC5', '#FFFFFF', '#000000'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);
const LIST_TAGS = new Set(['UL', 'OL']);
const BULLET_PREFIX_RE = /^[\s\u00a0]*(?:[•●◦▪▫‣⁃·\-–—*+]|\d+[.)])\s*/;
type BlockAlign = 'left' | 'center' | 'right';
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const DEFAULT_FONT_PX = 15;
const FONT_LINE_HEIGHT = '1.35';
const TAB_INDENT = '    ';
interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Fires on every edit immediately — use for save refs without re-rendering each keystroke. */
  onLiveChange?: (html: string) => void;
  placeholder: string;
  editable?: boolean;
  minHeight?: string;
  maxHeight?: string;
  toolbarEnd?: ReactNode;
  onLockedTripleClick?: () => void;
  resizable?: boolean;
  stickyToolbar?: boolean;
}

export function RichTextEditor({ html, onChange, onLiveChange, placeholder, editable = true, minHeight = '120px', maxHeight, toolbarEnd, onLockedTripleClick, resizable, stickyToolbar = true }: Props) {
  const { t, lang } = useLanguage();
  const editorRef = useRef<HTMLDivElement>(null);

  const ensureImageFrame = (img: HTMLImageElement, _ed: HTMLElement): HTMLElement => {
    const existing = img.closest(`.${NOTE_IMG_FRAME}`);
    if (existing instanceof HTMLElement) {
      getToolbarHost(existing);
      return existing;
    }
    const frame = document.createElement('div');
    frame.className = NOTE_IMG_FRAME;
    frame.setAttribute('contenteditable', 'false');
    frame.setAttribute('dir', 'auto');
    const parent = img.parentNode;
    if (!parent) return img;
    parent.insertBefore(frame, img);
    frame.appendChild(img);
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    if (!img.style.height) img.style.height = 'auto';
    img.style.margin = '0';
    img.style.borderRadius = '0';
    frame.style.display = 'block';
    frame.style.width = 'fit-content';
    frame.style.maxWidth = '100%';
    getToolbarHost(frame);
    return frame;
  };

  const getToolbarHost = (frame: HTMLElement): HTMLElement => {
    const existing = frame.querySelector(`.${NOTE_IMG_TOOLBAR_HOST}`);
    if (existing instanceof HTMLElement) return existing;
    const host = document.createElement('div');
    host.className = NOTE_IMG_TOOLBAR_HOST;
    host.setAttribute('contenteditable', 'false');
    frame.appendChild(host);
    return host;
  };

  const stripImageToolbars = (root: ParentNode) => {
    root.querySelectorAll(`.${NOTE_IMG_TOOLBAR}`).forEach((el) => el.remove());
    root.querySelectorAll(`.${NOTE_IMG_TOOLBAR_HOST}`).forEach((el) => el.remove());
  };

  /** Serialize without cloning — avoids duplicating large base64 images in memory. */
  const serializeEditorHtml = (ed: HTMLElement): string => {
    const detached: { frame: HTMLElement; host: HTMLElement }[] = [];
    ed.querySelectorAll(`.${NOTE_IMG_TOOLBAR_HOST}`).forEach((node) => {
      if (node instanceof HTMLElement && node.parentElement instanceof HTMLElement) {
        detached.push({ frame: node.parentElement, host: node });
        node.remove();
      }
    });
    const html = ed.innerHTML;
    detached.forEach(({ frame, host }) => frame.appendChild(host));
    return html;
  };

  const normalizeEditorImages = (ed: HTMLElement) => {
    stripImageToolbars(ed);
    ed.querySelectorAll('img').forEach((node) => {
      if (node instanceof HTMLImageElement) {
        if (!node.loading) node.loading = 'lazy';
        if (!node.decoding) node.decoding = 'async';
        if (!node.closest(`.${NOTE_IMG_FRAME}`)) ensureImageFrame(node, ed);
      }
    });
    ed.querySelectorAll(`.${NOTE_IMG_FRAME}`).forEach((frame) => {
      if (frame instanceof HTMLElement) getToolbarHost(frame);
    });
  };

  const removeImageBlock = (img: HTMLImageElement) => {
    const frame = img.closest(`.${NOTE_IMG_FRAME}`);
    if (frame?.parentNode) {
      const after = frame.nextSibling;
      frame.parentNode.removeChild(frame);
      if (after?.nodeName === 'BR' && after.parentNode) after.parentNode.removeChild(after);
    } else {
      const next = img.nextSibling;
      img.parentNode?.removeChild(img);
      if (next?.nodeName === 'BR') next.parentNode?.removeChild(next);
    }
  };

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
  const [hoveredImg, setHoveredImg] = useState<{ el: HTMLImageElement; frame: HTMLElement; host: HTMLElement; rect: DOMRect } | null>(null);
  const [imgResizeMode, setImgResizeMode] = useState(false);
  const imgResizeModeRef = useRef(false);
  imgResizeModeRef.current = imgResizeMode;
  const isResizingImg = useRef(false);
  const activeFrameRef = useRef<HTMLElement | null>(null);
  const hoveredImgElRef = useRef<HTMLImageElement | null>(null);
  const hoverMoveRafRef = useRef<number | null>(null);

  const syncHoveredImg = (img: HTMLImageElement, frame: HTMLElement) => ({
    el: img,
    frame,
    host: getToolbarHost(frame),
    rect: img.getBoundingClientRect(),
  });

  const hideImageToolbar = () => {
    if (isResizingImg.current || imgResizeModeRef.current) return;
    activeFrameRef.current?.classList.remove('note-img-frame--active');
    activeFrameRef.current = null;
    hoveredImgElRef.current = null;
    setHoveredImg(null);
    setImgResizeMode(false);
  };

  const showImageToolbar = (img: HTMLImageElement) => {
    const ed = editorRef.current;
    if (!ed) return;
    const frame = ensureImageFrame(img, ed);
    if (hoveredImgElRef.current === img && activeFrameRef.current === frame) return;
    if (activeFrameRef.current && activeFrameRef.current !== frame) {
      activeFrameRef.current.classList.remove('note-img-frame--active');
    }
    frame.classList.add('note-img-frame--active');
    activeFrameRef.current = frame;
    hoveredImgElRef.current = img;
    setHoveredImg(syncHoveredImg(img, frame));
  };

  const handleEditorMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || isResizingImg.current) return;
    if (hoverMoveRafRef.current !== null) return;
    const target = event.target;
    hoverMoveRafRef.current = requestAnimationFrame(() => {
      hoverMoveRafRef.current = null;
      const img = resolveNoteImage(target);
      if (img) {
        showImageToolbar(img);
        return;
      }
      if (imgResizeModeRef.current) return;
      if (hoveredImgElRef.current) {
        if (target instanceof Node && activeFrameRef.current?.contains(target)) return;
        hideImageToolbar();
      }
    });
  };
  const colorWrapRef = useRef<HTMLDivElement>(null);
  const colorPalRef = useRef<HTMLDivElement>(null);
  const hlWrapRef = useRef<HTMLDivElement>(null);
  const hlPalRef = useRef<HTMLDivElement>(null);
  const listWrapRef = useRef<HTMLDivElement>(null);
  const listPalRef = useRef<HTMLDivElement>(null);
  /** Frozen caret when the list menu opens — used so toolbar clicks don't lose the target line. */
  const listMenuRangeRef = useRef<Range | null>(null);
  const listMenuBlockRef = useRef<HTMLElement | null>(null);
  const [listPalOpen, setListPalOpen] = useState(false);
  const [listPalPos, setListPalPos] = useState({ left: 0, top: 0 });
  const imgInputRef = useRef<HTMLInputElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const lastLocalHtmlRef = useRef(html);
  const lastPropHtmlRef = useRef(html);
  const onChangeRef = useRef(onChange);
  const onLiveChangeRef = useRef(onLiveChange);
  onChangeRef.current = onChange;
  onLiveChangeRef.current = onLiveChange;
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputCleanupRafRef = useRef<number | null>(null);
  const selectionRafRef = useRef<number | null>(null);
  const EMIT_DEBOUNCE_MS = 280;

  const emitHtml = () => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      emitTimerRef.current = null;
      const ed = editorRef.current;
      if (!ed) return;
      const next = serializeEditorHtml(ed);
      lastLocalHtmlRef.current = next;
      onLiveChangeRef.current?.(next);
      onChangeRef.current(next);
    }, EMIT_DEBOUNCE_MS);
  };

  const flushEmitHtml = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const next = serializeEditorHtml(ed);
    lastLocalHtmlRef.current = next;
    onLiveChangeRef.current?.(next);
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    onChangeRef.current(next);
  };

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

  /** Resolve the block line for a range, including when the caret sits on the editor root. */
  const resolveBlockAtRange = (range: Range, ed: HTMLElement): HTMLElement | null => {
    if (range.startContainer === ed) {
      const children = Array.from(ed.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
      const offset = range.startOffset;
      if (offset < children.length) {
        const child = children[offset];
        if (LIST_TAGS.has(child.tagName)) {
          const items = child.querySelectorAll('li');
          return (items[items.length - 1] as HTMLLIElement) ?? child;
        }
        if (BLOCK_TAGS.has(child.tagName)) return child;
      }
      if (children.length > 0) {
        const last = children[children.length - 1];
        if (LIST_TAGS.has(last.tagName)) {
          const items = last.querySelectorAll('li');
          return (items[items.length - 1] as HTMLLIElement) ?? last;
        }
        if (BLOCK_TAGS.has(last.tagName)) return last;
      }
      return null;
    }
    const fromLine = getLineBlock(range.startContainer, ed);
    if (fromLine && fromLine !== ed) return fromLine;
    return getBlockParent(range.startContainer, ed);
  };

  /** Split a multi-line div so list formatting targets only the caret's visual line. */
  const isolateLineBlockForList = (range: Range, ed: HTMLElement): HTMLElement | null => {
    const block = resolveBlockAtRange(range, ed);
    if (!block || block === ed || block.tagName === 'LI' || block.closest('li')) return block;
    if (!caretFollowsLineBreakInBlock(block, range)) return block;

    const newBlock = document.createElement('div');
    newBlock.setAttribute('dir', 'auto');
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(block, block.childNodes.length);
    const tail = tailRange.extractContents();
    const tailText = tail.textContent?.replace(/\u200B/g, '').trim() ?? '';
    if (tailText || tail.querySelector('br, img')) {
      newBlock.appendChild(tail);
    } else {
      newBlock.innerHTML = '<br>';
    }
    block.parentNode?.insertBefore(newBlock, block.nextSibling);
    placeCaretInBlock(newBlock, true);
    return newBlock;
  };

  const isNumberedPrefix = (match: RegExpMatchArray) => /\d+[.)]/.test(match[0]);

  /** Ensure a div/p block exists at the caret for list conversion. */
  const ensureBlockAtRange = (ed: HTMLElement, range: Range): HTMLElement => {
    const existing = resolveBlockAtRange(range, ed);
    if (existing && existing !== ed && existing.tagName !== 'LI' && !existing.closest('li')) {
      return existing;
    }

    const div = document.createElement('div');
    div.setAttribute('dir', 'auto');
    div.innerHTML = '<br>';

    if (range.startContainer === ed) {
      const children = Array.from(ed.children);
      const idx = Math.min(range.startOffset, children.length);
      if (idx < children.length) ed.insertBefore(div, children[idx]);
      else ed.appendChild(div);
    } else {
      const anchor = getBlockParent(range.startContainer, ed);
      if (anchor?.parentNode) anchor.parentNode.insertBefore(div, anchor.nextSibling);
      else ed.appendChild(div);
    }

    placeCaretInBlock(div, true);
    return div;
  };

  const getListItem = (node: Node | null, ed: HTMLElement): HTMLLIElement | null => {
    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el instanceof HTMLElement && el !== ed) {
      if (el.tagName === 'LI') return el as HTMLLIElement;
      el = el.parentElement;
    }
    return null;
  };

  /** Resolve LI even when the caret sits on the list element (e.g. margin click). */
  const resolveListItemAtSelection = (range: Range, ed: HTMLElement): HTMLLIElement | null => {
    const direct = getListItem(range.startContainer, ed);
    if (direct) return direct;

    const list = getListContainer(range.startContainer, ed);
    if (!list) return null;

    const items = Array.from(list.children).filter((n): n is HTMLLIElement => n.tagName === 'LI');
    if (items.length === 0) return null;

    if (range.startContainer === list) {
      const idx = Math.max(0, Math.min(range.startOffset, items.length - 1));
      return items[idx];
    }

    return items[items.length - 1];
  };

  const getListContainer = (node: Node | null, ed: HTMLElement): HTMLUListElement | HTMLOListElement | null => {
    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    while (el instanceof HTMLElement && el !== ed) {
      if (LIST_TAGS.has(el.tagName)) return el as HTMLUListElement | HTMLOListElement;
      el = el.parentElement;
    }
    return null;
  };

  const isCaretAtStartOfLi = (li: HTMLLIElement, range: Range): boolean => {
    const probe = document.createRange();
    probe.selectNodeContents(li);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().replace(/\u200B/g, '').length === 0;
  };

  const isCaretAtEndOfBlock = (block: HTMLElement, range: Range): boolean => {
    const probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setStart(range.endContainer, range.endOffset);
    return probe.toString().replace(/\u200B/g, '').length === 0;
  };

  const isCaretAtEffectiveEndOfLi = (li: HTMLLIElement, range: Range): boolean => {
    if (isCaretAtEndOfBlock(li, range)) return true;
    const tail = document.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(li, li.childNodes.length);
    const scratch = document.createElement('div');
    scratch.appendChild(tail.cloneContents());
    return scratch.innerHTML.replace(/<br\s*\/?>/gi, '').replace(/\u200B/g, '').trim() === '';
  };

  const isCaretAtStartOfBlock = (block: HTMLElement, range: Range): boolean => {
    const probe = document.createRange();
    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().replace(/\u200B/g, '').length === 0;
  };

  const isLiEmpty = (li: HTMLLIElement) =>
    !(li.textContent?.replace(/\u200B/g, '').trim() ?? '') && !li.querySelector('img');

  const insertNewListItemAfter = (li: HTMLLIElement) => {
    const newLi = document.createElement('li');
    newLi.setAttribute('dir', 'auto');
    newLi.innerHTML = '<br>';
    li.parentNode?.insertBefore(newLi, li.nextSibling);
    placeCaretInBlock(newLi, true);
  };

  const splitListItemAtCaret = (li: HTMLLIElement, range: Range) => {
    const newLi = document.createElement('li');
    newLi.setAttribute('dir', 'auto');
    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(li, li.childNodes.length);
    const tail = tailRange.extractContents();
    if ((tail.textContent?.replace(/\u200B/g, '').trim() ?? '') || tail.querySelector('br, img')) {
      newLi.appendChild(tail);
    } else {
      newLi.innerHTML = '<br>';
    }
    if (isLiEmpty(li)) li.innerHTML = '<br>';
    li.parentNode?.insertBefore(newLi, li.nextSibling);
    placeCaretInBlock(newLi, true);
  };

  const splitListItemAtStart = (li: HTMLLIElement) => {
    const newLi = document.createElement('li');
    newLi.setAttribute('dir', 'auto');
    while (li.firstChild) newLi.appendChild(li.firstChild);
    if (isLiEmpty(newLi)) newLi.innerHTML = '<br>';
    li.innerHTML = '<br>';
    li.parentNode?.insertBefore(newLi, li);
    placeCaretInBlock(newLi, true);
  };

  const getBlockPrefixMatch = (block: HTMLElement): RegExpMatchArray | null => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (!firstText || firstText.nodeType !== Node.TEXT_NODE) return null;
    return (firstText.textContent ?? '').match(BULLET_PREFIX_RE);
  };

  const nextPrefixFromMatch = (match: RegExpMatchArray): string => {
    const full = match[0];
    const num = full.match(/(\d+)([.)])/);
    if (num) return full.replace(num[1], String(parseInt(num[1], 10) + 1));
    return full;
  };

  const stripBulletPrefixFromLi = (li: HTMLElement) => {
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (!firstText || firstText.nodeType !== Node.TEXT_NODE) return;
    const text = firstText.textContent ?? '';
    const stripped = text.replace(BULLET_PREFIX_RE, '');
    if (stripped === text) return;
    firstText.textContent = stripped;
    if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
      li.innerHTML = '<br>';
    }
  };

  const unwrapListItemToDiv = (li: HTMLLIElement): HTMLDivElement => {
    const div = document.createElement('div');
    div.setAttribute('dir', 'auto');
    while (li.firstChild) div.appendChild(li.firstChild);
    div.querySelectorAll('ul, ol').forEach((nested) => unwrapList(nested as HTMLUListElement | HTMLOListElement));
    const text = div.textContent?.replace(/\u200B/g, '').trim() ?? '';
    if (!text && !div.querySelector('img')) div.innerHTML = '<br>';
    return div;
  };

  const unwrapList = (list: HTMLUListElement | HTMLOListElement) => {
    const parent = list.parentNode;
    if (!parent) return;
    const items = Array.from(list.children).filter((n): n is HTMLLIElement => n.tagName === 'LI');
    const divs = items.map((li) => unwrapListItemToDiv(li));
    divs.forEach((div) => parent.insertBefore(div, list));
    list.remove();
  };

  const exitListItem = (li: HTMLLIElement, ed: HTMLElement, caretAtStart: boolean) => {
    const div = unwrapListItemToDiv(li);
    const list = li.parentElement;
    if (!list || !LIST_TAGS.has(list.tagName)) return;
    const parent = list.parentNode;
    if (!parent) return;

    const afterList = list.nextSibling;
    li.remove();
    if (list.children.length === 0) list.remove();
    parent.insertBefore(div, afterList);
    placeCaretInBlock(div, caretAtStart);
    saveSel();
  };

  const handleEmptyListItemEnter = (li: HTMLLIElement) => {
    insertNewListItemAfter(li);
  };

  const isNestedListItem = (li: HTMLLIElement) => {
    const list = li.parentElement;
    return !!list && LIST_TAGS.has(list.tagName) && list.parentElement?.closest('li') instanceof HTMLLIElement;
  };

  const canOutdentListItem = (li: HTMLLIElement) => isNestedListItem(li);

  const canIndentListItem = (li: HTMLLIElement) => li.previousElementSibling instanceof HTMLLIElement;

  /** Promote a nested item to the parent list (sibling after its parent line). */
  const returnToParentListItem = (li: HTMLLIElement): boolean => {
    if (!isNestedListItem(li)) return false;
    return outdentListItem(li);
  };

  const indentListItem = (li: HTMLLIElement): boolean => {
    const prevLi = li.previousElementSibling;
    if (!(prevLi instanceof HTMLLIElement)) return false;

    const parentList = li.parentElement;
    if (!parentList || !LIST_TAGS.has(parentList.tagName)) return false;
    const ordered = parentList.tagName === 'OL';

    let subList = Array.from(prevLi.children).find(
      (c): c is HTMLUListElement | HTMLOListElement =>
        c instanceof HTMLElement && LIST_TAGS.has(c.tagName),
    );
    if (!subList) {
      subList = document.createElement(ordered ? 'ol' : 'ul');
      subList.setAttribute('dir', 'auto');
      prevLi.appendChild(subList);
    }

    subList.appendChild(li);
    placeCaretInBlock(li, isLiEmpty(li));
    return true;
  };

  const outdentListItem = (li: HTMLLIElement): boolean => {
    const subList = li.parentElement;
    if (!subList || !LIST_TAGS.has(subList.tagName)) return false;
    const parentLi = subList.parentElement;
    if (!(parentLi instanceof HTMLLIElement)) return false;
    const outerList = parentLi.parentElement;
    if (!outerList || !LIST_TAGS.has(outerList.tagName)) return false;

    outerList.insertBefore(li, parentLi.nextSibling);
    if (subList.children.length === 0) subList.remove();
    placeCaretInBlock(li, isLiEmpty(li));
    return true;
  };

  const nestSubListUnder = (li: HTMLLIElement): boolean => {
    const parentList = li.parentElement;
    if (!parentList || !LIST_TAGS.has(parentList.tagName)) return false;
    const ordered = parentList.tagName === 'OL';

    let subList = Array.from(li.children).find(
      (c): c is HTMLUListElement | HTMLOListElement =>
        c instanceof HTMLElement && LIST_TAGS.has(c.tagName),
    );
    if (!subList) {
      subList = document.createElement(ordered ? 'ol' : 'ul');
      subList.setAttribute('dir', 'auto');
      li.appendChild(subList);
    }

    const newLi = document.createElement('li');
    newLi.setAttribute('dir', 'auto');
    newLi.innerHTML = '<br>';
    subList.appendChild(newLi);
    placeCaretInBlock(newLi, true);
    return true;
  };

  const restoreListEditingSelection = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    ed.focus({ preventScroll: true });
    const sel = window.getSelection();
    if (!sel) return null;

    const frozen = listMenuRangeRef.current;
    if (frozen && ed.contains(frozen.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(frozen);
      savedRange.current = frozen.cloneRange();
      return frozen.cloneRange();
    }
    if (savedRange.current && ed.contains(savedRange.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
      return savedRange.current.cloneRange();
    }
    const live = liveRange();
    if (live) return live;
    restoreSel();
    return sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  };

  const resolveListItemForAction = (range: Range, ed: HTMLElement): HTMLLIElement | null => {
    const direct = resolveListItemAtSelection(range, ed);
    if (direct) return direct;
    const block = listMenuBlockRef.current;
    if (block?.isConnected) {
      const fromBlock = block.closest('li');
      if (fromBlock instanceof HTMLLIElement) return fromBlock;
    }
    return null;
  };

  const applySubList = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const range = restoreListEditingSelection();
    if (!range) return;
    listMenuRangeRef.current = null;
    listMenuBlockRef.current = null;

    const li = resolveListItemForAction(range, ed);
    if (!li) return;

    if (!nestSubListUnder(li)) return;
    saveSel();
    readCommandState();
    emitHtml();
    setListPalOpen(false);
  };

  const applyOutdentSubList = () => {
    const ed = editorRef.current;
    if (!ed) return;
    const range = restoreListEditingSelection();
    if (!range) return;
    listMenuRangeRef.current = null;
    listMenuBlockRef.current = null;

    const li = resolveListItemForAction(range, ed);
    if (!li || !returnToParentListItem(li)) return;
    saveSel();
    readCommandState();
    emitHtml();
    setListPalOpen(false);
  };

  const mergeListItemWithPrevious = (li: HTMLLIElement) => {
    const prevLi = li.previousElementSibling;
    if (!(prevLi instanceof HTMLLIElement)) return false;
    const junction = prevLi.textContent?.length ?? 0;
    while (li.firstChild) prevLi.appendChild(li.firstChild);
    li.remove();
    const list = prevLi.parentElement;
    if (list && list.children.length === 0) list.remove();
    const textNode = prevLi.firstChild;
    const sel = window.getSelection();
    const pos = document.createRange();
    if (textNode?.nodeType === Node.TEXT_NODE) {
      pos.setStart(textNode, Math.min(junction, textNode.textContent?.length ?? 0));
    } else {
      pos.selectNodeContents(prevLi);
      pos.collapse(false);
    }
    pos.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(pos);
    savedRange.current = pos.cloneRange();
    return true;
  };

  const stripBulletPrefixFromBlock = (block: HTMLElement) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (!firstText || firstText.nodeType !== Node.TEXT_NODE) return;
    const text = firstText.textContent ?? '';
    const stripped = text.replace(BULLET_PREFIX_RE, '');
    if (stripped === text) return;
    firstText.textContent = stripped;
    if (!block.textContent?.replace(/\u200B/g, '').trim() && !block.querySelector('img')) {
      block.innerHTML = '<br>';
    }
  };

  const collectBlocksInRange = (ed: HTMLElement, range: Range): HTMLElement[] => {
    const blocks = new Set<HTMLElement>();
    if (range.collapsed) {
      const block = getBlockParent(range.startContainer, ed);
      if (block && block.tagName !== 'LI') blocks.add(block);
      return [...blocks];
    }
    ed.querySelectorAll<HTMLElement>('div, p').forEach((block) => {
      if (range.intersectsNode(block) && block.tagName !== 'LI' && !block.closest('li')) {
        blocks.add(block);
      }
    });
    return [...blocks];
  };

  const getBlocksForListAction = (ed: HTMLElement, range: Range, activeBlock?: HTMLElement | null): HTMLElement[] => {
    if (!range.collapsed) {
      return collectBlocksInRange(ed, range).filter((b) => !b.closest('li'));
    }
    const block = activeBlock ?? resolveBlockAtRange(range, ed);
    if (!block || block === ed || block.tagName === 'LI' || block.closest('li')) return [];
    return [block];
  };

  const convertBlocksToList = (blocks: HTMLElement[], ordered: boolean, activeBlock?: HTMLElement | null) => {
    if (blocks.length === 0) return;
    const parent = blocks[0].parentNode;
    if (!parent) return;
    const list = document.createElement(ordered ? 'ol' : 'ul');
    list.setAttribute('dir', 'auto');
    blocks.forEach((block) => {
      const li = document.createElement('li');
      li.setAttribute('dir', 'auto');
      while (block.firstChild) li.appendChild(block.firstChild);
      stripBulletPrefixFromLi(li);
      if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
        li.innerHTML = '<br>';
      }
      list.appendChild(li);
    });
    parent.insertBefore(list, blocks[0]);
    blocks.forEach((b) => b.remove());
    const focusBlock = activeBlock && blocks.includes(activeBlock)
      ? activeBlock
      : blocks[blocks.length - 1];
    const focusIdx = Math.max(0, blocks.indexOf(focusBlock));
    const targetLi = list.children[focusIdx];
    if (targetLi instanceof HTMLElement) {
      placeCaretInBlock(targetLi, isLiEmpty(targetLi as HTMLLIElement));
    }
  };

  const continuePseudoListOnEnter = (block: HTMLElement, range: Range): boolean => {
    const match = getBlockPrefixMatch(block);
    if (!match || isNumberedPrefix(match)) return false;

    const contentText = (block.textContent ?? '').replace(BULLET_PREFIX_RE, '').trim();
    if (!contentText) {
      stripBulletPrefixFromBlock(block);
      return true;
    }

    if (isCaretAtEndOfBlock(block, range)) {
      const newBlock = document.createElement('div');
      newBlock.setAttribute('dir', 'auto');
      const prefix = nextPrefixFromMatch(match);
      const prefixNode = document.createTextNode(prefix);
      newBlock.appendChild(prefixNode);
      block.parentNode?.insertBefore(newBlock, block.nextSibling);
      const caretRange = document.createRange();
      caretRange.setStart(prefixNode, prefix.length);
      caretRange.collapse(true);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(caretRange);
      savedRange.current = caretRange.cloneRange();
      return true;
    }

    const tailRange = document.createRange();
    tailRange.setStart(range.endContainer, range.endOffset);
    tailRange.setEnd(block, block.childNodes.length);
    const tail = tailRange.extractContents();

    const newBlock = document.createElement('div');
    newBlock.setAttribute('dir', 'auto');
    const prefix = nextPrefixFromMatch(match);
    const prefixNode = document.createTextNode(prefix);
    newBlock.appendChild(prefixNode);
    const tailText = tail.textContent ?? '';
    if (tailText.trim()) {
      if (tail.childNodes.length === 1 && tail.firstChild?.nodeType === Node.TEXT_NODE) {
        newBlock.appendChild(document.createTextNode(tailText));
      } else {
        newBlock.appendChild(tail);
      }
    }

    block.parentNode?.insertBefore(newBlock, block.nextSibling);
    const caretRange = document.createRange();
    caretRange.setStart(prefixNode, prefix.length);
    caretRange.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(caretRange);
    savedRange.current = caretRange.cloneRange();
    return true;
  };

  const restoreListActionRange = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    ed.focus({ preventScroll: true });
    const frozen = listMenuRangeRef.current;
    listMenuRangeRef.current = null;
    const sel = window.getSelection();
    if (frozen && ed.contains(frozen.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(frozen);
      savedRange.current = frozen.cloneRange();
      return frozen.cloneRange();
    }
    restoreSel();
    return sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  };

  const applyList = (mode: 'bullet' | 'ordered' | 'none') => {
    const ed = editorRef.current;
    if (!ed) return;

    if (mode === 'none') {
      ed.focus({ preventScroll: true });
      const frozen = listMenuRangeRef.current;
      listMenuRangeRef.current = null;
      listMenuBlockRef.current = null;
      const sel = window.getSelection();
      if (frozen && ed.contains(frozen.commonAncestorContainer)) {
        sel?.removeAllRanges();
        sel?.addRange(frozen);
        savedRange.current = frozen.cloneRange();
      } else {
        restoreSel();
      }
      removeListFormatting();
      setListPalOpen(false);
      return;
    }

    const range = restoreListActionRange();
    if (!range) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const ordered = mode === 'ordered';
    const caretList = getListContainer(sel.anchorNode, ed);

    if (caretList) {
      const isOrdered = caretList.tagName === 'OL';
      if (isOrdered === ordered) {
        setListPalOpen(false);
        return;
      }
      const newList = document.createElement(ordered ? 'ol' : 'ul');
      newList.setAttribute('dir', 'auto');
      while (caretList.firstChild) newList.appendChild(caretList.firstChild);
      caretList.parentNode?.replaceChild(newList, caretList);
      saveSel();
      readCommandState();
      emitHtml();
      setListPalOpen(false);
      return;
    }

    const savedBlock = listMenuBlockRef.current;
    listMenuBlockRef.current = null;
    let activeBlock =
      savedBlock?.isConnected &&
      savedBlock !== ed &&
      savedBlock.tagName !== 'LI' &&
      !savedBlock.closest('li')
        ? savedBlock
        : isolateLineBlockForList(range, ed);
    if (!activeBlock || activeBlock === ed || activeBlock.tagName === 'LI' || activeBlock.closest('li')) {
      activeBlock = ensureBlockAtRange(ed, sel.getRangeAt(0));
    }
    convertBlocksToList([activeBlock], ordered, activeBlock);
    saveSel();
    readCommandState();
    emitHtml();
    setListPalOpen(false);
  };

  const removeListFormatting = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ensureFocus(true);
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);

    const lists = new Set<HTMLUListElement | HTMLOListElement>();
    ed.querySelectorAll('ul, ol').forEach((node) => {
      if (range.intersectsNode(node)) lists.add(node as HTMLUListElement | HTMLOListElement);
    });
    const caretList = getListContainer(sel.anchorNode, ed);
    if (caretList) lists.add(caretList);

    if (lists.size > 0) {
      [...lists].forEach((list) => unwrapList(list));
    } else {
      collectBlocksInRange(ed, range).forEach(stripBulletPrefixFromBlock);
    }

    saveSel();
    readCommandState();
    emitHtml();
  };

  const toggleList = (ordered: boolean) => {
    const ed = editorRef.current;
    if (!ed) return;
    const cmd = ordered ? 'insertOrderedList' : 'insertUnorderedList';
    const opposite = ordered ? 'insertUnorderedList' : 'insertOrderedList';
    ensureFocus(true);
    document.execCommand('styleWithCSS', false, 'true');
    try {
      if (document.queryCommandState(opposite)) document.execCommand(opposite, false);
    } catch { /* noop */ }
    document.execCommand(cmd, false);
    ed.querySelectorAll('ul, ol').forEach((list) => list.setAttribute('dir', 'auto'));
    saveSel();
    readCommandState();
    emitHtml();
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

  const placeCaretInBlock = (block: HTMLElement, atStart: boolean) => {
    const range = document.createRange();
    if (block.tagName === 'LI' && isLiEmpty(block as HTMLLIElement) && !block.querySelector('br')) {
      block.innerHTML = '<br>';
    }
    const br = block.querySelector(':scope > br');
    if (block.tagName === 'LI' && br && isLiEmpty(block as HTMLLIElement)) {
      range.setStartBefore(br);
      range.collapse(true);
    } else {
      range.selectNodeContents(block);
      range.collapse(atStart);
    }
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

    const edRect = ed.getBoundingClientRect();
    if (edRect.width <= 0) return;

    const relX = (x - edRect.left) / edRect.width;
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

  const applyImageMargins = (img: HTMLImageElement, align: BlockAlign) => {
    img.style.display = 'block';
    if (align === 'center') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = 'auto';
    } else if (align === 'right') {
      img.style.marginLeft = 'auto';
      img.style.marginRight = '0';
    } else {
      img.style.marginLeft = '0';
      img.style.marginRight = '0';
    }
  };

  const ensureStandaloneImageBlock = (img: HTMLImageElement, ed: HTMLElement): HTMLElement => {
    let block = getLineBlock(img, ed);
    if (!block || block === ed) {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('dir', 'auto');
      img.parentNode?.insertBefore(wrapper, img);
      wrapper.appendChild(img);
      if (img.nextSibling?.nodeName === 'BR') wrapper.appendChild(img.nextSibling);
      return wrapper;
    }
    const clone = block.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('img').forEach((node) => node.remove());
    const otherText = clone.textContent?.replace(/\u200B/g, '').trim() ?? '';
    if (!otherText) return block;
    const wrapper = document.createElement('div');
    wrapper.setAttribute('dir', 'auto');
    block.parentNode?.insertBefore(wrapper, block.nextSibling);
    wrapper.appendChild(img);
    if (wrapper.previousSibling === block && img.nextSibling?.nodeName === 'BR') wrapper.appendChild(img.nextSibling);
    return wrapper;
  };

  const applyImageAlignment = (img: HTMLImageElement, align: BlockAlign) => {
    const ed = editorRef.current;
    if (!ed) return;
    const frame = ensureImageFrame(img, ed);
    frame.style.display = 'block';
    frame.style.width = 'fit-content';
    frame.style.maxWidth = '100%';
    img.style.marginLeft = '0';
    img.style.marginRight = '0';
    if (align === 'center') {
      frame.style.marginLeft = 'auto';
      frame.style.marginRight = 'auto';
    } else if (align === 'right') {
      frame.style.marginLeft = 'auto';
      frame.style.marginRight = '0';
    } else {
      frame.style.marginLeft = '0';
      frame.style.marginRight = '0';
    }
    emitHtml();
    setHoveredImg(syncHoveredImg(img, frame));
  };

  const moveImageVertically = (img: HTMLImageElement, direction: 'up' | 'down') => {
    const ed = editorRef.current;
    if (!ed) return;
    const frame = ensureImageFrame(img, ed);
    const parent = frame.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    const idx = siblings.indexOf(frame);
    if (idx < 0) return;

    if (direction === 'up') {
      if (idx <= 0) return;
      parent.insertBefore(frame, siblings[idx - 1]);
    } else if (idx < siblings.length - 1) {
      parent.insertBefore(siblings[idx + 1], frame);
    } else {
      const tail = document.createElement('div');
      tail.setAttribute('dir', 'auto');
      tail.innerHTML = '<br>';
      parent.appendChild(tail);
    }

    const nextHtml = serializeEditorHtml(ed);
    lastLocalHtmlRef.current = nextHtml;
    onChange(nextHtml);
    requestAnimationFrame(() => {
      if (img.isConnected) setHoveredImg(syncHoveredImg(img, ensureImageFrame(img, ed)));
    });
  };

  const applyBlockAlignment = (align: BlockAlign) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });
    restoreSel();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    let block = getLineBlock(sel.anchorNode, ed);
    if (!block) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('formatBlock', false, 'div');
      block = getLineBlock(sel.anchorNode, ed);
    }
    if (!block) return;

    if (block.tagName === 'CENTER') block = normalizeCenterElement(block, ed);

    unwrapCenterTags(ed);
    if (align !== 'center') clearParentCentering(block, ed);

    ed.querySelectorAll<HTMLElement>('center, [align], [style*="text-align"]').forEach((el) => {
      if (!block.contains(el) && el !== block) return;
      el.style.removeProperty('text-align');
      el.removeAttribute('align');
      if (align !== 'center') {
        el.style.removeProperty('margin-left');
        el.style.removeProperty('margin-right');
        el.style.removeProperty('width');
        el.style.removeProperty('max-width');
        if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
      }
    });

    block.style.display = 'block';
    block.style.width = '100%';
    block.style.textAlign = align;
    block.style.marginLeft = '0';
    block.style.marginRight = '0';
    block.removeAttribute('align');

    block.querySelectorAll('img').forEach((img) => applyImageMargins(img, align));

    if (align === 'left') placeCaretInBlock(block, true);

    saveSel();
    readCommandState();
    emitHtml();
    ed.focus({ preventScroll: true });
  };

  const normalizeEmptyFontBlocks = (ed: HTMLElement) => {
    ed.querySelectorAll<HTMLElement>('div, p').forEach((block) => {
      if (block.closest('li, ul, ol')) return;
      block.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
        const text = span.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (!text && !span.querySelector('img')) span.remove();
      });
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      // Blocks that hold an image have no text but must not be wiped.
      if (!text && !block.querySelector('img')) {
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
      if (text || block.querySelector('img')) continue;
      const prevText = topBlocks[i - 1].textContent?.replace(/\u200B/g, '').trim() ?? '';
      const nextText = topBlocks[i + 1].textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (prevText && nextText) block.remove();
    }
  };

  const insertTabIndent = (ed: HTMLElement) => {
    ed.focus({ preventScroll: true });

    const sel = window.getSelection();
    if (!sel) return;

    let range = liveRange();
    if (!range) {
      range = document.createRange();
      if (ed.childNodes.length === 0) range.setStart(ed, 0);
      else {
        range.selectNodeContents(ed);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand('styleWithCSS', false, 'true');
    if (document.execCommand('insertText', false, TAB_INDENT)) {
      saveSel();
      emitHtml();
      return;
    }

    range = sel.getRangeAt(0);
    range.deleteContents();
    const text = document.createTextNode(TAB_INDENT);
    range.insertNode(text);
    range.setStartAfter(text);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange.current = range.cloneRange();
    emitHtml();
  };

  const insertTabIndentRef = useRef(insertTabIndent);
  insertTabIndentRef.current = insertTabIndent;

  const resetBlockToLeft = (block: HTMLElement) => {
    block.style.display = 'block';
    block.style.width = '100%';
    block.style.textAlign = 'left';
    block.style.marginLeft = '0';
    block.style.marginRight = '0';
    block.removeAttribute('align');
  };

  const splitAlignedBlockAtCaret = (ed: HTMLElement): HTMLElement | null => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const block = getLineBlock(range.startContainer, ed);
    if (!block || readBlockAlignment(block) === 'left') return block;

    const tail = document.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(block, block.childNodes.length);
    const tailContents = tail.extractContents();
    const tailHasContent =
      (tailContents.textContent?.replace(/\u200B/g, '').trim() ?? '').length > 0
      || tailContents.querySelector('br');

    const newBlock = document.createElement('div');
    newBlock.setAttribute('dir', 'auto');
    resetBlockToLeft(newBlock);

    if (tailHasContent || tailContents.querySelector?.('img')) newBlock.appendChild(tailContents);
    else newBlock.innerHTML = '<br>';

    block.parentNode?.insertBefore(newBlock, block.nextSibling);
    if (!block.textContent?.replace(/\u200B/g, '').trim() && !block.querySelector('img')) block.innerHTML = '<br>';

    placeCaretInBlock(newBlock, true);
    return newBlock;
  };

  const caretFollowsLineBreakInBlock = (block: HTMLElement, range: Range): boolean => {
    const pre = document.createRange();
    pre.selectNodeContents(block);
    pre.setEnd(range.startContainer, range.startOffset);
    return !!pre.cloneContents().querySelector('br');
  };

  const createLeftLineFromCaret = (block: HTMLElement, range: Range): HTMLElement => {
    const newBlock = document.createElement('div');
    newBlock.setAttribute('dir', 'auto');
    resetBlockToLeft(newBlock);

    const tail = document.createRange();
    tail.setStart(range.endContainer, range.endOffset);
    tail.setEnd(block, block.childNodes.length);
    const tailContents = tail.extractContents();
    const tailHasContent =
      (tailContents.textContent?.replace(/\u200B/g, '').trim() ?? '').length > 0
      || tailContents.querySelector('br');

    if (tailHasContent || tailContents.querySelector?.('img')) newBlock.appendChild(tailContents);
    else newBlock.innerHTML = '<br>';

    block.parentNode?.insertBefore(newBlock, block.nextSibling);
    if (!block.textContent?.replace(/\u200B/g, '').trim() && !block.querySelector('img')) block.innerHTML = '<br>';
    placeCaretInBlock(newBlock, true);
    return newBlock;
  };

  /** Keep the caret on a left-aligned line when moving below centered/right text. */
  const ensureCaretOnOwnLeftLine = (ed: HTMLElement): boolean => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const block = getLineBlock(range.startContainer, ed);
    if (!block) return false;

    const align = readBlockAlignment(block);
    const blockText = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
    const prev = block.previousElementSibling;
    const afterAlignedLine =
      prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName) && readBlockAlignment(prev) !== 'left';

    if (align !== 'left' && caretFollowsLineBreakInBlock(block, range)) {
      splitAlignedBlockAtCaret(ed);
      return true;
    }

    if (align !== 'left' && afterAlignedLine) {
      resetBlockToLeft(block);
      if (!blockText) placeCaretInBlock(block, true);
      return true;
    }

    if (align !== 'left' && !blockText) {
      resetBlockToLeft(block);
      placeCaretInBlock(block, true);
      return true;
    }

    if (align === 'left' && afterAlignedLine && !blockText) {
      placeCaretInBlock(block, true);
      return true;
    }

    return false;
  };

  const finishNewLineEditing = (ed: HTMLElement, opts?: { inList?: boolean }) => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const inList = opts?.inList ?? !!getListContainer(sel.anchorNode, ed);
    const block = getBlockParent(sel.anchorNode, ed);
    if (block && block.tagName !== 'LI' && !block.closest('li, ul, ol')) {
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (!text && !block.querySelector('img')) {
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

    if (!inList) normalizeEmptyFontBlocks(ed);
    stripEmptyFontSpans(ed);
    pendingFontSize.current = null;
    setFontSize(DEFAULT_FONT_PX);
    saveSel();
    readCommandState();
    emitHtml();
  };

  const handleEditorEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const ed = editorRef.current;
    if (!ed) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    let range = sel.getRangeAt(0);

    const lineBlock = getLineBlock(sel.anchorNode, ed);
    if (lineBlock && lineBlock.tagName !== 'LI' && !lineBlock.closest('li')) {
      const prefix = getBlockPrefixMatch(lineBlock);
      if (prefix && isNumberedPrefix(prefix)) {
        convertBlocksToList([lineBlock], true, lineBlock);
        if (sel.rangeCount) range = sel.getRangeAt(0);
      }
    }

    const li = resolveListItemAtSelection(range, ed);
    if (li) {
      e.preventDefault();
      if (isLiEmpty(li)) {
        handleEmptyListItemEnter(li);
      } else if (isCaretAtEffectiveEndOfLi(li, range)) {
        insertNewListItemAfter(li);
      } else if (isCaretAtStartOfLi(li, range)) {
        splitListItemAtStart(li);
      } else {
        splitListItemAtCaret(li, range);
      }
      finishNewLineEditing(ed, { inList: true });
      return;
    }

    const block = getLineBlock(sel.anchorNode, ed);
    if (block && continuePseudoListOnEnter(block, sel.getRangeAt(0))) {
      e.preventDefault();
      finishNewLineEditing(ed);
      return;
    }

    const orphanList = getListContainer(sel.anchorNode, ed);
    if (orphanList) {
      e.preventDefault();
      const items = Array.from(orphanList.children).filter((n): n is HTMLLIElement => n.tagName === 'LI');
      const target = items[items.length - 1];
      if (target) {
        if (isLiEmpty(target)) handleEmptyListItemEnter(target);
        else insertNewListItemAfter(target);
      }
      finishNewLineEditing(ed, { inList: true });
      return;
    }

    e.preventDefault();

    clearPendingFontMarker();

    if (block && readBlockAlignment(block) !== 'left') {
      createLeftLineFromCaret(block, range);
      finishNewLineEditing(ed);
      return;
    }

    document.execCommand('insertParagraph');

    requestAnimationFrame(() => {
      ensureCaretOnOwnLeftLine(ed);
      finishNewLineEditing(ed);
    });
  };

  const handleEditorBackspace = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Backspace' || e.nativeEvent.isComposing) return;
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const li = resolveListItemAtSelection(range, ed);
    if (li) {
      const atStart = isCaretAtStartOfLi(li, range);

      if (isLiEmpty(li)) {
        e.preventDefault();
        if (isNestedListItem(li)) returnToParentListItem(li);
        else exitListItem(li, ed, true);
        saveSel();
        readCommandState();
        emitHtml();
        return;
      }

      if (atStart) {
        e.preventDefault();
        if (isNestedListItem(li)) returnToParentListItem(li);
        else if (!mergeListItemWithPrevious(li)) exitListItem(li, ed, true);
        saveSel();
        readCommandState();
        emitHtml();
      }
      return;
    }

    const block = getLineBlock(range.startContainer, ed);
    if (block && block.tagName !== 'LI' && !block.closest('li') && isCaretAtStartOfBlock(block, range) && getBlockPrefixMatch(block)) {
      e.preventDefault();
      stripBulletPrefixFromBlock(block);
      saveSel();
      readCommandState();
      emitHtml();
    }
  };

  // ── Initial content ───────────────────────────────────────────────────
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
      normalizeEditorImages(editorRef.current);
      lastLocalHtmlRef.current = editorRef.current.innerHTML;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    // A different html prop than last render means the parent deliberately set new
    // content (e.g. the "Paste note" button) — always honor it below.
    const propChanged = html !== lastPropHtmlRef.current;
    lastPropHtmlRef.current = html;
    const active = document.activeElement;
    if (active && editorWrapRef.current?.contains(active)) return;
    if (ed.innerHTML === html) {
      lastLocalHtmlRef.current = html;
      return;
    }
    // Skip only stale echoes of our own edits; deliberate parent updates still apply.
    if (!propChanged && ed.innerHTML === lastLocalHtmlRef.current && html !== lastLocalHtmlRef.current) return;
    hideImageToolbar();
    ed.innerHTML = html;
    normalizeEditorImages(ed);
    lastLocalHtmlRef.current = ed.innerHTML;
  }, [html]);

  // ── Command state ─────────────────────────────────────────────────────
  const readCommandState = () => {
    const active = new Set<string>();
    TOGGLE_COMMANDS.forEach((c) => {
      try { if (document.queryCommandState(c)) active.add(c); } catch { /* noop */ }
    });
    try { if (document.queryCommandState('insertUnorderedList')) active.add('insertUnorderedList'); } catch { /* noop */ }
    try { if (document.queryCommandState('insertOrderedList')) active.add('insertOrderedList'); } catch { /* noop */ }
    const ed = editorRef.current;
    const sel = window.getSelection();
    if (ed && sel?.rangeCount) {
      const list = getListContainer(sel.anchorNode, ed);
      if (list?.tagName === 'UL') {
        active.delete('insertOrderedList');
        active.add('insertUnorderedList');
      } else if (list?.tagName === 'OL') {
        active.delete('insertUnorderedList');
        active.add('insertOrderedList');
      }
      const li = resolveListItemAtSelection(sel.getRangeAt(0), ed);
      if (li) {
        active.add('inListItem');
        if (isNestedListItem(li) || li.querySelector(':scope > ul, :scope > ol')) active.add('nestedList');
        if (canIndentListItem(li)) active.add('canIndentList');
        if (canOutdentListItem(li)) active.add('canOutdentList');
      }
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
      if (selectionRafRef.current !== null) return;
      selectionRafRef.current = requestAnimationFrame(() => {
        selectionRafRef.current = null;
        const ed = editorRef.current;
        if (!ed) return;
        const focusedInEditor = document.activeElement === ed || ed.contains(document.activeElement);
        const sel = window.getSelection();
        const selInEd = sel?.rangeCount && ed.contains(sel.getRangeAt(0).commonAncestorContainer);
        const savedInEd = savedRange.current && ed.contains(savedRange.current.commonAncestorContainer);
        if (focusedInEditor || selInEd || savedInEd) {
          saveSel();
          readCommandState();
          syncFontSizeFromCaret();
        }
      });
    };
    document.addEventListener('selectionchange', handler);
    return () => {
      document.removeEventListener('selectionchange', handler);
      if (selectionRafRef.current !== null) cancelAnimationFrame(selectionRafRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    if (inputCleanupRafRef.current !== null) cancelAnimationFrame(inputCleanupRafRef.current);
    if (hoverMoveRafRef.current !== null) cancelAnimationFrame(hoverMoveRafRef.current);
  }, []);

  useEffect(() => {
    if (!editable) return;
    const onDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const ed = editorRef.current;
      if (!ed || document.activeElement !== ed) return;
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const li = resolveListItemAtSelection(sel.getRangeAt(0), ed);
        if (li) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.shiftKey) {
            if (isNestedListItem(li)) returnToParentListItem(li);
            else outdentListItem(li);
          } else indentListItem(li);
          saveSel();
          readCommandState();
          emitHtml();
          return;
        }
      }
      if (e.shiftKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      insertTabIndentRef.current(ed);
    };
    document.addEventListener('keydown', onDocKeyDown, true);
    return () => document.removeEventListener('keydown', onDocKeyDown, true);
  }, [editable]);

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
    emitHtml();
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
    emitHtml();
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
      emitHtml();
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
    emitHtml();
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
  const positionPalette = (btn: HTMLElement, setPos: (p: { left: number; top: number }) => void) => {
    const rect = btn.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 8 });
  };

  const togglePalette = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    saveSel();
    const opening = !palOpen;
    if (opening) {
      positionPalette(e.currentTarget as HTMLElement, setPalPos);
      setHlPalOpen(false);
      setListPalOpen(false);
    }
    setPalOpen(opening);
  };

  const applyColor = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBarColor(c);
    // Prefer the live/saved non-collapsed selection so colouring reliably hits the text.
    resolveFormatRange();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, c);
    saveSel();
    setPalOpen(false);
    emitHtml();
  };

  // Remove explicit text color so the text follows the theme (white in dark, dark in light).
  const clearTextColor = () => {
    const ed = editorRef.current;
    if (!ed) return;
    resolveFormatRange();
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
    emitHtml();
  };

  const toggleHlPalette = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    saveSel();
    const opening = !hlPalOpen;
    if (opening) {
      positionPalette(e.currentTarget as HTMLElement, setHlPalPos);
      setPalOpen(false);
      setListPalOpen(false);
    }
    setHlPalOpen(opening);
  };

  const toggleListMenu = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    saveSel();
    const ed = editorRef.current;
    const opening = !listPalOpen;
    if (opening) {
      const r = liveRange() ?? savedRange.current;
      listMenuRangeRef.current = r ? r.cloneRange() : null;
      listMenuBlockRef.current = r && ed ? resolveBlockAtRange(r, ed) : null;
      positionPalette(e.currentTarget as HTMLElement, setListPalPos);
      setPalOpen(false);
      setHlPalOpen(false);
    } else {
      listMenuRangeRef.current = null;
      listMenuBlockRef.current = null;
    }
    setListPalOpen(opening);
  };

  const applyHighlight = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setHlColor(c);
    resolveFormatRange();
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
    emitHtml();
  };

  // ── Image ─────────────────────────────────────────────────────────────
  const insertImage = (file: File) => {
    const ed = editorRef.current;
    if (!ed || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      ensureFocus(true);
      document.execCommand('insertHTML', false, `<div class="${NOTE_IMG_FRAME}" contenteditable="false" dir="auto"><img src="${url}" loading="lazy" decoding="async" style="display:block;max-width:160px;max-height:160px;height:auto;cursor:zoom-in;" /></div><br>`);
      normalizeEditorImages(ed);
      saveSel();
      emitHtml();
    };
    reader.readAsDataURL(file);
  };

  // ── Image resize: drag a handle to grow/shrink (corner keeps ratio) ────
  const applyImageSize = (img: HTMLImageElement, mode: 'both' | 'width' | 'height', startWidth: number, startHeight: number, ratio: number, maxW: number, dx: number, dy: number) => {
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    if (mode === 'height') {
      img.style.width = `${Math.round(startWidth)}px`;
      img.style.height = `${Math.max(40, Math.round(startHeight + dy))}px`;
    } else if (mode === 'width') {
      const w = Math.min(maxW, Math.max(60, Math.round(startWidth + dx)));
      img.style.width = `${w}px`;
      img.style.height = `${Math.round(startHeight)}px`;
      img.style.objectFit = 'fill';
    } else {
      const w = Math.min(maxW, Math.max(60, Math.round(startWidth + dx)));
      img.style.width = `${w}px`;
      img.style.height = `${Math.round(w * ratio)}px`;
    }
  };

  const startImageResize = (e: React.PointerEvent, img: HTMLImageElement, mode: 'both' | 'width' | 'height') => {
    e.preventDefault();
    e.stopPropagation();
    const ed = editorRef.current;
    if (!ed) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    isResizingImg.current = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = img.getBoundingClientRect();
    const startWidth = rect.width;
    const startHeight = rect.height;
    const ratio = startHeight / (startWidth || 1);
    const maxW = Math.max(120, ed.clientWidth - 32);
    let resizeStarted = false;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!resizeStarted) {
        if (Math.hypot(dx, dy) < 4) return;
        resizeStarted = true;
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
      }
      ev.preventDefault();
      applyImageSize(img, mode, startWidth, startHeight, ratio, maxW, dx, dy);
      const frame = ensureImageFrame(img, ed);
      setHoveredImg(syncHoveredImg(img, frame));
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      isResizingImg.current = false;
      if (resizeStarted) {
        const frame = ensureImageFrame(img, ed);
        setHoveredImg(syncHoveredImg(img, frame));
        emitHtml();
      }
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  // ── Divider: underline the current line + start a new paragraph below ──
  const insertDivider = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ensureFocus(true);
    document.execCommand('insertHTML', false, '<hr style="border:0;border-top:1px solid currentColor;opacity:0.3;margin:10px 0" /><div dir="auto"><br></div>');
    saveSel();
    emitHtml();
  };

  const formatTodayHeaderLabel = () => new Date().toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const insertTodayHeader = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus({ preventScroll: true });

    const dateLabel = formatTodayHeaderLabel();
    const header = document.createElement('div');
    header.setAttribute('dir', 'auto');
    header.style.fontWeight = '700';
    header.style.fontSize = '18px';
    header.style.lineHeight = FONT_LINE_HEIGHT;
    header.style.margin = '0 0 8px';
    header.textContent = dateLabel;

    const isEmpty = !ed.textContent?.replace(/\u200B/g, '').trim();
    if (isEmpty) {
      ed.innerHTML = '';
      ed.appendChild(header);
      const body = document.createElement('div');
      body.setAttribute('dir', 'auto');
      body.innerHTML = '<br>';
      ed.appendChild(body);
      placeCaretInBlock(body, true);
    } else {
      ed.insertBefore(header, ed.firstChild);
      const range = document.createRange();
      const firstContent = header.nextSibling;
      if (firstContent) {
        range.setStartBefore(firstContent);
        range.collapse(true);
      } else {
        range.selectNodeContents(ed);
        range.collapse(false);
      }
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRange.current = range.cloneRange();
    }

    saveSel();
    readCommandState();
    emitHtml();
  };

  // ── Close palette on outside click / scroll ─────────────────────────────
  // Palettes are portaled to document.body so fixed coords match the viewport
  // (backdrop-blur on the sticky toolbar otherwise breaks position:fixed).
  useEffect(() => {
    if (!palOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (colorWrapRef.current?.contains(t) || colorPalRef.current?.contains(t)) return;
      setPalOpen(false);
    };
    const closeAll = () => setPalOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [palOpen]);

  useEffect(() => {
    if (!hlPalOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (hlWrapRef.current?.contains(t) || hlPalRef.current?.contains(t)) return;
      setHlPalOpen(false);
    };
    const closeAll = () => setHlPalOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [hlPalOpen]);

  useEffect(() => {
    if (!listPalOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listWrapRef.current?.contains(t) || listPalRef.current?.contains(t)) return;
      listMenuRangeRef.current = null;
      listMenuBlockRef.current = null;
      setListPalOpen(false);
    };
    const closeAll = () => {
      listMenuRangeRef.current = null;
      listMenuBlockRef.current = null;
      setListPalOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [listPalOpen]);

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

  const flexToolbar = stickyToolbar && editable;
  const scrollableContent = flexToolbar || resizable || !!maxHeight;

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div ref={editorWrapRef} className={'relative ' + (flexToolbar ? 'flex min-h-0 flex-col ' : '') + (editable ? '' : '[&_.note-img-frame]:mx-auto [&_.note-img-frame]:cursor-zoom-in [&_img]:mx-auto [&_img]:block [&_img]:h-auto [&_img]:max-h-[280px] [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:object-contain')}>
      {/* Toolbar */}
      <div
        className={
          'flex flex-wrap items-center gap-0.5 border-b border-app-border bg-app-bg px-3 py-1.5 dark:border-white/10 dark:bg-white/5 ' +
          (flexToolbar ? 'z-30 flex-shrink-0 ' : '') +
          (flexToolbar ? 'sticky top-0 bg-app-bg/95 shadow-sm backdrop-blur-sm dark:bg-gray-900/95' : '')
        }
        style={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.4 }}
        onMouseDownCapture={() => {
          saveSel();
        }}
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
        </div>

        {/* Highlight */}
        <div ref={hlWrapRef} className="relative">
          <button type="button" onMouseDown={toggleHlPalette} title="Highlight" className="flex h-7 w-7 flex-col items-center justify-center gap-0.5 rounded-md hover:bg-white dark:hover:bg-white/10">
            <span className="text-xs font-bold leading-none" style={{ WebkitTextStroke: '0.5px #555' }}>A</span>
            <span className="h-[3px] w-4 rounded-sm" style={{ background: hlColor }} />
          </button>
        </div>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* B I U S */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Alignment */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('left'); }} title={t.titleLeft} className={btnCls(activeCmds.has('justifyLeft'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('center'); }} title={t.titleCenter} className={btnCls(activeCmds.has('justifyCenter'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); saveSel(); applyBlockAlignment('right'); }} title={t.titleRight} className={btnCls(activeCmds.has('justifyRight'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="9" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="9" y="20" width="12" height="2" rx="1"/></svg>
        </button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Lists — one menu */}
        <div ref={listWrapRef} className="relative flex items-center gap-0.5">
          <button
            type="button"
            onMouseDown={toggleListMenu}
            title={t.titleBulletList}
            className={btnCls(activeCmds.has('insertUnorderedList') || activeCmds.has('insertOrderedList'))}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="6" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="5" cy="18" r="1.5"/><rect x="9" y="5" width="12" height="2" rx="1"/><rect x="9" y="11" width="12" height="2" rx="1"/><rect x="9" y="17" width="12" height="2" rx="1"/></svg>
          </button>
          {(activeCmds.has('insertUnorderedList') || activeCmds.has('insertOrderedList')) && (
            <>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSel(); applySubList(); }}
                title={t.titleSubList}
                className={
                  'flex h-7 w-7 items-center justify-center rounded-md ' +
                  (activeCmds.has('nestedList')
                    ? 'bg-primary text-white'
                    : 'text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10')
                }
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="4" cy="6" r="1.4" />
                  <circle cx="4" cy="12" r="1.4" />
                  <rect x="8" y="5" width="12" height="2" rx="1" />
                  <rect x="8" y="11" width="12" height="2" rx="1" />
                  <circle cx="10" cy="18" r="1.4" />
                  <rect x="14" y="17" width="8" height="2" rx="1" />
                </svg>
              </button>
              {activeCmds.has('canOutdentList') && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); saveSel(); applyOutdentSubList(); }}
                  title={t.titleOutdentSubList}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="4" cy="6" r="1.4" />
                    <circle cx="4" cy="12" r="1.4" />
                    <rect x="8" y="5" width="12" height="2" rx="1" />
                    <rect x="8" y="11" width="12" height="2" rx="1" />
                    <circle cx="4" cy="18" r="1.4" />
                    <rect x="8" y="17" width="12" height="2" rx="1" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Today's date header */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); saveSel(); insertTodayHeader(); }}
          title={t.titleInsertDateHeader}
          className={btnCls(false)}
        >
          📅
        </button>

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
        onMouseUp={() => {
          const ed = editorRef.current;
          if (ed && ensureCaretOnOwnLeftLine(ed)) finishNewLineEditing(ed);
        }}
        onFocus={() => {
          const ed = editorRef.current;
          if (ed) sanitizeCaretFontContext(ed);
        }}
        onBlur={() => { hideImageToolbar(); flushEmitHtml(); }}
        onScroll={() => {
          if (hoveredImg?.el.isConnected) {
            setHoveredImg(syncHoveredImg(hoveredImg.el, hoveredImg.frame));
          } else if (hoveredImg) {
            hideImageToolbar();
          }
        }}
        onKeyDown={(e) => {
          if (NAV_KEYS.has(e.key)) clearPendingFontMarker();
          handleEditorBackspace(e);
          handleEditorEnter(e);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            requestAnimationFrame(() => {
              const ed = editorRef.current;
              if (ed && ensureCaretOnOwnLeftLine(ed)) finishNewLineEditing(ed);
            });
          }
        }}
        onInput={() => {
          emitHtml();
          if (inputCleanupRafRef.current !== null) return;
          inputCleanupRafRef.current = requestAnimationFrame(() => {
            inputCleanupRafRef.current = null;
            const live = editorRef.current;
            if (!live) return;
            live.childNodes.forEach((node) => {
              if (node instanceof HTMLElement && !node.hasAttribute('dir')) {
                node.setAttribute('dir', 'auto');
              }
            });
            live.querySelectorAll('ul, ol').forEach((list) => list.setAttribute('dir', 'auto'));
            stripEmptyFontSpans(live);
          });
        }}
        onPaste={() => {
          requestAnimationFrame(() => {
            const live = editorRef.current;
            if (!live) return;
            live.querySelectorAll('ul, ol').forEach((list) => list.setAttribute('dir', 'auto'));
            emitHtml();
          });
        }}
        onMouseMove={handleEditorMouseMove}
        onMouseLeave={(e) => {
          if (isResizingImg.current || imgResizeMode) return;
          const rt = e.relatedTarget;
          if (rt instanceof Node && editorRef.current?.contains(rt)) return;
          hideImageToolbar();
        }}
        onClick={(event) => {
          if (!editable && event.detail >= 3) { event.preventDefault(); onLockedTripleClick?.(); return; }
          if (isResizingImg.current) return;
          const img = resolveNoteImage(event.target);
          if (img) {
            setPreviewImage(img.currentSrc || img.src);
            setPreviewZoom(1);
            naturalSizeRef.current = null;
            setImgResizeMode(false);
          } else if (editable) {
            setHoveredImg(null);
            setImgResizeMode(false);
          }
        }}
        suppressContentEditableWarning
        className={(scrollableContent ? 'min-h-0 flex-1 overflow-y-auto ' : '') + 'px-4 py-3 leading-normal text-app-text outline-none dark:text-gray-100 [&_div]:my-0 [&_p]:my-0 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li>ul]:mt-0.5 [&_li>ol]:mt-0.5 [&_.note-img-frame]:my-2 [&_.note-img-frame]:block [&_.note-img-frame]:w-fit [&_.note-img-frame]:max-w-full [&_.note-img-frame]:overflow-hidden [&_.note-img-frame]:rounded-xl [&_.note-img-frame]:border [&_.note-img-frame]:border-app-border/50 [&_.note-img-frame]:bg-app-bg/20 [&_.note-img-frame--active]:border-primary/45 [&_.note-img-frame--active]:shadow-sm dark:[&_.note-img-frame]:border-white/12 dark:[&_.note-img-frame]:bg-gray-900/30 dark:[&_.note-img-frame--active]:border-primary/35 [&_.note-img-frame_img]:block [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:object-contain' + (resizable && editable ? ' resize-y' : '')}
        style={{ minHeight, maxHeight: resizable ? undefined : maxHeight, fontSize: `${DEFAULT_FONT_PX}px`, lineHeight: FONT_LINE_HEIGHT, cursor: editable ? 'text' : 'default' }}
      />

      {/* Color / highlight palettes — portaled to body (see comment above useEffects) */}
      {palOpen && createPortal(
        <div
          ref={colorPalRef}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="fixed z-[9999] grid w-[184px] grid-cols-6 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
          style={{ left: palPos.left, top: palPos.top }}
        >
          {COLORS.map((c) => (
            <div key={c} onMouseDown={(e) => { e.preventDefault(); applyColor(c); }} className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125" style={{ background: c }} />
          ))}
          <div onMouseDown={(e) => { e.preventDefault(); clearTextColor(); }} className="col-span-6 mt-0.5 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5">✕ Standardfärg (auto)</div>
        </div>,
        document.body,
      )}

      {hlPalOpen && createPortal(
        <div
          ref={hlPalRef}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="fixed z-[9999] grid w-[164px] grid-cols-5 gap-1.5 rounded-xl border border-app-border bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-gray-800"
          style={{ left: hlPalPos.left, top: hlPalPos.top }}
        >
          {HIGHLIGHT_COLORS.map((c) => (
            <div key={c} onMouseDown={(e) => { e.preventDefault(); applyHighlight(c); }} className="h-6 w-6 cursor-pointer rounded-md border border-black/10 transition-transform hover:scale-125" style={{ background: c }} />
          ))}
          <div onMouseDown={(e) => { e.preventDefault(); applyHighlight('transparent'); }} className="col-span-5 mt-0.5 flex cursor-pointer items-center justify-center gap-1 rounded-md border border-app-border py-1 text-[11px] text-app-text-secondary hover:bg-app-bg dark:border-white/10 dark:hover:bg-white/5">✕ Ta bort markering</div>
        </div>,
        document.body,
      )}

      {listPalOpen && createPortal(
        <div
          ref={listPalRef}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          className="fixed z-[9999] min-w-[168px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800"
          style={{ left: listPalPos.left, top: listPalPos.top }}
        >
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applyList('bullet'); }}
            className={'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-app-bg dark:hover:bg-white/5 ' + (activeCmds.has('insertUnorderedList') ? 'font-semibold text-primary' : 'text-app-text dark:text-gray-100')}
          >
            <span className="w-4 text-center">•</span>
            <span>{t.titleBulletList}</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applyList('ordered'); }}
            className={'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-app-bg dark:hover:bg-white/5 ' + (activeCmds.has('insertOrderedList') ? 'font-semibold text-primary' : 'text-app-text dark:text-gray-100')}
          >
            <span className="w-4 text-center text-[11px] font-bold">1.</span>
            <span>{t.titleNumberedList}</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applySubList(); }}
            className={'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-app-bg dark:hover:bg-white/5 ' + (activeCmds.has('nestedList') ? 'font-semibold text-primary' : 'text-app-text dark:text-gray-100')}
          >
            <span className="w-4 text-center text-[10px] leading-none">↳</span>
            <span>{t.titleSubList}</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); applyOutdentSubList(); }}
            className={'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-app-bg dark:hover:bg-white/5 ' + (activeCmds.has('canOutdentList') ? 'font-semibold text-primary' : 'text-app-text-secondary dark:text-gray-300')}
          >
            <span className="w-4 text-center text-[10px] leading-none">↰</span>
            <span>{t.titleOutdentSubList}</span>
          </button>
        </div>,
        document.body,
      )}

      {/* Image toolbar — portaled inside the image frame */}
      {editable && hoveredImg && createPortal((() => {
        const imgBtn = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] text-app-text hover:bg-primary/10 dark:text-gray-100';
        return (
          <div
            className={`${NOTE_IMG_TOOLBAR} flex w-full flex-nowrap items-center justify-center gap-0.5 overflow-x-auto border-t border-app-border/60 bg-white/96 px-1 py-1 dark:border-white/10 dark:bg-gray-900/96`}
            onMouseDown={(e) => e.preventDefault()}
          >
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); applyImageAlignment(hoveredImg.el, 'left'); }} className={imgBtn} title={t.titleLeft}>⬅</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); applyImageAlignment(hoveredImg.el, 'center'); }} className={imgBtn} title={t.titleCenter}>⊞</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); applyImageAlignment(hoveredImg.el, 'right'); }} className={imgBtn} title={t.titleRight}>➡</button>
            <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-app-border/60 dark:bg-white/12" />
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveImageVertically(hoveredImg.el, 'up'); }} className={imgBtn} title={t.titleMoveImageUp}>↑</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveImageVertically(hoveredImg.el, 'down'); }} className={imgBtn} title={t.titleMoveImageDown}>↓</button>
            <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-app-border/60 dark:bg-white/12" />
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewImage(hoveredImg.el.currentSrc || hoveredImg.el.src); setPreviewZoom(1); naturalSizeRef.current = null; setImgResizeMode(false); }} className={imgBtn} title="Zoom">🔍</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImgResizeMode((v) => !v); }} className={imgBtn + (imgResizeMode ? ' bg-primary/15 text-primary' : '')} title={t.titleResizeImage}>↔</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeImageBlock(hoveredImg.el); hideImageToolbar(); emitHtml(); }} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15" title="Delete">✕</button>
          </div>
        );
      })(), hoveredImg.host)}

      {/* Image resize handles — only after tapping ↔ (avoids accidental resize when viewing) */}
      {editable && hoveredImg && imgResizeMode && (() => {
        const r = hoveredImg.rect;
        const keep = () => { setHoveredImg(syncHoveredImg(hoveredImg.el, hoveredImg.frame)); };
        const leave = () => { if (!isResizingImg.current) hideImageToolbar(); };
        const base = 'flex items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-lg';
        return (
          <>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'width')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeWidth}
              style={{ position: 'fixed', left: r.right - 11, top: r.top + r.height / 2 - 11, zIndex: 9999, cursor: 'ew-resize', touchAction: 'none' }}
              className={base + ' h-[22px] w-[22px]'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 7 L4 12 L9 17 M15 7 L20 12 L15 17" />
              </svg>
            </div>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'height')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeHeight}
              style={{ position: 'fixed', left: r.left + r.width / 2 - 11, top: r.bottom - 11, zIndex: 9999, cursor: 'ns-resize', touchAction: 'none' }}
              className={base + ' h-[22px] w-[22px]'}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 9 L12 4 L17 9 M7 15 L12 20 L17 15" />
              </svg>
            </div>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'both')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeImage}
              style={{ position: 'fixed', left: r.right - 12, top: r.bottom - 12, zIndex: 10000, cursor: 'nwse-resize', touchAction: 'none' }}
              className={base + ' h-[22px] w-[22px]'}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10 3 L3 10" />
                <path d="M10 7.5 L7.5 10" />
              </svg>
            </div>
          </>
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
