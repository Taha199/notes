import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { NOTE_IMG_FRAME, NOTE_IMG_TOOLBAR, NOTE_IMG_TOOLBAR_HOST, resolveNoteImage } from '../../lib/noteImage';
import { compressImageForInline } from '../../lib/imageCompress';
import { emitEditorImageSwap, uploadEditorImage } from '../../lib/imageUpload';
import { auth } from '../../lib/firebase';
import {
  extractYouTubeVideoId,
  ensureYouTubeEmbedCaretSiblingsIn,
  insertYouTubeEmbedAtRange,
  normalizeYouTubeEmbeds,
  placeCaretAroundYouTubeEmbed,
  removeYouTubeEmbed,
  NOTE_YT_FRAME,
  NOTE_YT_REMOVE,
} from '../../lib/youtubeEmbed';
import { insertAutoLinkAtRange, isPlainUrl, normalizeAutoLinks } from '../../lib/autoLink';
import { buildEmptyTableHtml, extractTableHtmlFromClipboard, normalizeTablesInEditor, plainTextToTableHtml, resolveTableContext, resolveTableContextAt, placeCaretInTableCell, addTableRow, removeTableRow, addTableColumn, removeTableColumn, adjustTableColumnWidth, getTableColumnWidths, hitTableColumnResize, resizeAdjacentTableColumns, TABLE_COLUMN_WIDTH_STEP, deleteTable, ensureTableWrapStructure, getTableToolbarHost, setActiveTableWrap, NOTE_TABLE_CLASS, NOTE_TABLE_WRAP, NOTE_TABLE_TOOLBAR_HOST, NOTE_TABLE_BODY, NOTE_TABLE_COL_RESIZE_HOVER, NOTE_TABLE_COL_RESIZING, type TableCellContext, type TableColumnResizeHit, type TableEditPosition } from '../../lib/noteTable';
import {
  closestTableCell,
  collectFormatTargetRanges as collectFormatTargetRangesFromLib,
  collectTableCellsInRange,
  intersectRangeWithCellContents,
  rangeNeedsPerCellFormat,
} from '../../lib/tableCellFormat';
import {
  BULLET_PREFIX_RE,
  blockHasLeftoverIndent,
  clipboardToNormalizedHtml,
  convertListItemToParagraph,
  convertPseudoBulletBlocksToNativeLists,
  deleteSelectionRangeContents,
  extractInnerBlockFromListToRoot,
  extractListItemToRootParagraph,
  forceParagraphToContentMargin,
  getStuckInnerBlockInListItem,
  blockHasListableContent,
  caretFollowsLineBreakInBlock as caretFollowsLineBreakInBlockLib,
  insertEmptyListAfterBlock,
  insertParagraphAboveList,
  isolateCaretLineForList,
  isCaretInBulletPrefixZone,
  mergeListWithNeighbors,
  normalizePseudoListsInHtmlString,
  proseAnchorToKeepOutOfList,
  removeListItemsInRangeDom,
  selectionSpansEntireListItems as selectionSpansEntireListItemsLib,
  shouldRemoveOrphanEmptyLists,
  shouldStartListBelowBlock,
} from '../../lib/listEditorBehavior';

const COLORS = ['#534AB7', '#E24B4A', '#1D9E75', '#185FA5', '#BA7517', '#993556', '#0F6E56', '#3C3489', '#639922', '#2C2C2A', '#D85A30', '#888780'];
const HIGHLIGHT_COLORS = ['#FFEB3B', '#FFD54F', '#A5D6A7', '#80DEEA', '#CE93D8', '#F48FB1', '#FFCC80', '#EF9A9A', '#B0BEC5', '#FFFFFF', '#000000'];
const SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 56, 64, 72];
const TOGGLE_COMMANDS = ['bold', 'italic', 'underline', 'strikeThrough'] as const;
const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);
const LIST_TAGS = new Set(['UL', 'OL']);
type BlockAlign = 'left' | 'center' | 'right';
const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const DEFAULT_FONT_PX = 15;
const FONT_LINE_HEIGHT = '1.35';
const TAB_INDENT = '    ';

function isEquivalentEditorHtml(a: string, b: string): boolean {
  if (a === b) return true;
  const normalize = (html: string) => html.replace(/\s+/g, ' ').trim();
  return normalize(a) === normalize(b);
}

const HIGHLIGHT_INLINE_TAGS = new Set(['SPAN', 'FONT', 'MARK', 'B', 'STRONG', 'EM', 'I', 'U', 'A']);

function unwrapHighlightElement(el: HTMLElement) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

function isTransparentBg(color: string) {
  return !color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)' || /rgba?\(\s*0,\s*0,\s*0/i.test(color);
}

function elementHasHighlight(el: HTMLElement): boolean {
  if (el.tagName === 'MARK') return true;
  if (el.hasAttribute('bgcolor')) return true;
  const styleAttr = el.getAttribute('style') || '';
  if (/mso-highlight/i.test(styleAttr)) return true;
  const inlineBg = el.style.getPropertyValue('background-color') || el.style.background;
  if (inlineBg && !isTransparentBg(inlineBg)) return true;
  if (HIGHLIGHT_INLINE_TAGS.has(el.tagName)) {
    const computed = window.getComputedStyle(el).backgroundColor;
    if (isTransparentBg(computed)) return false;
    const parentBg = el.parentElement ? window.getComputedStyle(el.parentElement).backgroundColor : 'transparent';
    return computed !== parentBg;
  }
  return false;
}

function clearElementHighlight(el: HTMLElement) {
  if (el.tagName === 'MARK') {
    unwrapHighlightElement(el);
    return;
  }
  el.style.removeProperty('background-color');
  el.style.removeProperty('background');
  el.style.removeProperty('mso-highlight');
  const styleAttr = el.getAttribute('style');
  if (styleAttr) {
    const cleaned = styleAttr
      .replace(/mso-highlight\s*:\s*[^;]+;?/gi, '')
      .replace(/background(-color)?\s*:\s*[^;]+;?/gi, '')
      .replace(/;\s*;/g, ';')
      .trim()
      .replace(/^;|;$/g, '');
    if (cleaned) el.setAttribute('style', cleaned);
    else el.removeAttribute('style');
  }
  el.removeAttribute('bgcolor');
  el.classList.remove('highlight', 'mark', 'hl', 'yellow', 'MsoHighlight');
  if ((el.tagName === 'SPAN' || el.tagName === 'FONT') && el.attributes.length === 0) {
    unwrapHighlightElement(el);
  }
}

function collectHighlightedInRange(ed: HTMLElement, range: Range): HTMLElement[] {
  const highlighted: HTMLElement[] = [];
  const consider = (node: HTMLElement) => {
    if (!ed.contains(node)) return;
    if (!elementHasHighlight(node)) return;
    if (!range.intersectsNode(node)) return;
    if (!highlighted.includes(node)) highlighted.push(node);
  };
  ed.querySelectorAll('mark, font[bgcolor], [style]').forEach((node) => {
    if (node instanceof HTMLElement) consider(node);
  });
  let probe: HTMLElement | null = range.startContainer.nodeType === Node.TEXT_NODE
    ? range.startContainer.parentElement
    : (range.startContainer instanceof HTMLElement ? range.startContainer : null);
  while (probe && probe !== ed) {
    consider(probe);
    probe = probe.parentElement;
  }
  probe = range.endContainer.nodeType === Node.TEXT_NODE
    ? range.endContainer.parentElement
    : (range.endContainer instanceof HTMLElement ? range.endContainer : null);
  while (probe && probe !== ed) {
    consider(probe);
    probe = probe.parentElement;
  }
  highlighted.sort((a, b) => {
    if (a.contains(b)) return 1;
    if (b.contains(a)) return -1;
    return 0;
  });
  return highlighted;
}

function clearHighlightsInRange(ed: HTMLElement, range: Range) {
  if (range.collapsed) {
    let probe: HTMLElement | null = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : (range.startContainer instanceof HTMLElement ? range.startContainer : null);
    while (probe && probe !== ed) {
      if (elementHasHighlight(probe)) {
        clearElementHighlight(probe);
        return;
      }
      probe = probe.parentElement;
    }
    return;
  }

  const highlighted = collectHighlightedInRange(ed, range);
  highlighted.forEach(clearElementHighlight);

  const sel = window.getSelection();
  sel?.removeAllRanges();
  try {
    sel?.addRange(range);
  } catch {
    /* range may be invalid after DOM changes */
  }
}

const TOGGLE_MARK_TAGS: Record<string, string[]> = {
  bold: ['B', 'STRONG'],
  italic: ['I', 'EM'],
  underline: ['U'],
  strikeThrough: ['S', 'STRIKE', 'DEL'],
};

const TOGGLE_STYLE_PROP: Record<string, { prop: string; on: string[]; off: string }> = {
  bold: { prop: 'fontWeight', on: ['bold', 'bolder', '600', '700', '800', '900'], off: 'normal' },
  italic: { prop: 'fontStyle', on: ['italic', 'oblique'], off: 'normal' },
  underline: { prop: 'textDecoration', on: ['underline'], off: 'none' },
  strikeThrough: { prop: 'textDecoration', on: ['line-through'], off: 'none' },
};

const TOGGLE_WRAP_TAGS: Record<string, string> = {
  bold: 'b',
  italic: 'i',
  underline: 'u',
  strikeThrough: 's',
};

function styleHasToggleMark(style: CSSStyleDeclaration, cmd: string): boolean {
  const cfg = TOGGLE_STYLE_PROP[cmd];
  if (!cfg) return false;
  const raw = (style as unknown as Record<string, string>)[cfg.prop] || '';
  const val = raw.toLowerCase();
  if (cmd === 'underline' || cmd === 'strikeThrough') {
    return cfg.on.some((token) => val.includes(token));
  }
  if (cfg.on.includes(val)) return true;
  const n = parseInt(val, 10);
  return cmd === 'bold' && !Number.isNaN(n) && n >= 600;
}

function elementHasToggleMark(el: HTMLElement, cmd: string): boolean {
  if (el.getAttribute('data-note-mark') === cmd) return true;
  const tags = TOGGLE_MARK_TAGS[cmd];
  if (tags?.includes(el.tagName)) return true;
  return styleHasToggleMark(el.style, cmd);
}

function unwrapToggleMarkElement(el: HTMLElement, cmd: string) {
  const tags = TOGGLE_MARK_TAGS[cmd] ?? [];
  const cfg = TOGGLE_STYLE_PROP[cmd];
  if (el.getAttribute('data-note-mark') === cmd || tags.includes(el.tagName)) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
    return;
  }
  if (!cfg) return;
  if (cmd === 'underline' || cmd === 'strikeThrough') {
    const next = (el.style.textDecoration || '')
      .split(/\s+/)
      .filter((part) => part && !cfg.on.includes(part.toLowerCase()))
      .join(' ');
    el.style.textDecoration = next;
    if (!next) el.style.removeProperty('text-decoration');
  } else if (cfg.prop === 'fontWeight') {
    el.style.fontWeight = cfg.off;
  } else if (cfg.prop === 'fontStyle') {
    el.style.fontStyle = cfg.off;
  }
  el.removeAttribute('data-note-mark');
  if (!el.getAttribute('style')?.trim()) el.removeAttribute('style');
  if (el.tagName === 'SPAN' && !el.getAttribute('style') && !el.getAttribute('class') && !el.getAttribute('data-note-mark')) {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}

/** Strip B/I/U/S markup inside a DocumentFragment before re-wrapping. */
function stripToggleMarkInFragment(root: ParentNode, cmd: string) {
  const hit = new Set<HTMLElement>();
  if (root instanceof HTMLElement && elementHasToggleMark(root, cmd)) hit.add(root);
  root.querySelectorAll?.('*').forEach((node) => {
    if (node instanceof HTMLElement && elementHasToggleMark(node, cmd)) hit.add(node);
  });
  [...hit].sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0)).forEach((el) => {
    unwrapToggleMarkElement(el, cmd);
  });
}

/** Strip B/I/U/S markup inside a range when toggle-off is requested. */
function stripToggleMarkInRange(range: Range, cmd: string) {
  const root = range.commonAncestorContainer;
  const rootEl = root.nodeType === Node.TEXT_NODE ? root.parentElement : (root instanceof Element ? root : null);
  if (!rootEl) return;

  const candidates = new Set<HTMLElement>();
  if (rootEl instanceof HTMLElement && elementHasToggleMark(rootEl, cmd)) candidates.add(rootEl);
  rootEl.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    try {
      if (!range.intersectsNode(node)) return;
    } catch {
      return;
    }
    if (elementHasToggleMark(node, cmd)) candidates.add(node);
  });

  [...candidates]
    .sort((a, b) => (a.contains(b) ? 1 : b.contains(a) ? -1 : 0))
    .forEach((el) => unwrapToggleMarkElement(el, cmd));
}

function nodeHasToggleMarkAncestor(node: Node, cmd: string, boundary: Node): boolean {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== boundary) {
    if (el instanceof HTMLElement && elementHasToggleMark(el, cmd)) return true;
    el = el.parentNode;
  }
  return false;
}

function collectTextNodesInRange(range: Range): Text[] {
  if (range.collapsed) return [];
  const nodes: Text[] = [];
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const text = (range.startContainer.textContent || '').slice(range.startOffset, range.endOffset);
    if (text.replace(/[\u200B\u00A0]/g, '').trim()) nodes.push(range.startContainer as Text);
    return nodes;
  }
  const root = range.commonAncestorContainer;
  const walkRoot = root.nodeType === Node.TEXT_NODE ? root.parentNode : root;
  if (!walkRoot) return nodes;
  const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT);
  let n: Node | null = walker.nextNode();
  while (n) {
    if ((n.textContent || '').replace(/[\u200B\u00A0]/g, '').trim()) {
      try {
        if (range.intersectsNode(n)) nodes.push(n as Text);
      } catch { /* detached */ }
    }
    n = walker.nextNode();
  }
  return nodes;
}

/** True when every visible text node in the range already carries an explicit toggle mark (not UA <th> bold). */
function rangeIsFullyToggleMarked(range: Range, cmd: string, boundary: Node): boolean {
  const texts = collectTextNodesInRange(range);
  if (texts.length === 0) return nodeHasToggleMarkAncestor(range.startContainer, cmd, boundary);
  return texts.every((t) => nodeHasToggleMarkAncestor(t, cmd, boundary));
}

/**
 * DOM wrap for B/I/U/S — same extractContents + span style pattern as highlight.
 * Prefer styled <span data-note-mark> over <b>/<i> so marks stay visible inside <th>
 * (UA stylesheet already bolds headers) and are reliably detectable for toggle-off.
 */
function wrapRangeWithToggleMark(range: Range, cmd: string): HTMLElement | null {
  if (!TOGGLE_STYLE_PROP[cmd]) return null;
  try {
    const contents = range.extractContents();
    stripToggleMarkInFragment(contents, cmd);
    const el = document.createElement('span');
    el.setAttribute('data-note-mark', cmd);
    if (cmd === 'bold') el.style.fontWeight = '700';
    else if (cmd === 'italic') el.style.fontStyle = 'italic';
    else if (cmd === 'underline') el.style.textDecoration = 'underline';
    else if (cmd === 'strikeThrough') el.style.textDecoration = 'line-through';
    el.appendChild(contents);
    range.insertNode(el);
    return el;
  } catch {
    return null;
  }
}

function wrapRangeWithHighlight(range: Range, color: string): HTMLSpanElement | null {
  try {
    const contents = range.extractContents();
    contents.querySelectorAll?.('[style]').forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.style.removeProperty('background-color');
      node.style.removeProperty('background');
      if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
    });
    const span = document.createElement('span');
    span.style.backgroundColor = color;
    span.appendChild(contents);
    range.insertNode(span);
    return span;
  } catch {
    return null;
  }
}

function stripInlineFontSize(root: ParentNode) {
  root.querySelectorAll?.('[style]').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.removeProperty('font-size');
    node.style.removeProperty('line-height');
    if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
  });
  root.querySelectorAll?.('font[size]').forEach((node) => node.removeAttribute('size'));
}

function stripInlineTextColor(root: ParentNode) {
  root.querySelectorAll?.('[style]').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.removeProperty('color');
    if (!node.getAttribute('style')?.trim()) node.removeAttribute('style');
  });
  root.querySelectorAll?.('font[color]').forEach((node) => node.removeAttribute('color'));
}

interface Props {
  html: string;
  onChange: (html: string) => void;
  /** Fires on every edit immediately — use for save refs without re-rendering each keystroke. */
  onLiveChange?: (html: string) => void;
  /** Parent draft revision — when newer than local keystrokes, apply remote html even while focused. */
  syncUpdatedAt?: number;
  placeholder: string;
  editable?: boolean;
  minHeight?: string;
  maxHeight?: string;
  toolbarEnd?: ReactNode;
  onLockedTripleClick?: () => void;
  resizable?: boolean;
  stickyToolbar?: boolean;
  /** When set, exposes a flush() that syncs DOM → html and returns the latest serialized html. */
  flushRef?: MutableRefObject<(() => string) | null>;
}

type EditorSelectionBookmark = {
  startPath: number[];
  startOffset: number;
  endPath: number[];
  endOffset: number;
  collapsed: boolean;
};

type EditorSnapshot = {
  html: string;
  selection: EditorSelectionBookmark | null;
};

const EDITOR_UNDO_LIMIT = 80;

export function RichTextEditor({ html, onChange, onLiveChange, syncUpdatedAt, placeholder, editable = true, minHeight = '120px', maxHeight, toolbarEnd, onLockedTripleClick, resizable, stickyToolbar = true, flushRef }: Props) {
  const { t, lang } = useLanguage();
  const { show: showToast } = useToast();
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
    if (!frame.style.width) frame.style.width = 'fit-content';
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

  /** Serialize without cloning — avoids duplicating large base64 images in memory.
   *  Mutates `ed` temporarily (detaches chrome / unwraps table bodies). Do NOT call
   *  this before applying toolbar marks — it races selection restore. Prefer
   *  `serializeEditorHtmlSafe` for undo checkpoints. */
  const serializeEditorHtml = (ed: HTMLElement): string => {
    const detached: { parent: HTMLElement; host: HTMLElement }[] = [];
    ed.querySelectorAll(`.${NOTE_IMG_TOOLBAR_HOST}, .${NOTE_TABLE_TOOLBAR_HOST}, .${NOTE_YT_REMOVE}`).forEach((node) => {
      if (node instanceof HTMLElement && node.parentElement instanceof HTMLElement) {
        detached.push({ parent: node.parentElement, host: node });
        node.remove();
      }
    });
    // Ephemeral selection chrome must not persist into saved HTML.
    const clearedFrames: { frame: HTMLElement; scale: string; active: boolean; resizing: boolean }[] = [];
    ed.querySelectorAll(`.${NOTE_IMG_FRAME}`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const active = node.classList.contains('note-img-frame--active');
      const resizing = node.classList.contains('note-img-frame--resizing');
      const scale = node.style.getPropertyValue('--note-img-select-scale');
      if (!active && !resizing && !scale) return;
      clearedFrames.push({ frame: node, scale, active, resizing });
      node.classList.remove('note-img-frame--active', 'note-img-frame--resizing');
      node.style.removeProperty('--note-img-select-scale');
    });
    const clearedYt: HTMLElement[] = [];
    ed.querySelectorAll(`.${NOTE_YT_FRAME}.note-yt-frame--active`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      clearedYt.push(node);
      node.classList.remove('note-yt-frame--active');
    });
    const unwrappedBodies: { wrap: HTMLElement; table: HTMLTableElement }[] = [];
    ed.querySelectorAll(`.${NOTE_TABLE_BODY}`).forEach((node) => {
      if (!(node instanceof HTMLElement) || !(node.parentElement instanceof HTMLElement)) return;
      const table = node.querySelector(`table.${NOTE_TABLE_CLASS}`);
      if (!(table instanceof HTMLTableElement)) return;
      unwrappedBodies.push({ wrap: node.parentElement, table });
      node.parentElement.insertBefore(table, node);
      node.remove();
    });
    const html = ed.innerHTML;
    unwrappedBodies.forEach(({ wrap, table }) => {
      const nextBody = document.createElement('div');
      nextBody.className = NOTE_TABLE_BODY;
      wrap.insertBefore(nextBody, table);
      nextBody.appendChild(table);
    });
    // Reattach chrome without moving table menus under the table.
    // Image/YouTube hosts belong at the end of their frame; table toolbar hosts must
    // stay pinned as the first child of the wrap (above `.note-table-body`).
    detached.forEach(({ parent, host }) => {
      if (host.classList.contains(NOTE_TABLE_TOOLBAR_HOST) && parent.classList.contains(NOTE_TABLE_WRAP)) {
        parent.insertBefore(host, parent.firstChild);
        ensureTableWrapStructure(parent);
        return;
      }
      parent.appendChild(host);
    });
    clearedFrames.forEach(({ frame, scale, active, resizing }) => {
      if (active) frame.classList.add('note-img-frame--active');
      if (resizing) frame.classList.add('note-img-frame--resizing');
      if (scale) frame.style.setProperty('--note-img-select-scale', scale);
    });
    clearedYt.forEach((frame) => frame.classList.add('note-yt-frame--active'));
    // Guarantee any pasted "• …" / "1. …" pseudo-lists persist as real ul/ol.
    return normalizePseudoListsInHtmlString(html);
  };

  /** Undo/redo snapshot HTML without touching the live editor (keeps selection alive). */
  const serializeEditorHtmlSafe = (ed: HTMLElement): string => {
    const clone = ed.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`.${NOTE_IMG_TOOLBAR_HOST}, .${NOTE_TABLE_TOOLBAR_HOST}, .${NOTE_YT_REMOVE}`).forEach((n) => n.remove());
    clone.querySelectorAll(`.${NOTE_IMG_FRAME}`).forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.classList.remove('note-img-frame--active', 'note-img-frame--resizing');
      node.style.removeProperty('--note-img-select-scale');
    });
    clone.querySelectorAll(`.${NOTE_YT_FRAME}.note-yt-frame--active`).forEach((node) => {
      if (node instanceof HTMLElement) node.classList.remove('note-yt-frame--active');
    });
    clone.querySelectorAll(`.${NOTE_TABLE_BODY}`).forEach((node) => {
      if (!(node instanceof HTMLElement) || !(node.parentElement instanceof HTMLElement)) return;
      const table = node.querySelector(`table.${NOTE_TABLE_CLASS}`);
      if (!(table instanceof HTMLTableElement)) return;
      node.parentElement.insertBefore(table, node);
      node.remove();
    });
    return normalizePseudoListsInHtmlString(clone.innerHTML);
  };

  const youtubeRemoveLabel = lang === 'sv' ? 'Ta bort video' : 'Remove video';

  const ensureYouTubeRemoveButton = (frame: HTMLElement) => {
    if (!(frame instanceof HTMLElement) || !frame.classList.contains(NOTE_YT_FRAME)) return;
    const existing = frame.querySelector(`:scope > .${NOTE_YT_REMOVE}`);
    if (existing instanceof HTMLButtonElement) {
      existing.setAttribute('aria-label', youtubeRemoveLabel);
      existing.title = youtubeRemoveLabel;
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = NOTE_YT_REMOVE;
    btn.setAttribute('contenteditable', 'false');
    btn.setAttribute('tabindex', '-1');
    btn.setAttribute('aria-label', youtubeRemoveLabel);
    btn.title = youtubeRemoveLabel;
    btn.textContent = '✕';
    frame.appendChild(btn);
  };

  const syncYouTubeRemoveChrome = (ed: HTMLElement) => {
    if (editable) {
      ed.querySelectorAll(`.${NOTE_YT_FRAME}`).forEach((node) => {
        if (node instanceof HTMLElement) ensureYouTubeRemoveButton(node);
      });
    } else {
      ed.querySelectorAll(`.${NOTE_YT_REMOVE}`).forEach((el) => el.remove());
    }
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
      if (!(frame instanceof HTMLElement)) return;
      getToolbarHost(frame);
      // Heal layout so images never clip after save/reload on a narrower column.
      // Absolute px width + max-width:none used to overflow the frame (overflow:hidden).
      const img = frame.querySelector(':scope > img');
      if (!(img instanceof HTMLImageElement)) return;
      const maxW = Math.max(120, ed.clientWidth - 32);
      const frameW = frame.style.width || '';
      const imgW = img.style.width || '';
      const needsFluidHeal =
        img.style.maxWidth === 'none'
        || imgW.endsWith('px')
        || frameW.endsWith('px')
        || img.style.objectFit === 'fill'
        || (img.style.height && img.style.height !== 'auto' && img.style.height !== '');
      if (needsFluidHeal || ((!frameW || frameW === 'fit-content') && imgW.endsWith('px'))) {
        let px = 0;
        if (frameW.endsWith('px')) px = parseFloat(frameW);
        else if (imgW.endsWith('px')) px = parseFloat(imgW);
        else px = frame.getBoundingClientRect().width || img.getBoundingClientRect().width;
        if (px > 0 && maxW > 0) {
          const pct = Math.min(100, Math.max(8, (px / maxW) * 100));
          frame.style.width = `${Math.round(pct * 10) / 10}%`;
        }
        frame.style.maxWidth = '100%';
        img.style.width = '100%';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.objectFit = 'contain';
        img.style.maxHeight = 'none';
      } else if (frameW.endsWith('%')) {
        img.style.width = '100%';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.objectFit = 'contain';
        img.style.maxHeight = 'none';
      }
    });
    // Never leave image/youtube frames inside the same text block — Enter through
    // contenteditable=false embeds can blank the whole React tree.
    separateEmbedsFromTextBlocks(ed);
    normalizeYouTubeEmbeds(ed);
    syncYouTubeRemoveChrome(ed);
    normalizeAutoLinks(ed);
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

  const clearYouTubeSelection = () => {
    const frame = selectedYtFrameRef.current;
    if (frame?.isConnected) frame.classList.remove('note-yt-frame--active');
    selectedYtFrameRef.current = null;
  };

  const selectYouTubeFrame = (frame: HTMLElement) => {
    if (selectedYtFrameRef.current && selectedYtFrameRef.current !== frame) {
      selectedYtFrameRef.current.classList.remove('note-yt-frame--active');
    }
    selectedYtFrameRef.current = frame;
    frame.classList.add('note-yt-frame--active');
    ensureYouTubeRemoveButton(frame);
  };

  const removeYouTubeBlock = (frame: HTMLElement) => {
    clearYouTubeSelection();
    removeYouTubeEmbed(frame);
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
  const activeTableCtxRef = useRef<TableCellContext | null>(null);
  const activeTableWrapRef = useRef<HTMLElement | null>(null);
  const tableToolbarClickRef = useRef(false);
  /** All table wraps that should show the row/col toolbar while edit mode is open. */
  const [tableWraps, setTableWraps] = useState<HTMLElement[]>([]);
  const tableWrapsRef = useRef<HTMLElement[]>([]);
  const tableCtxByWrapRef = useRef(new WeakMap<HTMLElement, TableCellContext>());
  const tableWrapIdSeqRef = useRef(0);
  const tableToolbarHostsRef = useRef(new WeakMap<HTMLElement, HTMLElement>());
  const [imgResizeMode, setImgResizeMode] = useState(false);
  const imgResizeModeRef = useRef(false);
  imgResizeModeRef.current = imgResizeMode;
  const [imgOverflowOpen, setImgOverflowOpen] = useState(false);
  const imgOverflowOpenRef = useRef(false);
  imgOverflowOpenRef.current = imgOverflowOpen;
  const [imgOverflowPos, setImgOverflowPos] = useState({ left: 0, bottom: 0 });
  const imgOverflowBtnRef = useRef<HTMLButtonElement>(null);
  const imgOverflowMenuRef = useRef<HTMLDivElement>(null);
  const isResizingImg = useRef(false);
  const isResizingTableCol = useRef(false);
  const tableColResizeHoverRef = useRef<HTMLTableElement | null>(null);
  const activeFrameRef = useRef<HTMLElement | null>(null);
  const selectedYtFrameRef = useRef<HTMLElement | null>(null);
  const hoveredImgElRef = useRef<HTMLImageElement | null>(null);
  const hoverMoveRafRef = useRef<number | null>(null);

  const syncHoveredImg = (img: HTMLImageElement, frame: HTMLElement) => ({
    el: img,
    frame,
    host: getToolbarHost(frame),
    rect: img.getBoundingClientRect(),
  });

  /** Toolbar is ~38px tall; scale image so that space opens at the bottom for the overlay. */
  const NOTE_IMG_TOOLBAR_RESERVE_PX = 38;
  /** Full bar: 10×28px buttons + 2 dividers + gaps + padding. Below this, collapse into overflow. */
  const NOTE_IMG_TOOLBAR_FULL_MIN_PX = 324;

  const clearImageSelectionChrome = (frame: HTMLElement | null) => {
    if (!frame) return;
    frame.classList.remove('note-img-frame--active', 'note-img-frame--resizing');
    frame.style.removeProperty('--note-img-select-scale');
  };

  const applyImageSelectScale = (img: HTMLImageElement, frame: HTMLElement) => {
    // offsetHeight ignores CSS transform, so re-entry while scaled stays stable.
    const layoutH = img.offsetHeight || img.getBoundingClientRect().height;
    const scale = layoutH > 0
      ? Math.max(0.72, Math.min(1, (layoutH - NOTE_IMG_TOOLBAR_RESERVE_PX) / layoutH))
      : 0.9;
    frame.style.setProperty('--note-img-select-scale', String(scale));
  };

  const hideImageToolbar = () => {
    setImgOverflowOpen(false);
    if (isResizingImg.current || imgResizeModeRef.current) return;
    clearImageSelectionChrome(activeFrameRef.current);
    activeFrameRef.current = null;
    hoveredImgElRef.current = null;
    setHoveredImg(null);
    setImgResizeMode(false);
  };

  const isNoteImgToolbarUi = (node: EventTarget | null): boolean => {
    if (!(node instanceof Element)) return false;
    return !!node.closest(`.${NOTE_IMG_TOOLBAR}`);
  };

  const clearActiveTableHighlight = () => {
    if (activeTableWrapRef.current) {
      activeTableWrapRef.current.classList.remove('note-table-wrap--active');
      activeTableWrapRef.current = null;
    }
    activeTableCtxRef.current = null;
    setActiveTableWrap(null);
  };

  const hideTableToolbar = () => {
    clearActiveTableHighlight();
    tableWrapsRef.current = [];
    setTableWraps([]);
  };

  const showTableToolbar = (ctx: TableCellContext) => {
    if (activeTableWrapRef.current && activeTableWrapRef.current !== ctx.wrap) {
      activeTableWrapRef.current.classList.remove('note-table-wrap--active');
    }
    activeTableWrapRef.current = ctx.wrap;
    setActiveTableWrap(ctx.wrap);
    const { toolbarHost } = ensureTableWrapStructure(ctx.wrap);
    tableToolbarHostsRef.current.set(ctx.wrap, toolbarHost);
    if (!ctx.wrap.dataset.noteTableId) {
      tableWrapIdSeqRef.current += 1;
      ctx.wrap.dataset.noteTableId = `nt-${tableWrapIdSeqRef.current}`;
    }
    tableCtxByWrapRef.current.set(ctx.wrap, ctx);
    activeTableCtxRef.current = ctx;
  };

  const syncVisibleTableWraps = () => {
    const ed = editorRef.current;
    if (!ed || !editable) {
      hideTableToolbar();
      return;
    }
    const wraps = Array.from(ed.querySelectorAll(`.${NOTE_TABLE_WRAP}`)).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && !!node.querySelector(`table.${NOTE_TABLE_CLASS}`),
    );
    wraps.forEach((wrap) => {
      const { toolbarHost } = ensureTableWrapStructure(wrap);
      tableToolbarHostsRef.current.set(wrap, toolbarHost);
      if (!wrap.dataset.noteTableId) {
        tableWrapIdSeqRef.current += 1;
        wrap.dataset.noteTableId = `nt-${tableWrapIdSeqRef.current}`;
      }
      const existing = tableCtxByWrapRef.current.get(wrap);
      if (existing?.table.isConnected && wrap.contains(existing.table)) return;
      const table = wrap.querySelector(`table.${NOTE_TABLE_CLASS}`);
      if (!(table instanceof HTMLTableElement)) return;
      const ctx = resolveTableContextAt(table, 0, 0, ed);
      if (ctx) tableCtxByWrapRef.current.set(wrap, ctx);
    });
    const same =
      wraps.length === tableWrapsRef.current.length
      && wraps.every((wrap, i) => wrap === tableWrapsRef.current[i]);
    tableWrapsRef.current = wraps;
    if (!same) setTableWraps(wraps);

    if (wraps.length === 0) {
      clearActiveTableHighlight();
      return;
    }

    const sel = window.getSelection();
    const fromSel = sel?.rangeCount ? resolveTableContext(sel.anchorNode, ed) : null;
    if (fromSel) {
      showTableToolbar(fromSel);
      return;
    }
    const cached = activeTableCtxRef.current;
    if (cached?.table.isConnected && wraps.includes(cached.wrap)) {
      const resolved = resolveTableContextAt(cached.table, cached.rowIndex, cached.colIndex, ed);
      if (resolved) {
        showTableToolbar(resolved);
        return;
      }
    }
    const fallback = tableCtxByWrapRef.current.get(wraps[0]);
    if (fallback) showTableToolbar(fallback);
  };

  const getWorkingTableContext = (wrap?: HTMLElement | null): TableCellContext | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    if (wrap) {
      const cached = tableCtxByWrapRef.current.get(wrap);
      if (cached?.table.isConnected && wrap.contains(cached.table)) {
        return resolveTableContextAt(cached.table, cached.rowIndex, cached.colIndex, ed) ?? cached;
      }
      const table = wrap.querySelector(`table.${NOTE_TABLE_CLASS}`);
      if (table instanceof HTMLTableElement) return resolveTableContextAt(table, 0, 0, ed);
      return null;
    }
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const fromSel = resolveTableContext(sel.anchorNode, ed);
      if (fromSel) return fromSel;
    }
    const cached = activeTableCtxRef.current;
    if (!cached?.table.isConnected) return null;
    return resolveTableContextAt(cached.table, cached.rowIndex, cached.colIndex, ed) ?? cached;
  };

  const refreshActiveTableToolbar = () => {
    const ed = editorRef.current;
    if (!ed || !editable) return;
    // Keep menus mounted for every table in edit mode; only refresh active cell context.
    if (tableWrapsRef.current.length === 0) {
      syncVisibleTableWraps();
      return;
    }
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const ctx = resolveTableContext(sel.anchorNode, ed);
      if (ctx) {
        showTableToolbar(ctx);
        return;
      }
    }
    // Selection left the table — keep toolbars visible; retain last active cell.
  };

  const runTableAction = (
    action: (ctx: TableCellContext) => TableEditPosition | false | 'deleted' | void,
    wrap?: HTMLElement | null,
  ) => {
    tableToolbarClickRef.current = true;
    const ed = editorRef.current;
    const ctx = getWorkingTableContext(wrap);
    if (!ctx || !ed) return;
    const result = action(ctx);
    if (result === false) return;
    if (result === 'deleted') {
      ed.focus({ preventScroll: true });
      saveSel();
      emitHtml();
      syncVisibleTableWraps();
      return;
    }
    if (result && typeof result === 'object') {
      const next = resolveTableContextAt(ctx.table, result.rowIndex, result.colIndex, ed);
      if (next) {
        placeCaretInTableCell(next.cell);
        showTableToolbar(next);
      }
    }
    ed.focus({ preventScroll: true });
    saveSel();
    emitHtml();
    syncVisibleTableWraps();
  };

  const showImageToolbar = (img: HTMLImageElement) => {
    const ed = editorRef.current;
    if (!ed) return;
    const frame = ensureImageFrame(img, ed);
    if (hoveredImgElRef.current === img && activeFrameRef.current === frame) return;
    setImgOverflowOpen(false);
    if (activeFrameRef.current && activeFrameRef.current !== frame) {
      clearImageSelectionChrome(activeFrameRef.current);
    }
    applyImageSelectScale(img, frame);
    frame.classList.add('note-img-frame--active');
    if (imgResizeModeRef.current) frame.classList.add('note-img-frame--resizing');
    activeFrameRef.current = frame;
    hoveredImgElRef.current = img;
    setHoveredImg(syncHoveredImg(img, frame));
  };

  const clearTableColResizeHover = () => {
    const prev = tableColResizeHoverRef.current;
    if (!prev) return;
    prev.classList.remove(NOTE_TABLE_COL_RESIZE_HOVER);
    tableColResizeHoverRef.current = null;
  };

  const setTableColResizeHover = (table: HTMLTableElement | null) => {
    if (tableColResizeHoverRef.current === table) return;
    clearTableColResizeHover();
    if (!table) return;
    table.classList.add(NOTE_TABLE_COL_RESIZE_HOVER);
    tableColResizeHoverRef.current = table;
  };

  const handleEditorMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || isResizingImg.current || isResizingTableCol.current) return;
    const ed = editorRef.current;
    if (ed) {
      const colHit = hitTableColumnResize(ed, event.clientX, event.clientY);
      setTableColResizeHover(colHit?.table ?? null);
    }
    if (hoverMoveRafRef.current !== null) return;
    const target = event.target;
    hoverMoveRafRef.current = requestAnimationFrame(() => {
      hoverMoveRafRef.current = null;
      const img = resolveNoteImage(target);
      if (img) {
        showImageToolbar(img);
        return;
      }
      if (imgResizeModeRef.current || imgOverflowOpenRef.current) return;
      if (hoveredImgElRef.current) {
        if (target instanceof Node && activeFrameRef.current?.contains(target)) return;
        if (isNoteImgToolbarUi(target)) return;
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
  const lastKeystrokeAtRef = useRef(0);
  const lastSyncUpdatedAtRef = useRef(syncUpdatedAt);
  const onChangeRef = useRef(onChange);
  const onLiveChangeRef = useRef(onLiveChange);
  onChangeRef.current = onChange;
  onLiveChangeRef.current = onLiveChange;
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputCleanupRafRef = useRef<number | null>(null);
  const selectionRafRef = useRef<number | null>(null);
  /** After removing a trailing empty bullet, the next Backspace exits the list to the left margin. */
  const pendingListMarginExitRef = useRef<HTMLUListElement | HTMLOListElement | null>(null);
  /** After empty bullet → paragraph (step 1), step 2 strips indent on this block. */
  const pendingIndentExitRef = useRef<HTMLElement | null>(null);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const isRestoringUndoRef = useRef(false);
  const skipDuplicateBackspaceRef = useRef(false);
  /** Prevents double Enter when Safari fires beforeinput + keydown for the same Return. */
  const enterHandledRef = useRef(false);
  const EMIT_DEBOUNCE_MS = 280;

  const emitHtml = () => {
    lastKeystrokeAtRef.current = Date.now();
    const ed = editorRef.current;
    if (ed && onLiveChangeRef.current) {
      const live = serializeEditorHtml(ed);
      lastLocalHtmlRef.current = live;
      onLiveChangeRef.current(live);
    }
    if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
    emitTimerRef.current = setTimeout(() => {
      emitTimerRef.current = null;
      const liveEd = editorRef.current;
      if (!liveEd) return;
      const next = serializeEditorHtml(liveEd);
      lastLocalHtmlRef.current = next;
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

  // Expose flush synchronously during render so Save never hits a nullled
  // ref (useEffect cleanup used to clear it between blur-driven re-renders
  // and the Save click).
  if (flushRef) {
    flushRef.current = () => {
      flushEmitHtml();
      const ed = editorRef.current;
      return ed ? serializeEditorHtml(ed) : lastLocalHtmlRef.current;
    };
  }

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

  const getNodePathFromEditor = (node: Node, root: HTMLElement): number[] | null => {
    const path: number[] = [];
    let cur: Node | null = node;
    while (cur && cur !== root) {
      const parent: Node | null = cur.parentNode;
      if (!parent) return null;
      const idx = Array.from(parent.childNodes).indexOf(cur as ChildNode);
      if (idx < 0) return null;
      path.unshift(idx);
      cur = parent;
    }
    return cur === root ? path : null;
  };

  const resolveNodePathFromEditor = (root: HTMLElement, path: number[]): Node | null => {
    let node: Node = root;
    for (const idx of path) {
      if (idx < 0 || idx >= node.childNodes.length) return null;
      node = node.childNodes[idx];
    }
    return node;
  };

  const nodeOffsetLimit = (node: Node, offset: number) => {
    const max = node.nodeType === Node.TEXT_NODE
      ? (node.textContent?.length ?? 0)
      : node.childNodes.length;
    return Math.max(0, Math.min(offset, max));
  };

  const bookmarkEditorSelection = (ed: HTMLElement): EditorSelectionBookmark | null => {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!ed.contains(range.commonAncestorContainer)) return null;
    const startPath = getNodePathFromEditor(range.startContainer, ed);
    const endPath = getNodePathFromEditor(range.endContainer, ed);
    if (!startPath || !endPath) return null;
    return {
      startPath,
      startOffset: range.startOffset,
      endPath,
      endOffset: range.endOffset,
      collapsed: range.collapsed,
    };
  };

  const restoreEditorSelection = (ed: HTMLElement, bookmark: EditorSelectionBookmark | null) => {
    const sel = window.getSelection();
    if (!sel) return;
    if (!bookmark) {
      selectEditorEnd();
      restoreSel();
      return;
    }
    const startNode = resolveNodePathFromEditor(ed, bookmark.startPath);
    const endNode = resolveNodePathFromEditor(ed, bookmark.endPath);
    if (!startNode || !endNode) {
      selectEditorEnd();
      restoreSel();
      return;
    }
    try {
      const range = document.createRange();
      range.setStart(startNode, nodeOffsetLimit(startNode, bookmark.startOffset));
      range.setEnd(endNode, nodeOffsetLimit(endNode, bookmark.endOffset));
      if (bookmark.collapsed) range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      savedRange.current = range.cloneRange();
    } catch {
      selectEditorEnd();
      restoreSel();
    }
  };

  const snapshotsEqual = (a: EditorSnapshot, b: EditorSnapshot) =>
    a.html === b.html && JSON.stringify(a.selection) === JSON.stringify(b.selection);

  const captureEditorSnapshot = (): EditorSnapshot => {
    const ed = editorRef.current;
    if (!ed) return { html: '', selection: null };
    // Bookmark BEFORE any serialize work; use clone-based HTML so live selection stays valid.
    const selection = bookmarkEditorSelection(ed);
    return {
      html: serializeEditorHtmlSafe(ed),
      selection,
    };
  };

  const resetEditorUndoHistory = () => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  };

  const pushUndoCheckpoint = () => {
    if (isRestoringUndoRef.current || !editorRef.current || !editable) return;
    const snap = captureEditorSnapshot();
    const stack = undoStackRef.current;
    const last = stack[stack.length - 1];
    if (last && snapshotsEqual(last, snap)) return;
    stack.push(snap);
    if (stack.length > EDITOR_UNDO_LIMIT) stack.shift();
    redoStackRef.current = [];
  };

  const startTableColumnResize = (
    e: React.MouseEvent,
    hit: TableColumnResizeHit,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const ed = editorRef.current;
    if (!ed || !editable) return;
    isResizingTableCol.current = true;
    clearTableColResizeHover();
    hit.table.classList.add(NOTE_TABLE_COL_RESIZING);
    const startX = e.clientX;
    const tableWidth = Math.max(1, hit.table.getBoundingClientRect().width);
    const startWidths = getTableColumnWidths(hit.table);
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const deltaPct = ((ev.clientX - startX) / tableWidth) * 100;
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 2) return;
        // Checkpoint pre-drag HTML so Cmd+Z restores column widths.
        pushUndoCheckpoint();
        moved = true;
      }
      ev.preventDefault();
      resizeAdjacentTableColumns(
        hit.table,
        hit.leftColIndex,
        hit.rightColIndex,
        deltaPct,
        startWidths,
      );
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      hit.table.classList.remove(NOTE_TABLE_COL_RESIZING);
      isResizingTableCol.current = false;
      if (moved) {
        emitHtml();
        syncVisibleTableWraps();
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /** Toolbar image delete: checkpoint (with image) first, then remove; keep focus for Cmd+Z. */
  const deleteImageWithUndo = (img: HTMLImageElement) => {
    const ed = editorRef.current;
    if (!ed || !ed.contains(img)) return;
    ed.focus({ preventScroll: true });
    pushUndoCheckpoint();
    removeImageBlock(img);
    hideImageToolbar();
    saveSel();
    readCommandState();
    emitHtml();
  };

  const restoreEditorSnapshot = (snap: EditorSnapshot) => {
    const ed = editorRef.current;
    if (!ed) return;
    isRestoringUndoRef.current = true;
    hideImageToolbar();
    ed.innerHTML = snap.html;
    normalizeEditorImages(ed);
    normalizeTablesInEditor(ed);
    lastLocalHtmlRef.current = ed.innerHTML;
    restoreEditorSelection(ed, snap.selection);
    isRestoringUndoRef.current = false;
    readCommandState();
    flushEmitHtml();
  };

  const performEditorUndo = () => {
    if (undoStackRef.current.length === 0 || !editorRef.current) return false;
    const current = captureEditorSnapshot();
    redoStackRef.current.push(current);
    const target = undoStackRef.current.pop();
    if (!target) return false;
    restoreEditorSnapshot(target);
    return true;
  };

  const performEditorRedo = () => {
    if (redoStackRef.current.length === 0 || !editorRef.current) return false;
    const current = captureEditorSnapshot();
    undoStackRef.current.push(current);
    const target = redoStackRef.current.pop();
    if (!target) return false;
    restoreEditorSnapshot(target);
    return true;
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
    const cell = closestTableCell(el);
    while (el instanceof HTMLElement && el !== ed) {
      if (
        el.classList.contains(NOTE_TABLE_WRAP)
        || el.classList.contains(NOTE_TABLE_BODY)
        || el.classList.contains(NOTE_TABLE_TOOLBAR_HOST)
      ) {
        return null;
      }
      if (BLOCK_TAGS.has(el.tagName)) return el;
      if (cell && el === cell) return null;
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
    const isolated = isolateCaretLineForList(block, range);
    if (isolated !== block) placeCaretInBlock(isolated, true);
    return isolated;
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

  const getLiMeaningfulText = (li: HTMLLIElement) =>
    (li.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim() ?? '');

  const isEntireListItemSelected = (li: HTMLLIElement, range: Range): boolean => {
    if (range.collapsed) return false;
    const startInLi = li.contains(range.startContainer) || range.startContainer === li;
    const endInLi = li.contains(range.endContainer) || range.endContainer === li;
    if (!startInLi || !endInLi) return false;
    const startProbe = document.createRange();
    startProbe.selectNodeContents(li);
    startProbe.setEnd(range.startContainer, range.startOffset);
    if (startProbe.toString().replace(/\u200B/g, '').length !== 0) return false;
    const endProbe = document.createRange();
    endProbe.selectNodeContents(li);
    endProbe.setStart(range.endContainer, range.endOffset);
    return endProbe.toString().replace(/\u200B/g, '').length === 0;
  };

  /** True when the highlighted text is all meaningful content in the li (e.g. line select of "v"). */
  const selectionCoversFullLiText = (li: HTMLLIElement, range: Range): boolean => {
    if (range.collapsed) return false;
    const startInLi = li.contains(range.startContainer) || range.startContainer === li;
    const endInLi = li.contains(range.endContainer) || range.endContainer === li;
    if (!startInLi || !endInLi) return false;
    const liText = getLiMeaningfulText(li);
    const selText = range.toString().replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim();
    return liText.length > 0 && selText === liText;
  };

  const collectListItemsBetween = (startLi: HTMLLIElement, endLi: HTMLLIElement): HTMLLIElement[] => {
    const list = startLi.parentElement;
    if (!list || list !== endLi.parentElement) return [startLi];
    const items: HTMLLIElement[] = [];
    let collecting = false;
    for (const child of list.children) {
      if (child === startLi) collecting = true;
      if (collecting && child instanceof HTMLLIElement) items.push(child);
      if (child === endLi) break;
    }
    return items.length > 0 ? items : [startLi];
  };

  const selectionSpansEntireListItems = (
    startLi: HTMLLIElement,
    endLi: HTMLLIElement,
    range: Range,
  ) => collectListItemsBetween(startLi, endLi).every((item) => {
    const itemRange = document.createRange();
    itemRange.selectNodeContents(item);
    return range.compareBoundaryPoints(Range.START_TO_START, itemRange) <= 0
      && range.compareBoundaryPoints(Range.END_TO_END, itemRange) >= 0;
  });

  const removeListItemsInRange = (startLi: HTMLLIElement, endLi: HTMLLIElement) => {
    pendingListMarginExitRef.current = null;
    pendingIndentExitRef.current = null;
    const ed = editorRef.current;
    const originalList = startLi.parentElement;
    const caretTarget = removeListItemsInRangeDom(startLi, endLi, (list) => {
      if (ed) cleanupEmptyListShell(list, ed);
    });
    if (
      originalList
      && LIST_TAGS.has(originalList.tagName)
      && originalList.isConnected
    ) {
      mergeListWithNeighbors(originalList as HTMLUListElement | HTMLOListElement);
    }
    if (caretTarget) placeCaretInBlock(caretTarget, false);
    else selectEditorEnd();
    saveSel();
    readCommandState();
    emitHtml();
  };

  const deletePartialListSelection = (range: Range, ed: HTMLElement) => {
    pendingListMarginExitRef.current = null;
    pendingIndentExitRef.current = null;
    const startLi = getListItem(range.startContainer, ed);
    const endLi = getListItem(range.endContainer, ed);
    const sameLi = startLi && startLi === endLi ? startLi : null;
    const del = deleteSelectionRangeContents(ed, range);
    if (sameLi?.isConnected && isLiEffectivelyEmpty(sameLi)) {
      removeListItemOnBackspace(sameLi, ed);
      return;
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(del);
    savedRange.current = del.cloneRange();
    saveSel();
    readCommandState();
    emitHtml();
  };

  /** Delete any non-collapsed selection; always runs before list Backspace logic. */
  const deleteEditorSelection = (range: Range, ed: HTMLElement, sel: Selection): boolean => {
    if (sel.isCollapsed) return false;
    pendingListMarginExitRef.current = null;
    pendingIndentExitRef.current = null;

    const startLi = getListItem(range.startContainer, ed);
    const endLi = getListItem(range.endContainer, ed);
    if (
      startLi
      && endLi
      && startLi !== endLi
      && startLi.parentElement === endLi.parentElement
      && selectionSpansEntireListItemsLib(startLi, endLi, range)
    ) {
      removeListItemsInRange(startLi, endLi);
      return true;
    }
    if (
      startLi
      && endLi
      && startLi === endLi
      && (isEntireListItemSelected(startLi, range) || selectionCoversFullLiText(startLi, range))
    ) {
      removeListItemOnBackspace(startLi, ed);
      return true;
    }

    const del = deleteSelectionRangeContents(ed, range);
    sel.removeAllRanges();
    sel.addRange(del);
    savedRange.current = del.cloneRange();
    saveSel();
    readCommandState();
    emitHtml();
    return true;
  };

  const removeListItemOnBackspace = (li: HTMLLIElement, ed: HTMLElement) => {
    pendingListMarginExitRef.current = null;
    const prevLi = li.previousElementSibling;
    const nextLi = li.nextElementSibling;
    const list = li.parentElement;
    if (prevLi instanceof HTMLLIElement) {
      li.remove();
      if (list && LIST_TAGS.has(list.tagName)) {
        if (list.children.length === 0) list.remove();
        else {
          cleanupEmptyListShell(list as HTMLUListElement | HTMLOListElement, ed);
          if (list.isConnected) mergeListWithNeighbors(list as HTMLUListElement | HTMLOListElement);
        }
      }
      placeCaretInBlock(prevLi, false);
    } else if (nextLi instanceof HTMLLIElement) {
      li.remove();
      if (list && LIST_TAGS.has(list.tagName)) {
        if (list.children.length === 0) list.remove();
        else {
          cleanupEmptyListShell(list as HTMLUListElement | HTMLOListElement, ed);
          if (list.isConnected) mergeListWithNeighbors(list as HTMLUListElement | HTMLOListElement);
        }
      }
      placeCaretInBlock(nextLi, true);
    } else if (isNestedListItem(li)) {
      returnToParentListItem(li);
    } else if (list && LIST_TAGS.has(list.tagName) && list.children.length === 1) {
      unwrapList(list as HTMLUListElement | HTMLOListElement, true);
    } else {
      exitListItem(li, ed, true);
    }
    saveSel();
    readCommandState();
    emitHtml();
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

  const isLiEmpty = (li: HTMLLIElement) => {
    const scratch = li.cloneNode(true) as HTMLLIElement;
    scratch.querySelectorAll('br').forEach((br) => br.remove());
    const text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    return !text && !li.querySelector('img');
  };

  const isLiEffectivelyEmpty = (li: HTMLLIElement) => {
    if (isLiEmpty(li)) return true;
    const scratch = li.cloneNode(true) as HTMLLIElement;
    scratch.querySelectorAll('br').forEach((el) => el.remove());
    scratch.querySelectorAll('p, div, span, b, u, i, strong, em').forEach((el) => {
      const text = (el.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
      if (!text && !el.querySelector('img')) el.remove();
    });
    let text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    text = text.replace(BULLET_PREFIX_RE, '').trim();
    return !text && !li.querySelector('img');
  };

  const LIST_EXIT_INDENT_PROPS = [
    'margin-left',
    'padding-left',
    'text-indent',
    'margin-inline-start',
    'padding-inline-start',
  ] as const;

  const getBlockLevelInsertAfterList = (list: HTMLUListElement | HTMLOListElement, ed: HTMLElement) => {
    let anchor: HTMLElement = list;
    let parent: Node | null = list.parentNode;
    let before: Node | null = list.nextSibling;

    while (parent instanceof HTMLElement && parent !== ed) {
      const wrapper = parent;
      const hasIndent =
        LIST_EXIT_INDENT_PROPS.some((prop) => wrapper.style.getPropertyValue(prop))
        || [...wrapper.classList].some((cls) => /mso/i.test(cls));
      const onlyListContent = [...wrapper.children].every((child) => {
        if (child === anchor) return true;
        if (child instanceof HTMLElement && LIST_TAGS.has(child.tagName)) return true;
        if (child instanceof HTMLElement) {
          const text = child.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim() ?? '';
          return !text && !child.querySelector('img');
        }
        return !(child.textContent?.replace(/\u200B/g, '').trim());
      });
      if (hasIndent && onlyListContent && wrapper.parentNode) {
        before = wrapper.nextSibling;
        anchor = wrapper;
        parent = wrapper.parentNode;
        continue;
      }
      break;
    }

    return { parent: parent ?? ed, before };
  };

  const stripNewParagraphIndent = (block: HTMLElement) => {
    for (const prop of LIST_EXIT_INDENT_PROPS) {
      block.style.removeProperty(prop);
    }
    block.style.removeProperty('list-style-type');
    block.style.removeProperty('display');
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (first?.nodeType === Node.TEXT_NODE) {
      const text = first.textContent ?? '';
      const stripped = text.replace(/^[\s\u00a0\u2002\u2003]+/, '');
      if (stripped !== text) first.textContent = stripped;
    }
  };

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

  const insertEmptyListItemBefore = (li: HTMLLIElement) => {
    const newLi = document.createElement('li');
    newLi.setAttribute('dir', 'auto');
    newLi.innerHTML = '<br>';
    li.parentNode?.insertBefore(newLi, li);
    placeCaretInBlock(newLi, true);
  };

  /** Normal margin line above a list item — keeps the item (with bullet) below the new line. */
  const insertNormalLineAboveListItem = (li: HTMLLIElement, ed: HTMLElement) => {
    const list = li.parentElement;
    if (!list || !LIST_TAGS.has(list.tagName)) return;

    if (li === list.firstElementChild) {
      insertEmptyLineAboveBlock(ed, list);
      return;
    }

    const listEl = list as HTMLUListElement | HTMLOListElement;
    const parent = list.parentNode;
    if (!parent) return;
    const ordered = listEl.tagName === 'OL';

    const beforeItems: HTMLLIElement[] = [];
    const fromItems: HTMLLIElement[] = [];
    let reached = false;
    for (const child of [...list.children]) {
      if (!(child instanceof HTMLLIElement)) continue;
      if (child === li) {
        reached = true;
        fromItems.push(child);
      } else if (!reached) {
        beforeItems.push(child);
      } else {
        fromItems.push(child);
      }
    }

    const div = document.createElement('div');
    div.setAttribute('dir', 'auto');
    div.innerHTML = '<br>';
    stripNewParagraphIndent(div);

    const makeList = (items: HTMLLIElement[]) => {
      const el = document.createElement(ordered ? 'ol' : 'ul');
      el.setAttribute('dir', 'auto');
      items.forEach((item) => el.appendChild(item));
      return el;
    };

    fromItems.forEach((item) => item.remove());
    parent.insertBefore(div, list.nextSibling);
    if (fromItems.length > 0) parent.insertBefore(makeList(fromItems), div.nextSibling);
    if (list.children.length === 0) list.remove();
    cleanupEmptyListShell(listEl, ed);
    placeCaretInBlock(div, true);
  };

  const splitListItemAtStart = (li: HTMLLIElement) => {
    insertEmptyListItemBefore(li);
  };

  const getBlockPrefixMatch = (block: HTMLElement): RegExpMatchArray | null => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let firstText = walker.nextNode();
    while (firstText) {
      const raw = firstText.textContent ?? '';
      if (!raw.replace(/[\u200B\uFEFF\s\u00a0]/g, '')) {
        firstText = walker.nextNode();
        continue;
      }
      return raw.match(BULLET_PREFIX_RE);
    }
    return (block.textContent ?? '').match(BULLET_PREFIX_RE);
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
    stripNewParagraphIndent(div);
    const text = div.textContent?.replace(/\u200B/g, '').trim() ?? '';
    if (!text && !div.querySelector('img')) div.innerHTML = '<br>';
    return div;
  };

  /**
   * Fully unwrap a list into left-margin paragraphs.
   * Nested lists become sibling paragraphs (never left stuck inside a parent <li>).
   */
  const unwrapList = (list: HTMLUListElement | HTMLOListElement, caretAtStart = true) => {
    const parent = list.parentNode;
    if (!parent) return null;
    const ed = editorRef.current;
    const frag = document.createDocumentFragment();
    const created: HTMLElement[] = [];

    const flattenLi = (li: HTMLLIElement) => {
      const nestedLists = [...li.children].filter(
        (c): c is HTMLUListElement | HTMLOListElement =>
          c instanceof HTMLElement && LIST_TAGS.has(c.tagName),
      );
      nestedLists.forEach((nested) => nested.remove());
      const div = unwrapListItemToDiv(li);
      if (div.textContent?.replace(/\u200B/g, '').trim() || div.querySelector('img')) {
        frag.appendChild(div);
        created.push(div);
      }
      nestedLists.forEach((nested) => {
        Array.from(nested.children)
          .filter((n): n is HTMLLIElement => n.tagName === 'LI')
          .forEach(flattenLi);
      });
    };

    Array.from(list.children)
      .filter((n): n is HTMLLIElement => n.tagName === 'LI')
      .forEach(flattenLi);

    let insertParent: Node = parent;
    let before: Node | null = list;

    // Nested unwrap: parent is an LI — lift paragraphs out to after the outer list.
    if (parent instanceof HTMLLIElement && ed) {
      const outerList = parent.parentElement;
      if (outerList && LIST_TAGS.has(outerList.tagName)) {
        const { parent: liftParent, before: liftBefore } = getBlockLevelInsertAfterList(
          outerList as HTMLUListElement | HTMLOListElement,
          ed,
        );
        insertParent = liftParent;
        before = liftBefore;
        const afterItems = [...outerList.children].filter(
          (child): child is HTMLLIElement =>
            child instanceof HTMLLIElement
            && !!(parent.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING),
        );
        list.remove();
        if (!parent.textContent?.replace(/\u200B/g, '').trim() && !parent.querySelector('img, ul, ol')) {
          parent.remove();
        }
        insertParent.insertBefore(frag, before);
        if (afterItems.length > 0) {
          const ordered = outerList.tagName === 'OL';
          const afterList = document.createElement(ordered ? 'ol' : 'ul');
          afterList.setAttribute('dir', 'auto');
          afterItems.forEach((item) => afterList.appendChild(item));
          insertParent.insertBefore(afterList, before);
        }
        if (outerList.isConnected && outerList.children.length === 0) outerList.remove();
        const target = created[0] ?? null;
        if (target) placeCaretInBlock(target, caretAtStart);
        return target;
      }
    }

    insertParent.insertBefore(frag, before);
    list.remove();
    const target = created[0] ?? null;
    if (target) placeCaretInBlock(target, caretAtStart);
    return target;
  };

  /** Exit the current line fully out of every ancestor list → same margin as headings. */
  const exitListItemToMargin = (
    li: HTMLLIElement,
    ed: HTMLElement,
    caretAtStart = true,
  ): HTMLDivElement | null => {
    // Prefer innermost block inside the li when the caret sits in a stuck nested div/p
    // (no bullet of its own, still list-indented).
    const sel = window.getSelection();
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
    if (range && li.contains(range.startContainer)) {
      const inner = getStuckInnerBlockInListItem(li, range, ed);
      if (inner && inner !== li) {
        const div = extractInnerBlockFromListToRoot(inner, ed);
        if (div) {
          placeCaretInBlock(div, caretAtStart);
          return div;
        }
      }
    }

    const div = extractListItemToRootParagraph(li, ed);
    if (!div) return null;
    placeCaretInBlock(div, caretAtStart);
    return div;
  };

  const liftBlockToEditorMargin = (block: HTMLElement, ed: HTMLElement) => {
    if (block.closest('li, ul, ol')) {
      extractInnerBlockFromListToRoot(block, ed);
      return;
    }
    forceParagraphToContentMargin(block, ed);
  };

  const exitListItem = (li: HTMLLIElement, ed: HTMLElement, caretAtStart: boolean) => {
    exitListItemToMargin(li, ed, caretAtStart);
    saveSel();
  };

  const isLastListItem = (li: HTMLLIElement) => {
    const list = li.parentElement;
    if (!list || !LIST_TAGS.has(list.tagName)) return false;
    let next = li.nextElementSibling;
    while (next) {
      if (next.tagName === 'LI') return false;
      next = next.nextElementSibling;
    }
    return true;
  };

  const cleanupEmptyListShell = (list: HTMLUListElement | HTMLOListElement, ed: HTMLElement) => {
    if (list.children.length > 0) return;
    const listParent = list.parentElement;
    list.remove();
    if (listParent instanceof HTMLElement && listParent !== ed) {
      const hasIndent =
        LIST_EXIT_INDENT_PROPS.some((prop) => listParent.style.getPropertyValue(prop))
        || [...listParent.classList].some((cls) => /mso/i.test(cls));
      const isEmpty = [...listParent.childNodes].every((node) => {
        if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim();
        if (node instanceof HTMLElement) {
          return !node.textContent?.replace(/\u200B/g, '').trim() && !node.querySelector('img');
        }
        return true;
      });
      if (hasIndent && isEmpty) listParent.remove();
    }
  };

  const insertParagraphAtMargin = (parent: Node, before: Node | null) => {
    const div = document.createElement('div');
    div.setAttribute('dir', 'auto');
    div.innerHTML = '<br>';
    parent.insertBefore(div, before);
    stripNewParagraphIndent(div);
    placeCaretInBlock(div, true);
    return div;
  };

  const focusParagraphAfterList = (list: HTMLUListElement | HTMLOListElement, ed: HTMLElement) => {
    const next = list.nextElementSibling;
    if (
      next instanceof HTMLElement
      && !LIST_TAGS.has(next.tagName)
      && BLOCK_TAGS.has(next.tagName)
      && isEmptyTextLine(next)
    ) {
      placeCaretInBlock(next, true);
      return next;
    }
    const { parent, before } = getBlockLevelInsertAfterList(list, ed);
    return insertParagraphAtMargin(parent, before);
  };

  const findListBeforeBlock = (block: HTMLElement): HTMLUListElement | HTMLOListElement | null => {
    let prev = block.previousElementSibling;
    while (prev instanceof HTMLElement) {
      if (LIST_TAGS.has(prev.tagName)) return prev as HTMLUListElement | HTMLOListElement;
      if (BLOCK_TAGS.has(prev.tagName) || prev.tagName === 'HR') return null;
      prev = prev.previousElementSibling;
    }
    return null;
  };

  /** From an empty line after a list, move to the last list line (not the heading above the list). */
  const focusLineAboveAfterListParagraph = (block: HTMLElement): boolean => {
    if (!blockFollowsList(block)) return false;
    const blockEmpty = !block.textContent?.replace(/\u200B/g, '').trim() && !block.querySelector('img');
    // Never steal a non-empty selection/line (e.g. selecting "2"/"3" after a list).
    if (!blockEmpty) return false;
    const listEl = findListBeforeBlock(block);
    if (!listEl) return false;

    // Immediate line above = last <li>, never jump to the heading before the list.
    const lastLi = listEl.querySelector(':scope > li:last-child');
    const target =
      lastLi instanceof HTMLLIElement
        ? lastLi
        : (listEl.previousElementSibling instanceof HTMLElement
          && BLOCK_TAGS.has(listEl.previousElementSibling.tagName)
          && listEl.previousElementSibling.tagName !== 'LI'
          ? listEl.previousElementSibling
          : null);
    if (!target) return false;

    block.remove();
    pendingListMarginExitRef.current = null;
    placeCaretInBlock(target, false);
    return true;
  };

  const backspaceEmptyListItem = (li: HTMLLIElement, ed: HTMLElement) => {
    pendingListMarginExitRef.current = null;
    handleEmptyListItemBackspace(li, ed);
  };

  /** Step 2 of staged list exit: Backspace after removing trailing empty bullet → margin paragraph. */
  const tryCompletePendingListMarginExit = (range: Range, ed: HTMLElement): boolean => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return false;
    const li = resolveListItemAtSelection(range, ed);
    if (!li) return false;
    const pending = pendingListMarginExitRef.current;
    if (
      pending?.isConnected
      && pending.contains(li)
      && isLastListItem(li)
    ) {
      focusParagraphAfterList(pending, ed);
      pendingListMarginExitRef.current = null;
      saveSel();
      readCommandState();
      emitHtml();
      return true;
    }
    return false;
  };

  const promoteEmptyListItemToMarginParagraph = (li: HTMLLIElement, ed: HTMLElement) => {
    const list = li.parentElement;
    if (!list || !LIST_TAGS.has(list.tagName)) return;
    const parent = list.parentNode;
    if (!parent) return;

    const listEl = list as HTMLUListElement | HTMLOListElement;
    const ordered = listEl.tagName === 'OL';
    const div = document.createElement('div');
    div.setAttribute('dir', 'auto');
    div.innerHTML = '<br>';
    stripNewParagraphIndent(div);

    const beforeItems: HTMLLIElement[] = [];
    const afterItems: HTMLLIElement[] = [];
    let passed = false;
    for (const child of [...list.children]) {
      if (child === li) { passed = true; continue; }
      if (child instanceof HTMLLIElement) {
        if (!passed) beforeItems.push(child);
        else afterItems.push(child);
      }
    }
    li.remove();

    const makeList = (items: HTMLLIElement[]) => {
      const el = document.createElement(ordered ? 'ol' : 'ul');
      el.setAttribute('dir', 'auto');
      items.forEach((item) => el.appendChild(item));
      return el;
    };

    if (beforeItems.length > 0) parent.insertBefore(makeList(beforeItems), list);
    parent.insertBefore(div, list);
    if (afterItems.length > 0) parent.insertBefore(makeList(afterItems), list);
    list.remove();
    cleanupEmptyListShell(listEl, ed);
    pendingListMarginExitRef.current = null;
    placeCaretInBlock(div, true);
  };

  const handleEmptyListItemBackspace = (li: HTMLLIElement, ed: HTMLElement) => {
    pendingListMarginExitRef.current = null;
    if (isNestedListItem(li)) {
      returnToParentListItem(li);
    } else {
      // Backspace 1: strip the bullet and land on a normal margin line (same as Rubrik).
      // Backspace 2 (on that empty line): move to the line above.
      exitListItemToMargin(li, ed, true);
    }
    saveSel();
    readCommandState();
    emitHtml();
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

  const isNestedListItem = (li: HTMLLIElement) => {
    const list = li.parentElement;
    return !!list && LIST_TAGS.has(list.tagName) && list.parentElement?.closest('li') instanceof HTMLLIElement;
  };

  /** Nested items can outdent one level; top-level items can exit to a margin paragraph. */
  const canOutdentListItem = (li: HTMLLIElement) => !!li.parentElement && LIST_TAGS.has(li.parentElement.tagName);

  const canIndentListItem = (li: HTMLLIElement) => li.previousElementSibling instanceof HTMLLIElement;

  /** Promote a nested item to the parent list (sibling after its parent line). */
  const returnToParentListItem = (li: HTMLLIElement): boolean => {
    if (!isNestedListItem(li)) return false;
    return outdentListItem(li);
  };

  /** Shift+Tab / Remove list: always fully exit to heading margin (not one nest level). */
  const outdentOrExitListItem = (li: HTMLLIElement, ed: HTMLElement): boolean => {
    return !!exitListItemToMargin(li, ed, true);
  };

  /**
   * Word/Docs-style Backspace at start of a list line:
   * nested → outdent one level; top-level / stuck inner block → full exit to heading margin.
   */
  const backspaceOutdentOrExitListItem = (
    li: HTMLLIElement,
    ed: HTMLElement,
    range: Range,
  ): boolean => {
    if (isLiEffectivelyEmpty(li)) {
      backspaceEmptyListItem(li, ed);
      return true;
    }

    if (isCaretAtStartOfLi(li, range)) {
      pendingListMarginExitRef.current = null;
      if (isNestedListItem(li)) {
        if (!returnToParentListItem(li)) exitListItemToMargin(li, ed, true);
      } else {
        exitListItemToMargin(li, ed, true);
      }
      saveSel();
      readCommandState();
      emitHtml();
      return true;
    }

    // Stuck indented body line inside an li (no bullet of its own).
    const stuckInner = getStuckInnerBlockInListItem(li, range, ed);
    if (stuckInner && isCaretAtStartOfBlock(stuckInner, range)) {
      pendingListMarginExitRef.current = null;
      exitListItemToMargin(li, ed, true);
      saveSel();
      readCommandState();
      emitHtml();
      return true;
    }

    return false;
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
    if (!li) return;
    // Dedicated outdent control: one nest level when nested; otherwise full exit.
    if (isNestedListItem(li)) {
      if (!outdentListItem(li)) return;
    } else if (!exitListItemToMargin(li, ed, true)) {
      return;
    }
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

  const stripPseudoBulletLine = (block: HTMLElement) => {
    stripBulletPrefixFromBlock(block);
    placeCaretInBlock(block, true);
    saveSel();
    readCommandState();
    emitHtml();
  };

  const tryPseudoBulletBackspace = (range: Range, ed: HTMLElement) => {
    const block = getLineBlock(range.startContainer, ed);
    if (!block || block.tagName === 'LI' || block.closest('li')) return false;
    const match = getBlockPrefixMatch(block);
    if (!match) return false;

    const afterPrefix = (block.textContent ?? '').replace(BULLET_PREFIX_RE, '').replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim();
    // Empty "•" line, or caret in the "• " zone / start → remove the stuck bullet marker.
    if (
      !afterPrefix
      || isCaretAtStartOfBlock(block, range)
      || isCaretInBulletPrefixZone(block, range)
    ) {
      stripBulletPrefixFromBlock(block);
      // Sibling ChatGPT lines become a real ul/ol (same as after "frisätts").
      convertPseudoBulletBlocksToNativeLists(ed);
      if (block.isConnected) placeCaretInBlock(block, true);
      else {
        const sel = window.getSelection();
        if (sel?.rangeCount) {
          const li = resolveListItemAtSelection(sel.getRangeAt(0), ed);
          if (li) placeCaretInBlock(li, true);
        }
      }
      saveSel();
      readCommandState();
      emitHtml();
      return true;
    }
    return false;
  };

  /** Turn any leftover "• text" / "- text" blocks into the same native lists as the toolbar. */
  const promotePseudoListsToNative = (ed: HTMLElement): boolean => {
    if (!convertPseudoBulletBlocksToNativeLists(ed)) return false;
    ed.querySelectorAll('ul, ol, li').forEach((el) => {
      el.setAttribute('dir', 'auto');
      if (el instanceof HTMLElement) {
        el.style.removeProperty('text-align');
        el.removeAttribute('align');
      }
    });
    return true;
  };

  const isEditorContentEmpty = (ed: HTMLElement) => {
    const scratch = ed.cloneNode(true) as HTMLElement;
    scratch.querySelectorAll('br').forEach((br) => br.remove());
    let text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    text = text.replace(BULLET_PREFIX_RE, '').trim();
    return !text && !ed.querySelector('img');
  };

  /** After select-all delete or paste cleanup, drop empty list shells that still show a bullet. */
  const cleanupOrphanEmptyLists = (ed: HTMLElement): boolean => {
    if (ed.querySelector('img')) return false;
    if (!ed.querySelector('ul, ol')) return false;

    const allLis = Array.from(ed.querySelectorAll('li'));
    const hasNonEmptyLi = allLis.some(
      (li) => !isLiEffectivelyEmpty(li as HTMLLIElement),
    );
    if (!shouldRemoveOrphanEmptyLists(allLis.length, hasNonEmptyLi)) return false;

    const hasNonListText = Array.from(ed.childNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return !!node.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ').replace(BULLET_PREFIX_RE, '').trim();
      }
      if (!(node instanceof HTMLElement)) return false;
      if (LIST_TAGS.has(node.tagName)) return false;
      const scratch = node.cloneNode(true) as HTMLElement;
      scratch.querySelectorAll('br').forEach((br) => br.remove());
      const text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').replace(BULLET_PREFIX_RE, '').trim();
      return !!text;
    });
    if (hasNonListText) return false;

    ed.querySelectorAll('ul, ol').forEach((list) => list.remove());
    if (isEditorContentEmpty(ed)) {
      ed.innerHTML = '<div dir="auto"><br></div>';
      placeCaretInBlock(ed.firstElementChild as HTMLElement, true);
      return true;
    }
    return false;
  };

  const hasStuckBullet = (range: Range, ed: HTMLElement) => {
    const block = getLineBlock(range.startContainer, ed);
    if (block && block.tagName !== 'LI' && !block.closest('li')) {
      const match = getBlockPrefixMatch(block);
      if (match) {
        const afterPrefix = (block.textContent ?? '').replace(BULLET_PREFIX_RE, '').replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim();
        if (!afterPrefix) return true;
      }
    }
    const li = resolveListItemAtSelection(range, ed);
    if (li && isLiEffectivelyEmpty(li)) return true;
    const list = li?.parentElement;
    if (li && list && LIST_TAGS.has(list.tagName) && list.children.length === 1 && isEditorContentEmpty(ed)) {
      return true;
    }
    return false;
  };

  const tryRemoveStuckBullet = (range: Range, ed: HTMLElement) => {
    // Collapsed caret only — never steal a multi-line selection.
    if (!range.collapsed) return false;
    if (tryPseudoBulletBackspace(range, ed)) return true;

    const li = resolveListItemAtSelection(range, ed);
    if (li) {
      if (isLiEffectivelyEmpty(li)) {
        if (tryCompletePendingListMarginExit(range, ed)) return true;
        backspaceEmptyListItem(li, ed);
        return true;
      }
      const list = li.parentElement;
      if (list && LIST_TAGS.has(list.tagName) && list.children.length === 1 && isEditorContentEmpty(ed)) {
        unwrapList(list as HTMLUListElement | HTMLOListElement, true);
        saveSel();
        readCommandState();
        emitHtml();
        return true;
      }
    }
    return false;
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

    // Lists inside table cells: wrap/toggle list content within the cell only.
    const cell = closestTableCell(range.startContainer) ?? closestTableCell(range.endContainer);
    if (cell && ed.contains(cell)) {
      const existing = cell.querySelector(':scope > ul, :scope > ol');
      if (existing instanceof HTMLUListElement || existing instanceof HTMLOListElement) {
        const isOrdered = existing.tagName === 'OL';
        if (isOrdered === ordered) {
          unwrapList(existing);
        } else {
          const newList = document.createElement(ordered ? 'ol' : 'ul');
          newList.setAttribute('dir', 'auto');
          while (existing.firstChild) newList.appendChild(existing.firstChild);
          existing.replaceWith(newList);
        }
      } else {
        const list = document.createElement(ordered ? 'ol' : 'ul');
        list.setAttribute('dir', 'auto');
        const li = document.createElement('li');
        li.setAttribute('dir', 'auto');
        while (cell.firstChild) li.appendChild(cell.firstChild);
        stripBulletPrefixFromLi(li);
        if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
          li.innerHTML = '<br>';
        }
        list.appendChild(li);
        cell.appendChild(list);
        placeCaretInBlock(li, isLiEmpty(li));
      }
      saveSel();
      readCommandState();
      emitHtml();
      setListPalOpen(false);
      return;
    }

    const caretList = getListContainer(sel.anchorNode, ed);

    if (caretList) {
      const isOrdered = caretList.tagName === 'OL';
      if (isOrdered === ordered) {
        removeListFormatting();
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

    listMenuBlockRef.current = null;
    // Always resolve from the live caret range and isolate the visual line.
    // Preferring listMenuBlockRef skipped isolation when Enter kept
    // "rubrik<br>|" in one div, so the heading got wrapped into the list.
    let activeBlock = isolateLineBlockForList(range, ed);
    if (!activeBlock || activeBlock === ed || activeBlock.tagName === 'LI' || activeBlock.closest('li')) {
      activeBlock = ensureBlockAtRange(ed, sel.getRangeAt(0));
    }
    // Expand to adjacent ChatGPT-style "• …" siblings so one toggle covers the whole paste.
    const blocksForList = (() => {
      const seedPrefix = getBlockPrefixMatch(activeBlock);
      if (!seedPrefix) return [activeBlock];
      const seedOrdered = isNumberedPrefix(seedPrefix);
      const group: HTMLElement[] = [activeBlock];
      let prev = activeBlock.previousElementSibling;
      while (prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName) && prev.tagName !== 'LI' && !prev.closest('li')) {
        const match = getBlockPrefixMatch(prev);
        if (!match || isNumberedPrefix(match) !== seedOrdered) break;
        group.unshift(prev);
        prev = prev.previousElementSibling;
      }
      let next = activeBlock.nextElementSibling;
      while (next instanceof HTMLElement && BLOCK_TAGS.has(next.tagName) && next.tagName !== 'LI' && !next.closest('li')) {
        const match = getBlockPrefixMatch(next);
        if (!match || isNumberedPrefix(match) !== seedOrdered) break;
        group.push(next);
        next = next.nextElementSibling;
      }
      return group;
    })();
    // Non-empty prose line: keep the word as-is and start an empty list under it.
    // Also hard-guard against wrapping any prose blocks when the caret is below them.
    const proseAnchor =
      shouldStartListBelowBlock(activeBlock, blocksForList)
        ? activeBlock
        : proseAnchorToKeepOutOfList(blocksForList);
    if (proseAnchor && !blockHasListableContent(activeBlock)) {
      // Caret is on an empty line under/near prose — convert only empty targets.
      const emptyTargets = blocksForList.filter((b) => !blockHasListableContent(b));
      if (emptyTargets.length > 0) {
        convertBlocksToList(emptyTargets, ordered, activeBlock);
        saveSel();
        readCommandState();
        emitHtml();
        setListPalOpen(false);
        return;
      }
    }
    if (proseAnchor) {
      const li = insertEmptyListAfterBlock(proseAnchor, ordered);
      placeCaretInBlock(li, true);
      saveSel();
      readCommandState();
      emitHtml();
      setListPalOpen(false);
      return;
    }
    convertBlocksToList(blocksForList, ordered, activeBlock);
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

    // Prefer exiting only the caret / selected items so sibling bullets stay intact.
    const startLi = resolveListItemAtSelection(range, ed);
    const endLi = getListItem(range.endContainer, ed) ?? startLi;
    if (startLi && endLi) {
      const items = collectListItemsBetween(startLi, endLi);
      // Exit last→first so earlier indices stay valid while splitting lists.
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.isConnected) exitListItemToMargin(item, ed, i === 0);
      }
      saveSel();
      readCommandState();
      emitHtml();
      return;
    }

    // Caret in a stuck block inside a list shell (div inside li / indented wrapper).
    const stuckBlock = getLineBlock(range.startContainer, ed);
    if (stuckBlock && stuckBlock.tagName !== 'LI') {
      const parentLi = stuckBlock.closest('li');
      if (parentLi instanceof HTMLLIElement && ed.contains(parentLi)) {
        exitListItemToMargin(parentLi, ed, true);
        saveSel();
        readCommandState();
        emitHtml();
        return;
      }
      stripNewParagraphIndent(stuckBlock);
      liftBlockToEditorMargin(stuckBlock, ed);
      stripNewParagraphIndent(stuckBlock);
      placeCaretInBlock(stuckBlock, true);
      saveSel();
      readCommandState();
      emitHtml();
      return;
    }

    const lists = new Set<HTMLUListElement | HTMLOListElement>();
    ed.querySelectorAll('ul, ol').forEach((node) => {
      try {
        if (range.intersectsNode(node)) lists.add(node as HTMLUListElement | HTMLOListElement);
      } catch { /* detached */ }
    });
    const caretList = getListContainer(sel.anchorNode, ed);
    if (caretList) lists.add(caretList);

    if (lists.size > 0) {
      [...lists].forEach((list) => {
        if (list.isConnected) unwrapList(list);
      });
    } else {
      collectBlocksInRange(ed, range).forEach((block) => {
        stripBulletPrefixFromBlock(block);
        stripNewParagraphIndent(block);
      });
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
    const cell = closestTableCell(el);
    let nestedBlock: HTMLElement | null = null;
    while (el instanceof HTMLElement && el !== ed) {
      // Table / media chrome is a DIV but must never be treated as a text line —
      // Enter/Backspace through a contenteditable=false image frame white-screens.
      if (
        el.classList.contains(NOTE_TABLE_WRAP)
        || el.classList.contains(NOTE_TABLE_BODY)
        || el.classList.contains(NOTE_TABLE_TOOLBAR_HOST)
        || el.classList.contains(NOTE_IMG_FRAME)
        || el.classList.contains(NOTE_YT_FRAME)
      ) {
        nestedBlock = null;
        el = el.parentElement;
        continue;
      }
      if (el.tagName === 'CENTER') return el;
      // Prefer the list item over ChatGPT's nested <p>/<div> inside <li>.
      if (el.tagName === 'LI') return el;
      if (BLOCK_TAGS.has(el.tagName) && !nestedBlock) nestedBlock = el;
      if (cell && el === cell) break;
      el = el.parentElement;
    }
    return nestedBlock;
  };

  const getAlignmentTargetBlock = (node: Node | null, ed: HTMLElement): HTMLElement | null => {
    const cell = closestTableCell(node);
    if (cell && ed.contains(cell)) return cell;

    let el: Node | null = node;
    if (el?.nodeType === Node.TEXT_NODE) el = el.parentElement;
    let innermost: HTMLElement | null = null;
    let outermostAligned: HTMLElement | null = null;
    while (el instanceof HTMLElement && el !== ed) {
      if (
        el.classList.contains(NOTE_TABLE_WRAP)
        || el.classList.contains(NOTE_TABLE_BODY)
        || el.classList.contains(NOTE_TABLE_TOOLBAR_HOST)
      ) {
        break;
      }
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
    const inline = (block.style.textAlign || block.getAttribute('align') || '').toLowerCase();
    if (inline === 'center') return 'center';
    if (inline === 'right' || inline === 'end') return 'right';
    if (inline === 'left' || inline === 'start') return 'left';
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

    // Never hijack clicks inside tables — let the browser place the caret in the cell.
    const hitEl = targetNode.nodeType === Node.TEXT_NODE ? targetNode.parentElement : (targetNode as Element | null);
    if (hitEl?.closest?.(`td, th, table, .${NOTE_TABLE_WRAP}, .${NOTE_TABLE_TOOLBAR_HOST}`)) return;

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

  const LIST_PASTE_INDENT_PROPS = [
    'margin-left',
    'padding-left',
    'text-indent',
    'margin-inline-start',
    'padding-inline-start',
  ] as const;

  const blockFollowsList = (block: HTMLElement) => {
    let prev = block.previousElementSibling;
    while (prev) {
      if (LIST_TAGS.has(prev.tagName)) return true;
      if (BLOCK_TAGS.has(prev.tagName) || prev.tagName === 'HR') return false;
      prev = prev.previousElementSibling;
    }
    return false;
  };

  const stripLeadingIndentChars = (block: HTMLElement) => {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (!first || first.nodeType !== Node.TEXT_NODE) return false;
    const text = first.textContent ?? '';
    const stripped = text.replace(/^[\s\u00a0\u2002\u2003]+/, '');
    if (stripped === text) return false;
    first.textContent = stripped;
    return true;
  };

  const stripListPasteIndent = (block: HTMLElement, afterList = false): boolean => {
    if (block.closest('li, ul, ol')) return false;
    let changed = false;
    for (const prop of LIST_PASTE_INDENT_PROPS) {
      if (block.style.getPropertyValue(prop)) {
        block.style.removeProperty(prop);
        changed = true;
      }
    }
    if (block.style.listStyleType || block.style.display === 'list-item') {
      block.style.removeProperty('list-style-type');
      block.style.removeProperty('display');
      changed = true;
    }
    if ([...block.classList].some((cls) => /mso/i.test(cls))) {
      block.className = block.className.replace(/\bMso\S+/g, '').trim();
      changed = true;
    }
    if (!block.getAttribute('class')) block.removeAttribute('class');
    if (!block.getAttribute('style')?.trim()) block.removeAttribute('style');
    if (afterList && stripLeadingIndentChars(block)) changed = true;
    return changed;
  };

  const unwrapTrailingContentFromLastListItem = (ed: HTMLElement) => {
    ed.querySelectorAll('ul, ol').forEach((list) => {
      const lastLi = list.querySelector(':scope > li:last-child');
      if (!(lastLi instanceof HTMLLIElement)) return;
      let splitNode: ChildNode | null = null;
      for (const child of [...lastLi.childNodes]) {
        if (child instanceof HTMLElement && (child.tagName === 'HR' || (BLOCK_TAGS.has(child.tagName) && child !== lastLi.firstElementChild))) {
          splitNode = child;
          break;
        }
      }
      if (!splitNode) return;
      const parent = list.parentNode;
      if (!parent) return;
      const moved: ChildNode[] = [];
      let node: ChildNode | null = splitNode;
      while (node) {
        const next: ChildNode | null = node.nextSibling;
        moved.push(node);
        node = next;
      }
      const fragment = document.createDocumentFragment();
      moved.forEach((node) => {
        if (node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName)) {
          stripListPasteIndent(node, true);
          fragment.appendChild(node);
          return;
        }
        if (node instanceof HTMLElement && node.tagName === 'HR') {
          fragment.appendChild(node);
          return;
        }
        const div = document.createElement('div');
        div.setAttribute('dir', 'auto');
        div.appendChild(node);
        stripListPasteIndent(div, true);
        fragment.appendChild(div);
      });
      parent.insertBefore(fragment, list.nextSibling);
      if (isLiEmpty(lastLi)) {
        lastLi.remove();
        if (!list.children.length) list.remove();
      }
    });
  };

  const normalizePastedBlocks = (ed: HTMLElement) => {
    unwrapTrailingContentFromLastListItem(ed);
    ed.querySelectorAll<HTMLElement>('div, p, li, ul, ol').forEach((block) => {
      if (block.tagName === 'UL' || block.tagName === 'OL') return;
      if (block.style.textAlign === 'right' || block.style.textAlign === 'end' || block.style.textAlign === 'center') {
        block.style.removeProperty('text-align');
      }
      block.removeAttribute('align');
      if (block.closest('li, ul, ol')) return;
      stripListPasteIndent(block, blockFollowsList(block));
    });
    // ChatGPT/etc. paste bullets as plain "• text" in div/p — promote to real lists.
    convertPseudoBulletBlocksToNativeLists(ed);
  };

  const ensureLeftMarginAfterList = (block: HTMLElement) => {
    if (block.closest('li, ul, ol')) return false;
    if (!blockFollowsList(block) && !LIST_PASTE_INDENT_PROPS.some((prop) => block.style.getPropertyValue(prop))) {
      return false;
    }
    return stripListPasteIndent(block, blockFollowsList(block));
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

  /** True when a node is meaningful content besides an image/youtube frame. */
  const nodeIsNonEmbedContent = (node: Node, embed: HTMLElement): boolean => {
    if (node === embed) return false;
    if (node.nodeType === Node.TEXT_NODE) {
      return !!(node.textContent ?? '').replace(/[\u200B\uFEFF\s\u00a0]/g, '').trim();
    }
    if (!(node instanceof HTMLElement)) return false;
    if (node.tagName === 'BR') return false;
    if (
      node.classList.contains(NOTE_IMG_TOOLBAR_HOST)
      || node.classList.contains(NOTE_YT_REMOVE)
      || node.classList.contains(NOTE_IMG_FRAME)
      || node.classList.contains(NOTE_YT_FRAME)
    ) {
      return false;
    }
    return true;
  };

  /**
   * Pull an embed frame out of a text block so Enter never splits through
   * contenteditable=false media (that path crashes Chromium / blanks React).
   */
  const extractEmbedFromTextBlock = (frame: HTMLElement, ed: HTMLElement): HTMLElement => {
    const parent = frame.parentElement;
    if (!parent || parent === ed || !ed.contains(frame)) return frame;
    if (parent.classList.contains(NOTE_IMG_FRAME) || parent.classList.contains(NOTE_YT_FRAME)) return frame;

    const hasOther = [...parent.childNodes].some((n) => nodeIsNonEmbedContent(n, frame));
    if (!hasOther) return frame;

    const grand = parent.parentNode;
    if (!grand) return frame;

    let sawFrame = false;
    let contentBefore = false;
    for (const n of parent.childNodes) {
      if (n === frame) { sawFrame = true; continue; }
      if (!nodeIsNonEmbedContent(n, frame)) continue;
      if (!sawFrame) contentBefore = true;
    }

    if (contentBefore) {
      // text … frame → keep text in parent, place frame after parent
      grand.insertBefore(frame, parent.nextSibling);
    } else {
      // frame … text → place frame before parent, leave text behind
      grand.insertBefore(frame, parent);
    }
    // Drop a leftover empty wrapper.
    const leftover = (parent.textContent ?? '').replace(/[\u200B\uFEFF\s\u00a0]/g, '').trim();
    if (!leftover && !parent.querySelector('img, iframe, table, .note-img-frame, .note-yt-frame, .note-table-wrap')) {
      while (parent.firstChild) grand.insertBefore(parent.firstChild, parent);
      parent.remove();
    }
    return frame;
  };

  const separateEmbedsFromTextBlocks = (ed: HTMLElement) => {
    ed.querySelectorAll(`.${NOTE_IMG_FRAME}, .${NOTE_YT_FRAME}`).forEach((node) => {
      if (node instanceof HTMLElement) extractEmbedFromTextBlock(node, ed);
    });
  };

  const ensureStandaloneImageBlock = (img: HTMLImageElement, ed: HTMLElement): HTMLElement => {
    const frame = ensureImageFrame(img, ed);
    return extractEmbedFromTextBlock(frame, ed);
  };

  const applyImageAlignment = (img: HTMLImageElement, align: BlockAlign) => {
    const ed = editorRef.current;
    if (!ed) return;
    const frame = ensureImageFrame(img, ed);
    frame.style.display = 'block';
    frame.style.maxWidth = '100%';
    // Keep author-chosen width (% or px); only default to fit-content when unset.
    if (!frame.style.width) frame.style.width = 'fit-content';
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
      if (idx <= 0) {
        insertEmptyLineAboveBlock(ed, frame);
        requestAnimationFrame(() => {
          if (img.isConnected) setHoveredImg(syncHoveredImg(img, ensureImageFrame(img, ed)));
        });
        return;
      }
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

  /** Swap the table wrap with the previous/next sibling block (same idea as image move). */
  const moveTableVertically = (wrap: HTMLElement, direction: 'up' | 'down') => {
    const ed = editorRef.current;
    if (!ed || !wrap.isConnected || !ed.contains(wrap)) return;
    const parent = wrap.parentElement;
    if (!parent) return;
    const siblings = Array.from(parent.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    const idx = siblings.indexOf(wrap);
    if (idx < 0) return;

    const ctx = getWorkingTableContext(wrap);
    const restore = ctx
      ? { table: ctx.table, rowIndex: ctx.rowIndex, colIndex: ctx.colIndex }
      : null;

    if (direction === 'up') {
      if (idx <= 0) {
        // Already at top — create/focus a line above (parity with images).
        insertEmptyLineAboveBlock(ed, wrap);
        if (restore?.table.isConnected) {
          const next = resolveTableContextAt(restore.table, restore.rowIndex, restore.colIndex, ed);
          if (next) {
            placeCaretInTableCell(next.cell);
            showTableToolbar(next);
          }
        }
        ed.focus({ preventScroll: true });
        saveSel();
        syncVisibleTableWraps();
        return;
      }
      parent.insertBefore(wrap, siblings[idx - 1]);
    } else if (idx < siblings.length - 1) {
      parent.insertBefore(siblings[idx + 1], wrap);
    } else {
      const tail = document.createElement('div');
      tail.setAttribute('dir', 'auto');
      tail.innerHTML = '<br>';
      parent.appendChild(tail);
    }

    if (restore?.table.isConnected) {
      const next = resolveTableContextAt(restore.table, restore.rowIndex, restore.colIndex, ed);
      if (next) {
        placeCaretInTableCell(next.cell);
        showTableToolbar(next);
      }
    }
    ed.focus({ preventScroll: true });
    saveSel();
    emitHtml();
    syncVisibleTableWraps();
  };

  const isEmptyTextLine = (el: HTMLElement) => {
    const text = el.textContent?.replace(/\u200B/g, '').trim() ?? '';
    return !text && !el.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame');
  };

  const insertEmptyLineAboveBlock = (ed: HTMLElement, block: HTMLElement) => {
    if (!block.parentElement || !ed.contains(block)) return;
    const prev = block.previousElementSibling;
    if (prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName) && isEmptyTextLine(prev)) {
      placeCaretInBlock(prev, true);
      ed.focus({ preventScroll: true });
      saveSel();
      emitHtml();
      return;
    }
    const line = document.createElement('div');
    line.setAttribute('dir', 'auto');
    line.innerHTML = '<br>';
    block.parentElement.insertBefore(line, block);
    placeCaretInBlock(line, true);
    ed.focus({ preventScroll: true });
    saveSel();
    emitHtml();
  };

  const insertEmptyLineBelowBlock = (ed: HTMLElement, block: HTMLElement) => {
    if (!block.parentElement || !ed.contains(block)) return;
    const next = block.nextElementSibling;
    if (next instanceof HTMLElement && BLOCK_TAGS.has(next.tagName) && isEmptyTextLine(next)) {
      placeCaretInBlock(next, true);
      ed.focus({ preventScroll: true });
      saveSel();
      emitHtml();
      return;
    }
    const line = document.createElement('div');
    line.setAttribute('dir', 'auto');
    line.innerHTML = '<br>';
    block.parentElement.insertBefore(line, block.nextSibling);
    placeCaretInBlock(line, true);
    ed.focus({ preventScroll: true });
    saveSel();
    emitHtml();
  };

  const editorTopBlock = (ed: HTMLElement, el: HTMLElement): HTMLElement | null => {
    let node: HTMLElement | null = el;
    while (node.parentElement && node.parentElement !== ed) {
      node = node.parentElement;
    }
    return node?.parentElement === ed ? node : null;
  };

  const isSkippableLeadingBlock = (el: Element | null) =>
    el instanceof HTMLElement && BLOCK_TAGS.has(el.tagName) && isEmptyTextLine(el);

  const canInsertLineAboveAtCaret = (ed: HTMLElement, range: Range): HTMLElement | null => {
    const li = resolveListItemAtSelection(range, ed);
    if (li) {
      if (!isCaretAtStartOfLi(li, range)) return null;
      // Previous list item exists — let Arrow Up move naturally.
      if (li.previousElementSibling instanceof HTMLLIElement) return null;
      const list = li.parentElement;
      if (!list || !LIST_TAGS.has(list.tagName)) return null;
      const top = editorTopBlock(ed, list);
      if (!top) return null;
      let prev = top.previousElementSibling;
      while (isSkippableLeadingBlock(prev)) prev = prev?.previousElementSibling ?? null;
      if (prev) return null;
      return list;
    }

    const block = getLineBlock(range.startContainer, ed);
    if (!block || block.closest('li')) return null;
    if (!isCaretAtStartOfBlock(block, range)) return null;
    const top = editorTopBlock(ed, block);
    if (!top) return null;
    let prev = top.previousElementSibling;
    while (isSkippableLeadingBlock(prev)) prev = prev?.previousElementSibling ?? null;
    if (prev) return null;
    return top;
  };

  const handleEditorArrowUp = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const block = getLineBlock(range.startContainer, ed);
    if (block) {
      const prev = block.previousElementSibling;
      if (prev instanceof HTMLElement && prev.classList.contains(NOTE_YT_FRAME)) {
        e.preventDefault();
        placeCaretAroundYouTubeEmbed(prev, 'before');
        saveSel();
        return;
      }
      if (block.classList.contains(NOTE_YT_FRAME)) {
        e.preventDefault();
        placeCaretAroundYouTubeEmbed(block, 'before');
        saveSel();
        return;
      }
    }
    const target = canInsertLineAboveAtCaret(ed, range);
    if (!target) return;
    e.preventDefault();
    insertEmptyLineAboveBlock(ed, target);
    finishNewLineEditing(ed);
  };

  const handleEditorYouTubeArrowDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const block = getLineBlock(range.startContainer, ed);
    if (!block) return;

    const next = block.nextElementSibling;
    if (next instanceof HTMLElement && next.classList.contains(NOTE_YT_FRAME)) {
      e.preventDefault();
      placeCaretAroundYouTubeEmbed(next, 'after');
      saveSel();
      emitHtml();
      return;
    }
    if (block.classList.contains(NOTE_YT_FRAME)) {
      e.preventDefault();
      placeCaretAroundYouTubeEmbed(block, 'after');
      saveSel();
      emitHtml();
    }
  };

  const handleYouTubeEmbedMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!editable || e.button !== 0) return;
    const ed = editorRef.current;
    if (!ed) return;
    const target = e.target;
    if (!(target instanceof Element)) return;

    const removeBtn = target.closest(`.${NOTE_YT_REMOVE}`);
    if (removeBtn instanceof HTMLElement) {
      const frame = removeBtn.closest(`.${NOTE_YT_FRAME}`);
      if (frame instanceof HTMLElement && ed.contains(frame)) {
        e.preventDefault();
        e.stopPropagation();
        ed.focus({ preventScroll: true });
        pushUndoCheckpoint();
        removeYouTubeBlock(frame);
        saveSel();
        emitHtml();
      }
      return;
    }

    // Let clicks on the iframe control the player; only handle the frame chrome.
    if (target.closest('iframe') || target.closest(`.note-yt-player`)) return;
    const frame = target.closest(`.${NOTE_YT_FRAME}`);
    if (!(frame instanceof HTMLElement) || !ed.contains(frame)) {
      if (selectedYtFrameRef.current && !selectedYtFrameRef.current.contains(target)) {
        clearYouTubeSelection();
      }
      return;
    }

    const rect = frame.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';
    e.preventDefault();
    ed.focus({ preventScroll: true });
    selectYouTubeFrame(frame);
    placeCaretAroundYouTubeEmbed(frame, position);
    saveSel();
    emitHtml();
  };

  const applyBlockAlignment = (align: BlockAlign) => {
    const ed = editorRef.current;
    if (!ed) return;
    const restored = restoreToolbarSelection();
    const sel = window.getSelection();
    const range = (restored && !isTableToolbarFocusTarget(restored.commonAncestorContainer))
      ? restored
      : (sel?.rangeCount ? sel.getRangeAt(0) : null);
    if (!range || (range.commonAncestorContainer && !ed.contains(range.commonAncestorContainer))) return;

    const tableCells = collectTableCellsInRange(range, ed);
    const caretCell = closestTableCell(range.startContainer) ?? closestTableCell(range.endContainer);
    if (tableCells.length > 0 || (caretCell && ed.contains(caretCell))) {
      const cells = tableCells.length > 0 ? tableCells : (caretCell ? [caretCell] : []);
      cells.forEach((cell) => {
        // Inline !important so stylesheet `text-align: start` cannot win visually.
        cell.style.setProperty('text-align', align === 'left' ? 'start' : align, 'important');
        cell.removeAttribute('align');
      });
      blurTableToolbarFocus(ed);
      ed.focus({ preventScroll: true });
      saveSel();
      readCommandState();
      emitHtml();
      return;
    }

    // Ensure live selection matches restored range before block-level path.
    if (sel) {
      sel.removeAllRanges();
      try { sel.addRange(range); } catch { /* ignore */ }
    }

    let block = getLineBlock(range.startContainer, ed);
    if (!block) {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('formatBlock', false, 'div');
      block = getLineBlock(range.startContainer, ed);
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
    block.style.setProperty('text-align', align === 'left' ? 'start' : align);
    block.style.marginLeft = '0';
    block.style.marginRight = '0';
    block.removeAttribute('align');

    if (align === 'left') {
      // Clear leftover list/paste indent so Align Left can recover stuck lines.
      for (const prop of LIST_EXIT_INDENT_PROPS) block.style.removeProperty(prop);
      stripLeadingIndentChars(block);
      if (block.tagName === 'LI') {
        exitListItemToMargin(block as HTMLLIElement, ed, true);
        saveSel();
        readCommandState();
        emitHtml();
        ed.focus({ preventScroll: true });
        return;
      }
      const parentLi = block.closest('li');
      if (parentLi instanceof HTMLLIElement) {
        exitListItemToMargin(parentLi, ed, true);
        saveSel();
        readCommandState();
        emitHtml();
        ed.focus({ preventScroll: true });
        return;
      }
      liftBlockToEditorMargin(block, ed);
      stripNewParagraphIndent(block);
    }

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
      if (
        block.classList.contains(NOTE_YT_FRAME)
        || block.classList.contains(NOTE_IMG_FRAME)
        || block.classList.contains('note-table-wrap')
        || block.closest(`.${NOTE_YT_FRAME}, .${NOTE_IMG_FRAME}, .note-table-wrap`)
      ) {
        return;
      }
      block.querySelectorAll<HTMLElement>('span[style*="font-size"]').forEach((span) => {
        const text = span.textContent?.replace(/\u200B/g, '').trim() ?? '';
        if (!text && !span.querySelector('img')) span.remove();
      });
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      // Blocks that hold media have no text but must not be wiped.
      if (!text && !block.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame')) {
        block.innerHTML = '<br>';
        block.style.removeProperty('font-size');
        block.style.removeProperty('line-height');
      }
    });

    const topBlocks = Array.from(ed.children).filter((n): n is HTMLElement => n instanceof HTMLElement);
    for (let i = 1; i < topBlocks.length - 1; i++) {
      const block = topBlocks[i];
      if (!['DIV', 'P'].includes(block.tagName)) continue;
      if (
        block.classList.contains(NOTE_YT_FRAME)
        || block.classList.contains(NOTE_IMG_FRAME)
        || block.classList.contains('note-table-wrap')
      ) {
        continue;
      }
      const text = block.textContent?.replace(/\u200B/g, '').trim() ?? '';
      if (text || block.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame')) continue;
      // Keep empty caret sentinels adjacent to YouTube embeds.
      if (
        topBlocks[i - 1]?.classList.contains(NOTE_YT_FRAME)
        || topBlocks[i + 1]?.classList.contains(NOTE_YT_FRAME)
      ) {
        continue;
      }
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

  const caretFollowsLineBreakInBlock = (block: HTMLElement, range: Range): boolean =>
    caretFollowsLineBreakInBlockLib(block, range);

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
    // Table cells are not "lines" — leave the caret alone.
    if (closestTableCell(range.startContainer) || closestTableCell(range.endContainer)) return false;
    const block = getLineBlock(range.startContainer, ed);
    if (!block) return false;

    if (ensureLeftMarginAfterList(block)) {
      placeCaretInBlock(block, true);
      return true;
    }

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

  /**
   * Shared Enter handler for keydown + Safari/Mac beforeinput(insertParagraph).
   * Returns true when the event must be prevented (list or custom paragraph insert).
   */
  const runEditorEnter = (): boolean => {
    const ed = editorRef.current;
    if (!ed) return false;

    try {
      // Pull embeds out of text blocks first — insertParagraph through a
      // contenteditable=false image frame blanks the whole page in Chromium.
      separateEmbedsFromTextBlocks(ed);

      const sel = window.getSelection();
      if (!sel?.rangeCount) return false;
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
        // Enter in a list only moves down / adds a list line — never exits.
        if (isLiEffectivelyEmpty(li) || isCaretAtEffectiveEndOfLi(li, range)) {
          insertNewListItemAfter(li);
          finishNewLineEditing(ed, { inList: true });
        } else if (isCaretAtStartOfLi(li, range)) {
          splitListItemAtStart(li);
          finishNewLineEditing(ed, { inList: true });
        } else {
          splitListItemAtCaret(li, range);
          finishNewLineEditing(ed, { inList: true });
        }
        return true;
      }

      const block = getLineBlock(sel.anchorNode, ed);
      if (block && continuePseudoListOnEnter(block, sel.getRangeAt(0))) {
        finishNewLineEditing(ed);
        return true;
      }

      const orphanList = getListContainer(sel.anchorNode, ed);
      if (orphanList) {
        const items = Array.from(orphanList.children).filter((n): n is HTMLLIElement => n.tagName === 'LI');
        const target = items[items.length - 1];
        if (target) {
          insertNewListItemAfter(target);
          finishNewLineEditing(ed, { inList: true });
          return true;
        }
      }

      // Heal: Safari sometimes already exited an empty list into a plain line under
      // the heading — put the caret back into a new bullet on that list.
      if (block && block.tagName !== 'LI' && !block.closest('li') && isEmptyTextLine(block)) {
        const prev = block.previousElementSibling;
        if (prev instanceof HTMLElement && LIST_TAGS.has(prev.tagName)) {
          const list = prev as HTMLUListElement | HTMLOListElement;
          const newLi = document.createElement('li');
          newLi.setAttribute('dir', 'auto');
          newLi.innerHTML = '<br>';
          list.appendChild(newLi);
          block.remove();
          placeCaretInBlock(newLi, true);
          finishNewLineEditing(ed, { inList: true });
          return true;
        }
      }

      clearPendingFontMarker();

      // Still has an embed (or is an embed sibling caret) — never split through it.
      const liveBlock = getLineBlock(sel.anchorNode, ed) ?? block;
      if (
        liveBlock
        && (
          liveBlock.classList.contains(NOTE_IMG_FRAME)
          || liveBlock.classList.contains(NOTE_YT_FRAME)
          || liveBlock.querySelector(`.${NOTE_IMG_FRAME}, .${NOTE_YT_FRAME}, .${NOTE_TABLE_WRAP}`)
        )
      ) {
        const newBlock = document.createElement('div');
        newBlock.setAttribute('dir', 'auto');
        newBlock.innerHTML = '<br>';
        liveBlock.parentNode?.insertBefore(newBlock, liveBlock.nextSibling);
        placeCaretInBlock(newBlock, true);
        finishNewLineEditing(ed);
        return true;
      }

      if (liveBlock && ensureLeftMarginAfterList(liveBlock)) {
        placeCaretInBlock(liveBlock, true);
        finishNewLineEditing(ed);
        return true;
      }

      if (liveBlock && readBlockAlignment(liveBlock) !== 'left') {
        createLeftLineFromCaret(liveBlock, range);
        finishNewLineEditing(ed);
        return true;
      }

      document.execCommand('insertParagraph');

      requestAnimationFrame(() => {
        try {
          ensureCaretOnOwnLeftLine(ed);
          finishNewLineEditing(ed);
        } catch {
          emitHtml();
        }
      });
      return true;
    } catch {
      try {
        const sel = window.getSelection();
        const anchor = sel?.anchorNode;
        const fallbackBlock = anchor ? getLineBlock(anchor, ed) : null;
        const newBlock = document.createElement('div');
        newBlock.setAttribute('dir', 'auto');
        newBlock.innerHTML = '<br>';
        if (fallbackBlock?.parentNode) {
          fallbackBlock.parentNode.insertBefore(newBlock, fallbackBlock.nextSibling);
        } else {
          ed.appendChild(newBlock);
        }
        placeCaretInBlock(newBlock, true);
        finishNewLineEditing(ed);
      } catch {
        emitHtml();
      }
      return true;
    }
  };

  const handleEditorEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (enterHandledRef.current) {
      e.preventDefault();
      return;
    }
    if (runEditorEnter()) {
      e.preventDefault();
      enterHandledRef.current = true;
      requestAnimationFrame(() => { enterHandledRef.current = false; });
    }
  };

  const handleEditorShiftEnter = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || !e.shiftKey || e.nativeEvent.isComposing) return;
    const ed = editorRef.current;
    if (!ed) return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    const li = resolveListItemAtSelection(range, ed);
    if (!li || !isCaretAtStartOfLi(li, range)) return;
    const list = li.parentElement;
    if (!list || !LIST_TAGS.has(list.tagName) || li !== list.firstElementChild) return;
    e.preventDefault();
    pushUndoCheckpoint();
    const para = insertParagraphAboveList(list as HTMLUListElement | HTMLOListElement);
    placeCaretInBlock(para, true);
    finishNewLineEditing(ed);
  };

  const runEditorBackspace = (e: { key: string; preventDefault: () => void; nativeEvent?: { isComposing?: boolean } }) => {
    if (e.key !== 'Backspace' || e.nativeEvent?.isComposing) return false;
    const ed = editorRef.current;
    if (!ed) return false;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    if (skipDuplicateBackspaceRef.current) {
      skipDuplicateBackspaceRef.current = false;
      return false;
    }
    const range = sel.getRangeAt(0);
    pushUndoCheckpoint();
    const handled = () => {
      skipDuplicateBackspaceRef.current = true;
      queueMicrotask(() => {
        skipDuplicateBackspaceRef.current = false;
      });
      return true as const;
    };

    // Priority 1: non-empty selection — delete first; never run list Backspace logic.
    if (!sel.isCollapsed) {
      if (deleteEditorSelection(range, ed, sel)) {
        e.preventDefault();
        return handled();
      }
      return false;
    }

    // Selected YouTube embed: Backspace removes only the video.
    const selectedYt = selectedYtFrameRef.current;
    if (selectedYt?.isConnected && ed.contains(selectedYt)) {
      e.preventDefault();
      removeYouTubeBlock(selectedYt);
      saveSel();
      readCommandState();
      emitHtml();
      return handled();
    }

    // Selected image frame: Backspace removes only the image (checkpoint already pushed).
    {
      const selectedFrame = activeFrameRef.current;
      if (selectedFrame?.isConnected && ed.contains(selectedFrame)) {
        const img = selectedFrame.querySelector(':scope > img');
        if (img instanceof HTMLImageElement) {
          e.preventDefault();
          removeImageBlock(img);
          hideImageToolbar();
          saveSel();
          readCommandState();
          emitHtml();
          return handled();
        }
      }
    }

    // Caret at start of block after a YouTube embed → remove the embed only.
    {
      const ytBlock = getLineBlock(range.startContainer, ed);
      if (
        ytBlock
        && ytBlock.tagName !== 'LI'
        && !ytBlock.closest('li')
        && !ytBlock.classList.contains(NOTE_YT_FRAME)
        && isCaretAtStartOfBlock(ytBlock, range)
      ) {
        const prev = ytBlock.previousElementSibling;
        if (prev instanceof HTMLElement && prev.classList.contains(NOTE_YT_FRAME)) {
          e.preventDefault();
          removeYouTubeBlock(prev);
          placeCaretInBlock(ytBlock, true);
          saveSel();
          readCommandState();
          emitHtml();
          return handled();
        }
      }
    }

    if (tryCompletePendingListMarginExit(range, ed)) {
      e.preventDefault();
      return handled();
    }

    if (tryRemoveStuckBullet(range, ed)) {
      e.preventDefault();
      return handled();
    }

    const block = getLineBlock(range.startContainer, ed);
    if (block && block.tagName !== 'LI' && !block.closest('li') && isCaretAtStartOfBlock(block, range)) {
      if (
        isEmptyTextLine(block)
        && pendingIndentExitRef.current === block
      ) {
        e.preventDefault();
        stripListPasteIndent(block, true);
        stripNewParagraphIndent(block);
        pendingIndentExitRef.current = null;
        placeCaretInBlock(block, true);
        saveSel();
        readCommandState();
        emitHtml();
        return handled();
      }
      // Empty margin line after/between list fragments: Backspace 2 → line above
      // (last bullet of the list before), never skip up onto the Rubrik heading
      // while a list line is still the immediate neighbour above.
      if (focusLineAboveAfterListParagraph(block)) {
        e.preventDefault();
        saveSel();
        readCommandState();
        emitHtml();
        return handled();
      }
      // Empty normal line directly above a list (under a heading): delete the line
      // and move to the heading above — only when the previous sibling is NOT a list.
      if (isEmptyTextLine(block)) {
        const next = block.nextElementSibling;
        const prev = block.previousElementSibling;
        if (
          next instanceof HTMLElement
          && LIST_TAGS.has(next.tagName)
          && !(prev instanceof HTMLElement && LIST_TAGS.has(prev.tagName))
        ) {
          e.preventDefault();
          block.remove();
          if (prev instanceof HTMLElement && BLOCK_TAGS.has(prev.tagName) && prev.tagName !== 'LI') {
            placeCaretInBlock(prev, false);
          } else {
            const firstLi = next.querySelector(':scope > li');
            if (firstLi instanceof HTMLLIElement) placeCaretInBlock(firstLi, true);
          }
          saveSel();
          readCommandState();
          emitHtml();
          return handled();
        }
      }
      // Leftover paste/list indent (or after-list margin): clear to heading margin.
      if (blockHasLeftoverIndent(block, ed) || ensureLeftMarginAfterList(block)) {
        e.preventDefault();
        stripNewParagraphIndent(block);
        liftBlockToEditorMargin(block, ed);
        stripNewParagraphIndent(block);
        placeCaretInBlock(block, true);
        saveSel();
        readCommandState();
        emitHtml();
        return handled();
      }
    }

    const li = resolveListItemAtSelection(range, ed);
    if (li) {
      const pending = pendingListMarginExitRef.current;
      if (
        pending?.isConnected
        && pending.contains(li)
        && isLastListItem(li)
      ) {
        e.preventDefault();
        tryCompletePendingListMarginExit(range, ed);
        return handled();
      }

      if (backspaceOutdentOrExitListItem(li, ed, range)) {
        e.preventDefault();
        return handled();
      }
      return false;
    }

    if (block && block.tagName !== 'LI' && !block.closest('li') && isCaretAtStartOfBlock(block, range) && getBlockPrefixMatch(block)) {
      e.preventDefault();
      stripBulletPrefixFromBlock(block);
      saveSel();
      readCommandState();
      emitHtml();
      return handled();
    }
    return false;
  };

  const runEditorForwardDelete = (e: { key: string; preventDefault: () => void; nativeEvent?: { isComposing?: boolean } }) => {
    if (e.key !== 'Delete' || e.nativeEvent?.isComposing) return false;
    const ed = editorRef.current;
    if (!ed) return false;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return false;
    const range = sel.getRangeAt(0);
    pushUndoCheckpoint();
    // Priority 1: non-empty selection — same as Backspace.
    if (!sel.isCollapsed) {
      if (deleteEditorSelection(range, ed, sel)) {
        e.preventDefault();
        return true;
      }
      return false;
    }

    // Selected YouTube embed: Delete removes only the video.
    const selectedYt = selectedYtFrameRef.current;
    if (selectedYt?.isConnected && ed.contains(selectedYt)) {
      e.preventDefault();
      removeYouTubeBlock(selectedYt);
      saveSel();
      readCommandState();
      emitHtml();
      return true;
    }

    // Selected image frame: Delete removes only the image (checkpoint already pushed).
    {
      const selectedFrame = activeFrameRef.current;
      if (selectedFrame?.isConnected && ed.contains(selectedFrame)) {
        const img = selectedFrame.querySelector(':scope > img');
        if (img instanceof HTMLImageElement) {
          e.preventDefault();
          removeImageBlock(img);
          hideImageToolbar();
          saveSel();
          readCommandState();
          emitHtml();
          return true;
        }
      }
    }

    // Caret at end of block before a YouTube embed → remove the embed only.
    {
      const ytBlock = getLineBlock(range.startContainer, ed);
      if (
        ytBlock
        && ytBlock.tagName !== 'LI'
        && !ytBlock.closest('li')
        && !ytBlock.classList.contains(NOTE_YT_FRAME)
        && isCaretAtEndOfBlock(ytBlock, range)
      ) {
        const next = ytBlock.nextElementSibling;
        if (next instanceof HTMLElement && next.classList.contains(NOTE_YT_FRAME)) {
          e.preventDefault();
          removeYouTubeBlock(next);
          placeCaretInBlock(ytBlock, false);
          saveSel();
          readCommandState();
          emitHtml();
          return true;
        }
      }
    }

    const li = resolveListItemAtSelection(range, ed);
    if (!li || !isLiEffectivelyEmpty(li)) return false;
    e.preventDefault();
    backspaceEmptyListItem(li, ed);
    return true;
  };

  const runEditorBackspaceRef = useRef(runEditorBackspace);
  runEditorBackspaceRef.current = runEditorBackspace;
  const runEditorForwardDeleteRef = useRef(runEditorForwardDelete);
  runEditorForwardDeleteRef.current = runEditorForwardDelete;
  const performEditorUndoRef = useRef(performEditorUndo);
  performEditorUndoRef.current = performEditorUndo;
  const performEditorRedoRef = useRef(performEditorRedo);
  performEditorRedoRef.current = performEditorRedo;

  const handleEditorBackspace = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (runEditorBackspace(e)) e.preventDefault();
  };

  const handleEditorDelete = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (runEditorForwardDelete(e)) e.preventDefault();
  };

  // ── Initial content ───────────────────────────────────────────────────
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== html) {
      editorRef.current.innerHTML = html;
      normalizeEditorImages(editorRef.current);
      normalizeTablesInEditor(editorRef.current);
      promotePseudoListsToNative(editorRef.current);
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
    const syncAt = syncUpdatedAt ?? 0;
    const remoteSyncAdvance = syncAt > (lastSyncUpdatedAtRef.current ?? 0);
    lastSyncUpdatedAtRef.current = syncAt;
    const active = document.activeElement;
    if (active && editorWrapRef.current?.contains(active)) {
      const remoteIsNewer = remoteSyncAdvance && syncAt > lastKeystrokeAtRef.current;
      if (!remoteIsNewer && Date.now() - lastKeystrokeAtRef.current < 300) return;
    }
    if (ed.innerHTML === html || isEquivalentEditorHtml(ed.innerHTML, html)) {
      lastLocalHtmlRef.current = ed.innerHTML;
      return;
    }
    // Echo of our own emit (serialized HTML without ephemeral chrome) — keep live DOM + undo stack.
    if (html === lastLocalHtmlRef.current) {
      return;
    }
    // Parent sent shorter html — keep local DOM during active typing; never push longer html back up.
    if (propChanged && html !== lastLocalHtmlRef.current) {
      const plain = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      const localPlainLen = plain(ed.innerHTML).length;
      const propPlainLen = plain(html).length;
      if (localPlainLen > propPlainLen) {
        const focused = active && editorWrapRef.current?.contains(active);
        if (focused || Date.now() - lastKeystrokeAtRef.current < 12_000) return;
        const remoteIsNewer = remoteSyncAdvance && syncAt > lastKeystrokeAtRef.current;
        if (!remoteIsNewer && Date.now() - lastKeystrokeAtRef.current < 800) return;
      }
    }
    // Skip only stale echoes of our own edits; deliberate parent updates still apply.
    if (!propChanged && ed.innerHTML === lastLocalHtmlRef.current && html !== lastLocalHtmlRef.current) return;
    hideImageToolbar();
    ed.innerHTML = html;
    normalizeEditorImages(ed);
    normalizeTablesInEditor(ed);
    if (promotePseudoListsToNative(ed)) {
      lastLocalHtmlRef.current = serializeEditorHtml(ed);
      onLiveChangeRef.current?.(lastLocalHtmlRef.current);
      onChangeRef.current(lastLocalHtmlRef.current);
    } else {
      lastLocalHtmlRef.current = ed.innerHTML;
    }
    resetEditorUndoHistory();
  }, [html]);

  useEffect(() => {
    const flush = () => flushEmitHtml();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      // Do not flush on unmount: contenteditable is often cleared during React
      // teardown and would overwrite draft state with empty html. onLiveChange
      // already syncs each keystroke to the parent.
    };
  }, []);

  // ── Command state ─────────────────────────────────────────────────────
  const readCommandState = () => {
    const active = new Set<string>();
    const ed = editorRef.current;
    const sel = window.getSelection();
    const selInThisEditor = !!(
      ed
      && sel?.rangeCount
      && sel.anchorNode
      && ed.contains(sel.anchorNode)
    );
    // queryCommandState is document-global — only trust it when the live selection
    // is inside THIS editor (quiz has Q+A editors side by side).
    // Inside table cells it lies (UA <th> bold → queryCommandState('bold') stuck ON).
    const inTableCell = !!(sel?.anchorNode && closestTableCell(sel.anchorNode));
    if (selInThisEditor) {
      if (!inTableCell) {
        TOGGLE_COMMANDS.forEach((c) => {
          try { if (document.queryCommandState(c)) active.add(c); } catch { /* noop */ }
        });
      }
      // DOM marks (including data-note-mark spans) — trustworthy in table cells.
      if (ed && sel?.anchorNode) {
        TOGGLE_COMMANDS.forEach((c) => {
          if (nodeHasToggleMarkAncestor(sel.anchorNode!, c, ed)) active.add(c);
        });
      }
    }
    // List button state is derived purely from the live DOM below — never seeded from
    // document.queryCommandState('insertUnorderedList'/'insertOrderedList'). We only ever
    // mutate lists via direct DOM ops (never execCommand), so the browser's native command
    // state can go stale and report a list as "active" on a plain paragraph that has none —
    // that stuck toolbar state made new lists look already-open and confused subsequent edits.
    if (ed && selInThisEditor && sel?.rangeCount) {
      const list = getListContainer(sel.anchorNode, ed);
      if (list?.tagName === 'UL') {
        active.add('insertUnorderedList');
      } else if (list?.tagName === 'OL') {
        active.add('insertOrderedList');
      }
      const li = resolveListItemAtSelection(sel.getRangeAt(0), ed);
      if (li) {
        active.add('inListItem');
        if (isNestedListItem(li) || li.querySelector(':scope > ul, :scope > ol')) active.add('nestedList');
        if (canIndentListItem(li)) active.add('canIndentList');
        if (canOutdentListItem(li)) active.add('canOutdentList');
      } else {
        const block = getLineBlock(sel.anchorNode, ed);
        if (block && block.tagName !== 'LI' && !block.closest('li') && getBlockPrefixMatch(block)) {
          active.add('insertUnorderedList');
        }
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
      const ed = editorRef.current;
      const inEditor = !!ed && (document.activeElement === ed || ed.contains(document.activeElement));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && inEditor) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.shiftKey) performEditorRedoRef.current();
        else performEditorUndoRef.current();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !e.shiftKey && inEditor) {
        e.preventDefault();
        e.stopImmediatePropagation();
        performEditorRedoRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      if (!ed || !inEditor) return;
      const sel = window.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        const li = resolveListItemAtSelection(range, ed);
        if (li) {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (e.shiftKey) outdentOrExitListItem(li, ed);
          else indentListItem(li);
          saveSel();
          readCommandState();
          emitHtml();
          return;
        }
        // Shift+Tab on an indented non-list block: clear leftover margin/padding/spaces.
        if (e.shiftKey) {
          const block = getLineBlock(range.startContainer, ed);
          if (block && block.tagName !== 'LI' && !block.closest('li')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            stripNewParagraphIndent(block);
            liftBlockToEditorMargin(block, ed);
            stripNewParagraphIndent(block);
            placeCaretInBlock(block, true);
            saveSel();
            readCommandState();
            emitHtml();
            return;
          }
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

  /** True when focus landed on the in-editor table chrome ("Line above", etc.). */
  const isTableToolbarFocusTarget = (node: Node | null): boolean => {
    if (!(node instanceof Element)) return false;
    return !!node.closest(`.${NOTE_TABLE_TOOLBAR_HOST}, [data-note-table-toolbar]`);
  };

  /** Kick focus off table menu controls so formatting never targets "Line above". */
  const blurTableToolbarFocus = (ed: HTMLElement) => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && ed.contains(active) && isTableToolbarFocusTarget(active)) {
      active.blur();
    }
    ed.querySelectorAll(`.${NOTE_TABLE_TOOLBAR_HOST} button, [data-note-table-toolbar] button, [data-note-table-toolbar] [role="button"]`)
      .forEach((el) => {
        if (el instanceof HTMLElement && el.tabIndex >= 0) el.tabIndex = -1;
        if (el === document.activeElement && el instanceof HTMLElement) el.blur();
      });
  };

  /** Restore the pre-toolbar selection into this editor before applying marks. */
  const restoreToolbarSelection = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;
    const preferred =
      savedFormattingRange.current?.cloneRange()
      ?? savedRange.current?.cloneRange()
      ?? liveRange()
      ?? null;

    // Table chrome buttons inside contenteditable steal focus on ed.focus() in Chrome.
    blurTableToolbarFocus(ed);
    ed.focus({ preventScroll: true });
    blurTableToolbarFocus(ed);

    if (
      preferred
      && preferred.commonAncestorContainer.isConnected
      && ed.contains(preferred.commonAncestorContainer)
      && !isTableToolbarFocusTarget(preferred.commonAncestorContainer)
    ) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      try { sel?.addRange(preferred); } catch { /* stale range */ }
    }

    blurTableToolbarFocus(ed);
    if (document.activeElement !== ed && !ed.contains(document.activeElement)) {
      ed.focus({ preventScroll: true });
      blurTableToolbarFocus(ed);
    }

    const live = liveRange();
    if (live && !live.collapsed && !isTableToolbarFocusTarget(live.commonAncestorContainer)) {
      return live;
    }
    // Even if live selection was stolen by table chrome, keep formatting the saved cell range.
    if (
      preferred
      && !preferred.collapsed
      && preferred.commonAncestorContainer.isConnected
      && ed.contains(preferred.commonAncestorContainer)
      && !isTableToolbarFocusTarget(preferred.commonAncestorContainer)
    ) {
      return preferred;
    }
    return live;
  };

  /** Split a restored selection into table-safe sub-ranges (same as font-size). */
  const collectFormatTargetRanges = (range: Range, ed: HTMLElement): Range[] =>
    collectFormatTargetRangesFromLib(range, ed);

  const selectElementsAfterFormat = (els: HTMLElement[]) => {
    if (els.length === 0) return;
    const nextRange = document.createRange();
    if (els.length === 1) nextRange.selectNodeContents(els[0]);
    else {
      nextRange.setStartBefore(els[0]);
      nextRange.setEndAfter(els[els.length - 1]);
    }
    const finalSel = window.getSelection();
    finalSel?.removeAllRanges();
    try { finalSel?.addRange(nextRange); } catch { /* ignore */ }
  };

  /**
   * Same range resolution highlight uses: prefer the Range object returned by
   * restoreToolbarSelection (saved cell selection), not a second live re-query
   * that fails when focus briefly left the editor.
   */
  const resolveToolbarFormatRange = (): Range | null => {
    const restored = restoreToolbarSelection();
    if (restored && !restored.collapsed && !isTableToolbarFocusTarget(restored.commonAncestorContainer)) {
      return restored;
    }
    return resolveStyleTargetRange() ?? resolveFormatRange();
  };

  /**
   * Apply B/I/U/S via DOM wrap/unwrap (font-size / highlight path). execCommand often
   * no-ops or only flips typing-state inside table cells while leaving the selection unchanged.
   */
  const applyToggleMarkToTargets = (cmd: string, targets: Range[], ed: HTMLElement) => {
    const turnOff = targets.length > 0
      && targets.every((sub) => rangeIsFullyToggleMarked(sub, cmd, ed));
    const wrapped: HTMLElement[] = [];
    // Snapshot clones before mutation invalidates later ranges.
    const snaps = targets.map((t) => t.cloneRange());
    snaps.forEach((sub) => {
      if (turnOff) {
        stripToggleMarkInRange(sub, cmd);
      } else {
        const el = wrapRangeWithToggleMark(sub, cmd);
        if (el) wrapped.push(el);
      }
    });
    if (wrapped.length > 0) selectElementsAfterFormat(wrapped);
    else if (snaps.length > 0) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      try { sel?.addRange(snaps[snaps.length - 1]); } catch { /* ignore */ }
    }
    blurTableToolbarFocus(ed);
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
  };

  // ── exec: apply a formatting command ─────────────────────────────────
  const exec = (cmd: string, value?: string) => {
    const ed = editorRef.current;
    if (!ed) return;

    // Same order as highlight: resolve selection FIRST, then checkpoint (clone-safe),
    // then mutate. Never serialize the live DOM before restore.
    const range = resolveToolbarFormatRange();
    const isToggle = (TOGGLE_COMMANDS as readonly string[]).includes(cmd);

    if (isToggle && range && !range.collapsed) {
      const targets = collectFormatTargetRanges(range, ed);
      if (targets.length > 0) {
        pushUndoCheckpoint();
        applyToggleMarkToTargets(cmd, targets, ed);
        savedFormattingRange.current = null;
        saveSel();
        readCommandState();
        emitHtml();
        return;
      }
      // In-table non-collapsed selection with no targets: do NOT fall through to
      // execCommand — it flips toolbar state without changing the DOM inside cells.
      if (closestTableCell(range.commonAncestorContainer)
        || closestTableCell(range.startContainer)
        || collectTableCellsInRange(range, ed).length > 0) {
        saveSel();
        readCommandState();
        return;
      }
    }

    pushUndoCheckpoint();
    // Collapsed caret (or non-toggle): execCommand for typing-state / legacy cmds.
    // Re-apply restored caret if we have one.
    if (range) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      try { sel?.addRange(range.cloneRange()); } catch { /* ignore */ }
    }
    document.execCommand('styleWithCSS', false, isToggle ? 'false' : 'true');
    document.execCommand(cmd, false, value);
    blurTableToolbarFocus(ed);
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

    const active = document.activeElement;
    if (active === ed || (active instanceof Node && ed.contains(active))) {
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

  /** Resolve a non-collapsed range to format. Collapsed caret → null (caller sets future style). */
  const resolveStyleTargetRange = (): Range | null => {
    const ed = editorRef.current;
    if (!ed) return null;

    const selected = resolveFormatRange();
    if (selected && !selected.collapsed) return selected;

    // Do NOT expand caret-in-cell to the whole cell — that made size/color/highlight
    // clobber the entire cell when the user only wanted the next typed characters.
    return null;
  };

  const wrapRangeWithFontSize = (range: Range, px: number): HTMLSpanElement | null => {
    try {
      const contents = range.extractContents();
      stripInlineFontSize(contents);
      const span = document.createElement('span');
      applyFontSizeStyle(span, px);
      span.appendChild(contents);
      range.insertNode(span);
      return span;
    } catch {
      return null;
    }
  };

  const selectSpansAfterFormat = (spans: HTMLSpanElement[]) => {
    if (spans.length === 0) return;
    const nextRange = document.createRange();
    if (spans.length === 1) nextRange.selectNodeContents(spans[0]);
    else {
      nextRange.setStartBefore(spans[0]);
      nextRange.setEndAfter(spans[spans.length - 1]);
    }
    const finalSel = window.getSelection();
    finalSel?.removeAllRanges();
    try { finalSel?.addRange(nextRange); } catch { /* ignore */ }
  };

  const applyPx = (px: number) => {
    const ed = editorRef.current;
    if (!ed) return;

    // Same as highlight: use restored Range object, not a second live re-query.
    const range = resolveToolbarFormatRange();
    if (!range || range.collapsed) {
      setFutureFontSize(px);
      return;
    }

    savedFormattingRange.current = null;
    pushUndoCheckpoint();

    const targets = collectFormatTargetRanges(range, ed);
    const spans: HTMLSpanElement[] = [];
    targets.forEach((sub) => {
      const existing = getStylingSpanForRange(sub, ed);
      if (existing) {
        applyFontSizeStyle(existing, px);
        spans.push(existing);
        return;
      }
      const wrapped = wrapRangeWithFontSize(sub, px);
      if (wrapped) spans.push(wrapped);
    });
    selectSpansAfterFormat(spans);
    blurTableToolbarFocus(ed);
    if (document.activeElement !== ed) ed.focus({ preventScroll: true });
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
    const range = resolveToolbarFormatRange();
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

  const wrapRangeWithTextColor = (range: Range, color: string): HTMLSpanElement | null => {
    try {
      const contents = range.extractContents();
      stripInlineTextColor(contents);
      const span = document.createElement('span');
      span.style.color = color;
      span.appendChild(contents);
      range.insertNode(span);
      return span;
    } catch {
      return null;
    }
  };

  const applyColor = (c: string) => {
    const ed = editorRef.current;
    if (!ed) return;
    setBarColor(c);

    // Same as highlight: use restored Range object directly.
    const range = resolveToolbarFormatRange();

    // Selected text: DOM-wrap like highlight (execCommand foreColor fails in table cells).
    if (range && !range.collapsed) {
      pushUndoCheckpoint();
      const targets = collectFormatTargetRanges(range, ed);
      const spans: HTMLSpanElement[] = [];
      targets.forEach((sub) => {
        const wrapped = wrapRangeWithTextColor(sub, c);
        if (wrapped) spans.push(wrapped);
      });
      selectSpansAfterFormat(spans);
      blurTableToolbarFocus(ed);
      if (document.activeElement !== ed) ed.focus({ preventScroll: true });
      savedFormattingRange.current = null;
      saveSel();
      setPalOpen(false);
      emitHtml();
      return;
    }

    // Collapsed caret: set typing color for the next characters.
    ed.focus({ preventScroll: true });
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
    const range = restoreToolbarSelection() ?? resolveFormatRange();
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
      if (ed && r && hasStuckBullet(r, ed)) {
        tryRemoveStuckBullet(r, ed);
        return;
      }
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
    const range = resolveToolbarFormatRange();
    if (!range) return;

    ed.focus({ preventScroll: true });
    blurTableToolbarFocus(ed);

    if (!range.collapsed) {
      pushUndoCheckpoint();
      const targets = collectFormatTargetRanges(range, ed);
      if (c === 'transparent') {
        targets.forEach((sub) => clearHighlightsInRange(ed, sub));
      } else {
        const spans: HTMLSpanElement[] = [];
        targets.forEach((sub) => {
          const wrapped = wrapRangeWithHighlight(sub, c);
          if (wrapped) spans.push(wrapped);
        });
        selectSpansAfterFormat(spans);
      }
      blurTableToolbarFocus(ed);
      if (document.activeElement !== ed) ed.focus({ preventScroll: true });
      savedFormattingRange.current = null;
      saveSel();
      setHlPalOpen(false);
      emitHtml();
      return;
    }

    // Collapsed caret: backColor for next typed characters / clear at caret.
    const sel = window.getSelection();
    sel?.removeAllRanges();
    try { sel?.addRange(range.cloneRange()); } catch { /* ignore */ }

    if (c === 'transparent') {
      clearHighlightsInRange(ed, range);
    } else {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('backColor', false, c);
    }
    saveSel();
    setHlPalOpen(false);
    emitHtml();
  };

  // ── Image ─────────────────────────────────────────────────────────────
  /** Shared by file-picker inserts and clipboard-paste inserts. */
  const insertImageDataUrl = (url: string) => {
    const liveEd = editorRef.current;
    if (!liveEd) return;
    ensureFocus(true);
    document.execCommand('insertHTML', false, `<div class="${NOTE_IMG_FRAME}" contenteditable="false" dir="auto" style="width:160px;max-width:100%"><img src="${url}" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;max-height:none;cursor:zoom-in;" /></div><div dir="auto"><br></div>`);
    normalizeEditorImages(liveEd);
    separateEmbedsFromTextBlocks(liveEd);
    saveSel();
    emitHtml();
  };

  /** Replace an inserted image's src (base64 → Storage URL) if still in the editor. */
  const swapImageSrc = (fromUrl: string, toUrl: string) => {
    const liveEd = editorRef.current;
    if (!liveEd) return;
    let swapped = false;
    liveEd.querySelectorAll('img').forEach((img) => {
      if (img.getAttribute('src') === fromUrl) {
        img.setAttribute('src', toUrl);
        swapped = true;
      }
    });
    if (swapped) emitHtml();
  };

  /**
   * Insert immediately (so the user always sees the picture), then upgrade to a
   * Storage URL in the background when signed in. Waiting for upload BEFORE
   * insert made images appear to "never load" whenever Storage was slow or
   * rejected the write — unacceptable. Persistence of the short URL is handled
   * by emitEditorImageSwap → NotesContext even after the editor is closed.
   */
  const insertImageFile = async (file: File) => {
    let dataUrl: string;
    try {
      dataUrl = await compressImageForInline(file);
    } catch {
      showToast(t.filesUploadFailed);
      return;
    }
    insertImageDataUrl(dataUrl);

    if (!auth.currentUser) return;
    try {
      const remoteUrl = await uploadEditorImage(dataUrl);
      if (!remoteUrl) return;
      swapImageSrc(dataUrl, remoteUrl);
      emitEditorImageSwap(dataUrl, remoteUrl);
    } catch (err) {
      console.warn('[RichTextEditor] background image upload failed; keeping inline preview', err);
    }
  };

  const insertImage = (file: File) => {
    const ed = editorRef.current;
    if (!ed || !file.type.startsWith('image/')) return;
    void insertImageFile(file);
  };

  // ── Image resize: drag a handle to grow/shrink (corner keeps ratio) ────
  /** Persist width as % of the editor so view/read columns match edit size. */
  const applyImageSize = (img: HTMLImageElement, mode: 'both' | 'width' | 'height', startWidth: number, startHeight: number, ratio: number, maxW: number, dx: number, dy: number) => {
    const frame = img.closest(`.${NOTE_IMG_FRAME}`);
    img.style.maxHeight = 'none';
    img.style.objectFit = 'contain';
    img.style.maxWidth = '100%';
    // Always size via frame % + img width:100%. Absolute px + max-width:none
    // clipped the right side after save when the editor/column was narrower.
    let nextW: number;
    if (mode === 'height') {
      const nextH = Math.max(40, Math.round(startHeight + dy));
      nextW = Math.min(maxW, Math.max(60, Math.round(nextH / (ratio || 1))));
    } else {
      nextW = Math.min(maxW, Math.max(60, Math.round(startWidth + dx)));
    }
    const pct = Math.min(100, Math.max(8, (nextW / maxW) * 100));
    img.style.width = '100%';
    img.style.height = 'auto';
    if (frame instanceof HTMLElement) {
      frame.style.width = `${Math.round(pct * 10) / 10}%`;
      frame.style.maxWidth = '100%';
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
        applyImageSelectScale(img, frame);
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

  const insertTable = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ensureFocus(true);
    const sel = window.getSelection();
    let prefix = '';
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        const atEditorStart = range.startContainer === ed && range.startOffset === 0;
        const block = resolveBlockAtRange(range, ed);
        const blockIsFirst = !!block && block === ed.firstElementChild;
        if (atEditorStart || blockIsFirst) prefix = '<div dir="auto"><br></div>';
      }
    }
    document.execCommand('insertHTML', false, prefix + buildEmptyTableHtml(3, 2));
    saveSel();
    const live = editorRef.current;
    if (live) normalizeTablesInEditor(live);
    emitHtml();
    syncVisibleTableWraps();
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        listMenuRangeRef.current = null;
        listMenuBlockRef.current = null;
        setListPalOpen(false);
      }
    };
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
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', closeAll); window.removeEventListener('scroll', closeAll, true); };
  }, [listPalOpen]);

  useEffect(() => {
    if (!imgOverflowOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImgOverflowOpen(false);
    };
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (imgOverflowBtnRef.current?.contains(t) || imgOverflowMenuRef.current?.contains(t)) return;
      setImgOverflowOpen(false);
    };
    const closeAll = () => setImgOverflowOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', closeAll);
    window.addEventListener('scroll', closeAll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', closeAll);
      window.removeEventListener('scroll', closeAll, true);
    };
  }, [imgOverflowOpen]);

  useEffect(() => {
    if (!hoveredImg) setImgOverflowOpen(false);
  }, [hoveredImg]);

  useEffect(() => {
    if (!editable) {
      hideTableToolbar();
      return;
    }
    syncVisibleTableWraps();
  }, [editable, html]);

  useEffect(() => {
    if (!editable) return;
    const onSelectionChange = () => {
      if (document.activeElement !== editorRef.current && !editorRef.current?.contains(document.activeElement)) return;
      refreshActiveTableToolbar();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [editable]);

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
  const verticalScroll = resizable || !!maxHeight;

  // ── Render ────────────────────────────────────────────────────────────
  // Sticky toolbar needs overflow:visible on ancestors between it and the
  // page/modal scrollport. overflow-x:hidden computes to a scroll container
  // and prevents sticking when the outer quiz/notes pane scrolls.
  return (
    <div ref={editorWrapRef} className={'relative min-w-0 max-w-full w-full ' + (flexToolbar ? 'flex min-h-0 flex-col ' : 'overflow-x-hidden ') + (editable ? '' : '[&_.note-img-frame]:cursor-zoom-in [&_.note-img-frame]:max-w-full [&_.note-img-frame_img]:block [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:max-h-none [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:cursor-zoom-in [&_.note-img-frame_img]:object-contain')}>
      {/* Toolbar */}
      <div
        data-note-fmt-toolbar
        className={
          'flex min-w-0 max-w-full flex-wrap items-center gap-0.5 border-b border-app-border bg-app-bg px-3 py-1.5 dark:border-white/10 dark:bg-white/5 ' +
          (flexToolbar ? 'z-40 flex-shrink-0 sticky top-0 bg-app-bg/95 shadow-sm backdrop-blur-sm dark:bg-gray-900/95 ' : 'overflow-x-hidden ')
        }
        style={{ pointerEvents: editable ? 'auto' : 'none', opacity: editable ? 1 : 0.4 }}
        onMouseDownCapture={(e) => {
          // Capture selection before any toolbar control steals focus.
          captureFormattingSelection();
          // preventDefault on the chrome (not inputs) keeps the caret in the editor.
          const t = e.target;
          if (t instanceof HTMLElement && t.closest('input, textarea, select')) return;
          if (t instanceof HTMLElement && t.closest('button, [data-note-toolbar-btn]')) {
            e.preventDefault();
          }
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
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); exec('bold'); }} title={t.titleBold} className={btnCls(activeCmds.has('bold'))}><b>B</b></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); exec('italic'); }} title={t.titleItalic} className={btnCls(activeCmds.has('italic'))}><i>I</i></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); exec('underline'); }} title={t.titleUnline} className={btnCls(activeCmds.has('underline'))}><u>U</u></button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); exec('strikeThrough'); }} title={t.titleStrike} className={btnCls(activeCmds.has('strikeThrough'))}><s>S</s></button>

        <div className="mx-1.5 h-4 w-px bg-app-border dark:bg-white/10" />

        {/* Alignment */}
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); applyBlockAlignment('left'); }} title={t.titleLeft} className={btnCls(activeCmds.has('justifyLeft'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="3" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="3" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); applyBlockAlignment('center'); }} title={t.titleCenter} className={btnCls(activeCmds.has('justifyCenter'))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="5" width="18" height="2" rx="1"/><rect x="6" y="10" width="12" height="2" rx="1"/><rect x="3" y="15" width="18" height="2" rx="1"/><rect x="6" y="20" width="12" height="2" rx="1"/></svg>
        </button>
        <button type="button" onMouseDown={(e) => { e.preventDefault(); captureFormattingSelection(); applyBlockAlignment('right'); }} title={t.titleRight} className={btnCls(activeCmds.has('justifyRight'))}>
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
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); saveSel(); applyOutdentSubList(); }}
                title={t.titleOutdentSubList}
                className={
                  'flex h-7 w-7 items-center justify-center rounded-md ' +
                  (activeCmds.has('canOutdentList')
                    ? 'text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10'
                    : 'text-app-text-secondary hover:bg-app-bg dark:hover:bg-white/10')
                }
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

        {/* Table */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); saveSel(); insertTable(); }}
          title={t.titleInsertTable}
          className={btnCls(false)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
            <path d="M3 10h18M3 15h18M9 4v16M15 4v16" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>

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
          if (editable && e.button === 0) {
            const colHit = hitTableColumnResize(ed, e.clientX, e.clientY);
            if (colHit) {
              startTableColumnResize(e, colHit);
              return;
            }
          }
          handleYouTubeEmbedMouseDown(e);
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
          if (!ed) return;
          sanitizeCaretFontContext(ed);
          const ytSiblings = ensureYouTubeEmbedCaretSiblingsIn(ed);
          // Fix already-pasted ChatGPT "• …" lines into real lists on focus.
          const lists = promotePseudoListsToNative(ed);
          if (ytSiblings || lists) {
            readCommandState();
            emitHtml();
          }
        }}
        onBlur={() => {
          hideImageToolbar();
          clearYouTubeSelection();
          if (tableToolbarClickRef.current) {
            tableToolbarClickRef.current = false;
            flushEmitHtml();
            return;
          }
          // Keep table menus visible for as long as edit mode stays open.
          flushEmitHtml();
        }}
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
          handleEditorDelete(e);
          handleEditorEnter(e);
          handleEditorShiftEnter(e);
          handleEditorArrowUp(e);
          handleEditorYouTubeArrowDown(e);
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            requestAnimationFrame(() => {
              const ed = editorRef.current;
              if (ed && ensureCaretOnOwnLeftLine(ed)) finishNewLineEditing(ed);
            });
          }
        }}
        onBeforeInput={(e) => {
          const inputEvent = e.nativeEvent as InputEvent;
          const inputType = inputEvent.inputType;
          const nativeEvent = { isComposing: inputEvent.isComposing };
          // Safari/Mac often applies Enter via beforeinput(insertParagraph) *before*
          // keydown — that native path exits empty list items back to the heading.
          if (
            (inputType === 'insertParagraph' || inputType === 'insertLineBreak')
            && !inputEvent.isComposing
          ) {
            // insertLineBreak is Shift+Enter in some engines; leave that to keydown.
            if (inputType === 'insertLineBreak') return;
            pushUndoCheckpoint();
            if (runEditorEnter()) {
              e.preventDefault();
              enterHandledRef.current = true;
              requestAnimationFrame(() => { enterHandledRef.current = false; });
            }
            return;
          }
          if (
            !isRestoringUndoRef.current
            && !inputEvent.isComposing
            && inputType !== 'historyUndo'
            && inputType !== 'historyRedo'
            && inputType !== 'deleteContentBackward'
            && inputType !== 'deleteContentForward'
          ) {
            pushUndoCheckpoint();
          }
          if (inputType === 'deleteContentBackward') {
            if (runEditorBackspace({
              key: 'Backspace',
              preventDefault: () => e.preventDefault(),
              nativeEvent,
            })) {
              e.preventDefault();
            }
            return;
          }
          if (inputType === 'deleteContentForward') {
            if (runEditorForwardDelete({
              key: 'Delete',
              preventDefault: () => e.preventDefault(),
              nativeEvent,
            })) {
              e.preventDefault();
            }
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
            const promoted = promotePseudoListsToNative(live);
            const listsCleared = cleanupOrphanEmptyLists(live);
            const ytChanged = normalizeYouTubeEmbeds(live);
            syncYouTubeRemoveChrome(live);
            const linkChanged = normalizeAutoLinks(live);
            const tableChanged = normalizeTablesInEditor(live);
            if (promoted || listsCleared || ytChanged || linkChanged || tableChanged) {
              readCommandState();
              emitHtml();
            }
            if (tableChanged) syncVisibleTableWraps();
          });
        }}
        onPaste={(e) => {
          // Pasted screenshots/images (e.g. Cmd+V from clipboard) never carry a
          // text/html or text/plain payload — the browser's default paste would
          // insert them as an uncompressed base64 <img> otherwise, bypassing the
          // same size cap file-picker inserts get. Intercept and compress first.
          const pastedFiles = Array.from(e.clipboardData.items || [])
            .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
            .map((item) => item.getAsFile())
            .filter((f): f is File => !!f);
          if (pastedFiles.length > 0) {
            e.preventDefault();
            pastedFiles.forEach((file) => {
              void insertImageFile(file);
            });
            return;
          }
          const pastedHtml = e.clipboardData.getData('text/html').trim();
          const plain = e.clipboardData.getData('text/plain');
          const tableFromHtml = pastedHtml ? extractTableHtmlFromClipboard(pastedHtml) : null;
          if (tableFromHtml) {
            e.preventDefault();
            ensureFocus(true);
            document.execCommand('insertHTML', false, tableFromHtml);
            saveSel();
            const live = editorRef.current;
            if (live) normalizeTablesInEditor(live);
            emitHtml();
            syncVisibleTableWraps();
            return;
          }
          const tableFromPlain = plain ? plainTextToTableHtml(plain) : null;
          if (tableFromPlain) {
            e.preventDefault();
            ensureFocus(true);
            document.execCommand('insertHTML', false, tableFromPlain);
            saveSel();
            const live = editorRef.current;
            if (live) normalizeTablesInEditor(live);
            emitHtml();
            syncVisibleTableWraps();
            return;
          }
          const plainTrimmed = plain.trim();
          // Lists (incl. mixed heading/paragraph + list): insert normalized HTML that
          // keeps all surrounding text and turns pseudo-bullets into real ul/ol.
          const normalizedHtml = clipboardToNormalizedHtml(pastedHtml, plainTrimmed);
          if (normalizedHtml) {
            e.preventDefault();
            ensureFocus(true);
            document.execCommand('insertHTML', false, normalizedHtml);
            saveSel();
            const live = editorRef.current;
            if (live) {
              normalizePastedBlocks(live);
              promotePseudoListsToNative(live);
              normalizeAutoLinks(live);
            }
            readCommandState();
            emitHtml();
            return;
          }
          if (!pastedHtml) {
            const videoId = extractYouTubeVideoId(plainTrimmed);
            const ed = editorRef.current;
            const sel = window.getSelection();
            if (ed && sel?.rangeCount) {
              if (videoId) {
                e.preventDefault();
                insertYouTubeEmbedAtRange(sel.getRangeAt(0), videoId, plainTrimmed);
                syncYouTubeRemoveChrome(ed);
                saveSel();
                emitHtml();
                return;
              }
              if (isPlainUrl(plainTrimmed)) {
                e.preventDefault();
                insertAutoLinkAtRange(sel.getRangeAt(0), plainTrimmed);
                saveSel();
                emitHtml();
                return;
              }
            }
          }
          // Normalize after the browser inserts clipboard HTML (ChatGPT lists, etc.).
          const normalizeAfterPaste = () => {
            const live = editorRef.current;
            if (!live) return;
            normalizePastedBlocks(live);
            live.querySelectorAll('ul, ol').forEach((list) => list.setAttribute('dir', 'auto'));
            normalizeYouTubeEmbeds(live);
            syncYouTubeRemoveChrome(live);
            normalizeAutoLinks(live);
            normalizeTablesInEditor(live);
            readCommandState();
            emitHtml();
          };
          requestAnimationFrame(() => {
            normalizeAfterPaste();
            // Second pass: some browsers finish list/DOM fixes one frame later.
            requestAnimationFrame(normalizeAfterPaste);
          });
        }}
        onMouseMove={handleEditorMouseMove}
        onMouseLeave={(e) => {
          if (!isResizingTableCol.current) clearTableColResizeHover();
          if (isResizingImg.current || imgResizeMode) return;
          const rt = e.relatedTarget;
          if (rt instanceof Node && editorRef.current?.contains(rt)) return;
          // Toolbar (and its overflow menu) are portaled to <body> — leaving the editor onto them must not dismiss.
          if (isNoteImgToolbarUi(rt)) return;
          if (imgOverflowOpenRef.current) return;
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
            return;
          }
          if (editable) {
            const tableCtx = resolveTableContext(event.target as Node, editorRef.current);
            if (tableCtx) {
              showTableToolbar(tableCtx);
            }
            // Keep all table menus visible in edit mode even when clicking outside the table.
            const link = event.target instanceof HTMLElement ? event.target.closest('a[href]') : null;
            if (link instanceof HTMLAnchorElement && !link.closest('.note-yt-player')) {
              event.preventDefault();
              window.open(link.href, '_blank', 'noopener,noreferrer');
              return;
            }
            setHoveredImg(null);
            clearImageSelectionChrome(activeFrameRef.current);
            activeFrameRef.current = null;
            hoveredImgElRef.current = null;
            setImgResizeMode(false);
          }
        }}
        suppressContentEditableWarning
        className={(flexToolbar ? 'min-h-0 flex-1 ' : '') + (verticalScroll ? 'overflow-y-auto ' : 'overflow-x-hidden ') + 'w-full max-w-full min-w-0 break-words whitespace-normal px-4 py-3 leading-normal text-app-text outline-none [overflow-wrap:anywhere] dark:text-gray-100 [&_*]:max-w-full [&_*]:break-words [&_*]:whitespace-normal [&_div]:my-0 [&_p]:my-0 [&_ul]:list-disc [&_ul]:ps-5 [&_ol]:list-decimal [&_ol]:ps-5 [&_li>ul]:mt-0.5 [&_li>ol]:mt-0.5 [&_.note-img-frame]:my-2 [&_.note-img-frame]:block [&_.note-img-frame]:w-fit [&_.note-img-frame]:max-w-full [&_.note-img-frame]:overflow-hidden [&_.note-img-frame]:rounded-xl [&_.note-img-frame]:border [&_.note-img-frame]:border-app-border/50 [&_.note-img-frame]:bg-app-bg/20 [&_.note-img-frame--active]:border-primary/45 [&_.note-img-frame--active]:shadow-sm dark:[&_.note-img-frame]:border-white/12 dark:[&_.note-img-frame]:bg-gray-900/30 dark:[&_.note-img-frame--active]:border-primary/35 [&_.note-img-frame_img]:block [&_.note-img-frame_img]:max-w-full [&_.note-img-frame_img]:h-auto [&_.note-img-frame_img]:object-contain' + (resizable && editable ? ' resize-y' : '')}
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
          {(activeCmds.has('insertUnorderedList') || activeCmds.has('insertOrderedList')) && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); applyList('none'); }}
              className="flex w-full items-center gap-2 border-t border-app-border px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 dark:border-white/10 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <span className="w-4 text-center">✕</span>
              <span>{t.titleRemoveList}</span>
            </button>
          )}
        </div>,
        document.body,
      )}

      {/* Table toolbars — pinned above every table while edit mode is open.
          Use non-focusable spans (not <button>) so Chrome cannot park caret/focus on
          "Line above" when the main formatting toolbar calls ed.focus(). */}
      {editable && tableWraps.map((wrap) => {
        if (!wrap.isConnected) return null;
        const table = wrap.querySelector(`table.${NOTE_TABLE_CLASS}`);
        if (!(table instanceof HTMLTableElement)) return null;
        const cached = tableCtxByWrapRef.current.get(wrap);
        const ctx = (cached?.table.isConnected && wrap.contains(cached.table))
          ? cached
          : resolveTableContextAt(table, cached?.rowIndex ?? 0, cached?.colIndex ?? 0, editorRef.current);
        if (!ctx) return null;
        const wrapKey = wrap.dataset.noteTableId ?? `wrap-${tableWraps.indexOf(wrap)}`;
        let host = tableToolbarHostsRef.current.get(wrap);
        if (!host?.isConnected || !wrap.contains(host)) {
          host = getTableToolbarHost(wrap);
          tableToolbarHostsRef.current.set(wrap, host);
        }
        const tableMenuBtn =
          'note-table-toolbar__btn cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium select-none';
        const onTableMenuDown = (e: React.MouseEvent, action: () => void) => {
          e.preventDefault();
          e.stopPropagation();
          tableToolbarClickRef.current = true;
          action();
        };
        return (
          <span key={wrapKey} style={{ display: 'contents' }}>
            {createPortal(
              <div
                data-note-table-toolbar
                className="note-table-toolbar"
                onMouseDown={(e) => { e.preventDefault(); tableToolbarClickRef.current = true; }}
              >
                <span
                  role="button"
                  tabIndex={-1}
                  title={t.titleInsertLineAboveBlock}
                  onMouseDown={(e) => onTableMenuDown(e, () => { const ed = editorRef.current; if (ed) insertEmptyLineAboveBlock(ed, wrap); })}
                  className={`${tableMenuBtn} font-semibold text-primary hover:bg-primary/10 dark:text-primary-200`}
                >↵ {t.insertLineAboveBlock}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  title={t.titleInsertLineBelowBlock}
                  onMouseDown={(e) => onTableMenuDown(e, () => { const ed = editorRef.current; if (ed) insertEmptyLineBelowBlock(ed, wrap); })}
                  className={`${tableMenuBtn} font-semibold text-primary hover:bg-primary/10 dark:text-primary-200`}
                >↵ {t.insertLineBelowBlock}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  title={t.titleMoveTableUp}
                  onMouseDown={(e) => onTableMenuDown(e, () => moveTableVertically(wrap, 'up'))}
                  className={`${tableMenuBtn} font-semibold text-primary hover:bg-primary/10 dark:text-primary-200`}
                >⤒ {t.moveTableUp}</span>
                <span
                  role="button"
                  tabIndex={-1}
                  title={t.titleMoveTableDown}
                  onMouseDown={(e) => onTableMenuDown(e, () => moveTableVertically(wrap, 'down'))}
                  className={`${tableMenuBtn} font-semibold text-primary hover:bg-primary/10 dark:text-primary-200`}
                >⤓ {t.moveTableDown}</span>
                <span className="mx-0.5 h-4 w-px bg-app-border/60 dark:bg-white/12" />
                <span role="button" tabIndex={-1} title={t.tableAddRowAbove} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => addTableRow(c, 'above'), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>↑ {t.tableAddRowAbove}</span>
                <span role="button" tabIndex={-1} title={t.tableAddRowBelow} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => addTableRow(c, 'below'), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>↓ {t.tableAddRowBelow}</span>
                <span role="button" tabIndex={-1} title={t.tableRemoveRow} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => removeTableRow(c), wrap))} className={`${tableMenuBtn} text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10`}>− {t.tableRemoveRow}</span>
                <span className="mx-0.5 h-4 w-px bg-app-border/60 dark:bg-white/12" />
                <span role="button" tabIndex={-1} title={t.tableAddColBefore} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => addTableColumn(c, 'before'), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>← {t.tableAddColBefore}</span>
                <span role="button" tabIndex={-1} title={t.tableAddColAfter} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => addTableColumn(c, 'after'), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>{t.tableAddColAfter} →</span>
                <span role="button" tabIndex={-1} title={t.tableRemoveCol} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => removeTableColumn(c), wrap))} className={`${tableMenuBtn} text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10`}>− {t.tableRemoveCol}</span>
                <span className="mx-0.5 h-4 w-px bg-app-border/60 dark:bg-white/12" />
                <span role="button" tabIndex={-1} title={t.tableWidenCol} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => adjustTableColumnWidth(c, TABLE_COLUMN_WIDTH_STEP), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>←→ {t.tableWidenCol}</span>
                <span role="button" tabIndex={-1} title={t.tableNarrowCol} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => adjustTableColumnWidth(c, -TABLE_COLUMN_WIDTH_STEP), wrap))} className={`${tableMenuBtn} text-app-text hover:bg-primary/10 dark:text-gray-100`}>→← {t.tableNarrowCol}</span>
                <span className="mx-0.5 h-4 w-px bg-app-border/60 dark:bg-white/12" />
                <span role="button" tabIndex={-1} title={t.tableDelete} onMouseDown={(e) => onTableMenuDown(e, () => runTableAction((c) => { deleteTable(c); return 'deleted'; }, wrap))} className={`${tableMenuBtn} font-semibold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10`}>✕ {t.tableDelete}</span>
              </div>,
              host,
            )}
          </span>
        );
      })}

      {/* Image toolbar — portaled to <body> so overflow:hidden on the frame cannot
          clip controls; positioned from the selected frame's viewport rect so it
          stays attached to the image (not centered across the whole page).
          When the frame is too narrow for every control, keep zoom/resize visible
          and fold the rest into a ⋯ dropdown. */}
      {editable && hoveredImg && createPortal((() => {
        const imgBtn = 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] text-app-text hover:bg-primary/10 dark:text-gray-100';
        const imgMenuBtn = 'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-app-text hover:bg-app-bg dark:text-gray-100 dark:hover:bg-white/5';
        const fr = hoveredImg.frame.getBoundingClientRect();
        const top = Math.max(8, fr.bottom - NOTE_IMG_TOOLBAR_RESERVE_PX);
        const compact = fr.width < NOTE_IMG_TOOLBAR_FULL_MIN_PX;
        const keep = () => { setHoveredImg(syncHoveredImg(hoveredImg.el, hoveredImg.frame)); };
        const leave = (e: React.MouseEvent) => {
          if (isResizingImg.current || imgResizeModeRef.current || imgOverflowOpenRef.current) return;
          const rt = e.relatedTarget;
          if (rt instanceof Node && activeFrameRef.current?.contains(rt)) return;
          if (isNoteImgToolbarUi(rt)) return;
          hideImageToolbar();
        };
        const openOverflow = (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          const menuW = 200;
          setImgOverflowPos({
            left: Math.min(Math.max(8, r.left), window.innerWidth - menuW - 8),
            bottom: Math.max(8, window.innerHeight - r.top + 4),
          });
          setImgOverflowOpen((v) => !v);
        };
        const runOverflowAction = (fn: () => void) => {
          fn();
          setImgOverflowOpen(false);
        };
        const overflowItems = (
          <>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => applyImageAlignment(hoveredImg.el, 'left')); }} className={compact ? imgMenuBtn : imgBtn} title={t.titleLeft}>{compact ? <><span className="w-4 text-center">⬅</span><span>{t.titleLeft}</span></> : '⬅'}</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => applyImageAlignment(hoveredImg.el, 'center')); }} className={compact ? imgMenuBtn : imgBtn} title={t.titleCenter}>{compact ? <><span className="w-4 text-center">⊞</span><span>{t.titleCenter}</span></> : '⊞'}</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => applyImageAlignment(hoveredImg.el, 'right')); }} className={compact ? imgMenuBtn : imgBtn} title={t.titleRight}>{compact ? <><span className="w-4 text-center">➡</span><span>{t.titleRight}</span></> : '➡'}</button>
            {compact ? <div className="my-1 border-t border-app-border/60 dark:border-white/12" /> : <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-app-border/60 dark:bg-white/12" />}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runOverflowAction(() => {
                  const ed = editorRef.current;
                  if (ed) insertEmptyLineAboveBlock(ed, hoveredImg.frame);
                });
              }}
              className={compact ? `${imgMenuBtn} font-semibold text-primary dark:text-primary-200` : `${imgBtn} font-semibold text-primary dark:text-primary-200`}
              title={t.titleInsertLineAboveBlock}
            >
              {compact ? <><span className="w-4 text-center">↵</span><span>{t.insertLineAboveBlock}</span></> : '↵↑'}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                runOverflowAction(() => {
                  const ed = editorRef.current;
                  if (ed) insertEmptyLineBelowBlock(ed, hoveredImg.frame);
                });
              }}
              className={compact ? `${imgMenuBtn} font-semibold text-primary dark:text-primary-200` : `${imgBtn} font-semibold text-primary dark:text-primary-200`}
              title={t.titleInsertLineBelowBlock}
            >
              {compact ? <><span className="w-4 text-center">↵</span><span>{t.insertLineBelowBlock}</span></> : '↵↓'}
            </button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => moveImageVertically(hoveredImg.el, 'up')); }} className={compact ? imgMenuBtn : imgBtn} title={t.titleMoveImageUp}>{compact ? <><span className="w-4 text-center">↑</span><span>{t.titleMoveImageUp}</span></> : '↑'}</button>
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => moveImageVertically(hoveredImg.el, 'down')); }} className={compact ? imgMenuBtn : imgBtn} title={t.titleMoveImageDown}>{compact ? <><span className="w-4 text-center">↓</span><span>{t.titleMoveImageDown}</span></> : '↓'}</button>
            {compact ? <div className="my-1 border-t border-app-border/60 dark:border-white/12" /> : <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-app-border/60 dark:bg-white/12" />}
            {!compact && (
              <>
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewImage(hoveredImg.el.currentSrc || hoveredImg.el.src); setPreviewZoom(1); naturalSizeRef.current = null; activeFrameRef.current?.classList.remove('note-img-frame--resizing'); setImgResizeMode(false); }} className={imgBtn} title="Zoom">🔍</button>
                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImgResizeMode((v) => {
                  const next = !v;
                  activeFrameRef.current?.classList.toggle('note-img-frame--resizing', next);
                  return next;
                }); }} className={imgBtn + (imgResizeMode ? ' bg-primary/15 text-primary' : '')} title={t.titleResizeImage}>↔</button>
              </>
            )}
            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); runOverflowAction(() => { deleteImageWithUndo(hoveredImg.el); }); }} className={compact ? 'flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15' : 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/15'} title={t.titleDel}>{compact ? <><span className="w-4 text-center">✕</span><span>{t.titleDel}</span></> : '✕'}</button>
          </>
        );
        return (
          <>
            <div
              style={{
                position: 'fixed',
                left: fr.left,
                width: Math.max(fr.width, 1),
                top,
                zIndex: 100000,
                display: 'flex',
                justifyContent: 'center',
                overflow: 'visible',
                pointerEvents: 'none',
              }}
            >
              <div
                className={`${NOTE_IMG_TOOLBAR} flex w-max max-w-full flex-nowrap items-center justify-center gap-0.5 rounded-lg border border-app-border/60 bg-white/96 px-1.5 py-1 shadow-[0_4px_16px_rgba(15,23,42,0.14)] dark:border-white/10 dark:bg-gray-900/96 dark:shadow-[0_4px_16px_rgba(0,0,0,0.45)]`}
                style={{ pointerEvents: 'auto' }}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={keep}
                onMouseLeave={leave}
              >
                {compact ? (
                  <>
                    <button
                      ref={imgOverflowBtnRef}
                      type="button"
                      onClick={openOverflow}
                      className={imgBtn + (imgOverflowOpen ? ' bg-primary/15 text-primary' : '')}
                      title="More"
                      aria-haspopup="menu"
                      aria-expanded={imgOverflowOpen}
                    >
                      ⋯
                    </button>
                    <span className="mx-0.5 h-4 w-px flex-shrink-0 bg-app-border/60 dark:bg-white/12" />
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImgOverflowOpen(false); setPreviewImage(hoveredImg.el.currentSrc || hoveredImg.el.src); setPreviewZoom(1); naturalSizeRef.current = null; activeFrameRef.current?.classList.remove('note-img-frame--resizing'); setImgResizeMode(false); }} className={imgBtn} title="Zoom">🔍</button>
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setImgOverflowOpen(false); setImgResizeMode((v) => {
                      const next = !v;
                      activeFrameRef.current?.classList.toggle('note-img-frame--resizing', next);
                      return next;
                    }); }} className={imgBtn + (imgResizeMode ? ' bg-primary/15 text-primary' : '')} title={t.titleResizeImage}>↔</button>
                  </>
                ) : overflowItems}
              </div>
            </div>
            {compact && imgOverflowOpen && (
              <div
                ref={imgOverflowMenuRef}
                role="menu"
                className={`${NOTE_IMG_TOOLBAR} fixed z-[100002] min-w-[184px] overflow-hidden rounded-xl border border-app-border bg-white py-1 shadow-xl dark:border-white/10 dark:bg-gray-800`}
                style={{ left: imgOverflowPos.left, bottom: imgOverflowPos.bottom }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onMouseEnter={keep}
              >
                {overflowItems}
              </div>
            )}
          </>
        );
      })(), document.body)}

      {/* Image resize handles — only after tapping ↔ (avoids accidental resize when viewing).
          Portaled to <body> so position:fixed is viewport-relative even inside
          transformed ancestors (modals/cards), keeping handles glued to the edges. */}
      {editable && hoveredImg && imgResizeMode && createPortal((() => {
        const r = hoveredImg.rect;
        const keep = () => { setHoveredImg(syncHoveredImg(hoveredImg.el, hoveredImg.frame)); };
        const leave = () => { if (!isResizingImg.current && !imgOverflowOpenRef.current) hideImageToolbar(); };
        const base = 'flex items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-lg';
        const H = 26; // handle size (px) — larger = easier to grab on touch
        const half = H / 2;
        return (
          <>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'width')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeWidth}
              style={{ position: 'fixed', left: r.right - half, top: r.top + r.height / 2 - half, width: H, height: H, zIndex: 100000, cursor: 'ew-resize', touchAction: 'none' }}
              className={base}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 7 L4 12 L9 17 M15 7 L20 12 L15 17" />
              </svg>
            </div>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'height')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeHeight}
              style={{ position: 'fixed', left: r.left + r.width / 2 - half, top: r.bottom - half, width: H, height: H, zIndex: 100000, cursor: 'ns-resize', touchAction: 'none' }}
              className={base}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 9 L12 4 L17 9 M7 15 L12 20 L17 15" />
              </svg>
            </div>
            <div
              onPointerDown={(e) => startImageResize(e, hoveredImg.el, 'both')}
              onMouseEnter={keep}
              onMouseLeave={leave}
              title={t.titleResizeImage}
              style={{ position: 'fixed', left: r.right - half, top: r.bottom - half, width: H, height: H, zIndex: 100001, cursor: 'nwse-resize', touchAction: 'none' }}
              className={base}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M10 3 L3 10" />
                <path d="M10 7.5 L7.5 10" />
              </svg>
            </div>
          </>
        );
      })(), document.body)}

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
