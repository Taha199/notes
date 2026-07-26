type TableCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertUnorderedList'
  | 'insertOrderedList';
type TableAlign = 'left' | 'center' | 'right';

let savedTableRange: Range | null = null;

function editableRoot(node: Node | null): HTMLElement | null {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  const root = el?.closest?.('[contenteditable="true"]');
  return root instanceof HTMLElement ? root : null;
}

function closestCell(node: Node | null): HTMLTableCellElement | null {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  const cell = el?.closest?.('td, th');
  return cell instanceof HTMLTableCellElement ? cell : null;
}

function rangeInsideEditorTable(range: Range): boolean {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return false;
  return !!(
    closestCell(range.commonAncestorContainer)
    || closestCell(range.startContainer)
    || closestCell(range.endContainer)
  );
}

function rememberTableSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (rangeInsideEditorTable(range)) savedTableRange = range.cloneRange();
}

function selectedRange(): Range | null {
  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const live = selection.getRangeAt(0);
    if (rangeInsideEditorTable(live)) return live.cloneRange();
  }
  if (savedTableRange && rangeInsideEditorTable(savedTableRange)) return savedTableRange.cloneRange();
  return null;
}

function cellHasText(cell: HTMLTableCellElement): boolean {
  return (cell.textContent ?? '').replace(/[\u200B\u00A0]/g, ' ').trim().length > 0;
}

function cellsInRange(range: Range, root: HTMLElement): HTMLTableCellElement[] {
  const cells: HTMLTableCellElement[] = [];
  root.querySelectorAll('td, th').forEach((node) => {
    if (!(node instanceof HTMLTableCellElement)) return;
    try {
      if (range.intersectsNode(node)) cells.push(node);
    } catch {
      // Detached nodes can briefly exist while contenteditable mutates.
    }
  });
  if (cells.length > 0) return cells;
  const fallback = closestCell(range.commonAncestorContainer) ?? closestCell(range.startContainer) ?? closestCell(range.endContainer);
  return fallback && root.contains(fallback) ? [fallback] : [];
}

function intersectCell(range: Range, cell: HTMLTableCellElement): Range | null {
  const full = document.createRange();
  full.selectNodeContents(cell);
  if (range.collapsed) return cellHasText(cell) ? full : null;

  const out = full.cloneRange();
  try {
    if (range.compareBoundaryPoints(Range.START_TO_START, full) > 0) {
      out.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, full) < 0) {
      out.setEnd(range.endContainer, range.endOffset);
    }
  } catch {
    return cellHasText(cell) ? full : null;
  }
  return out.collapsed ? null : out;
}

function dispatchEditorInput(root: HTMLElement) {
  root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'formatSetBlockTextDirection' }));
}

function applyCommand(range: Range, command: TableCommand, value?: string) {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return false;
  const parts = cellsInRange(range, root)
    .map((cell) => intersectCell(range, cell))
    .filter((part): part is Range => !!part && !part.collapsed);
  if (parts.length === 0) return false;

  root.focus({ preventScroll: true });
  const selection = window.getSelection();
  parts.forEach((part) => {
    selection?.removeAllRanges();
    selection?.addRange(part);
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
  });
  savedTableRange = parts[parts.length - 1].cloneRange();
  dispatchEditorInput(root);
  return true;
}

function applyAlignment(range: Range, align: TableAlign) {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return false;
  const cells = cellsInRange(range, root);
  if (cells.length === 0) return false;
  cells.forEach((cell) => {
    cell.style.textAlign = align;
    cell.removeAttribute('align');
  });
  dispatchEditorInput(root);
  return true;
}

function wrapRange(range: Range, style: Partial<CSSStyleDeclaration>) {
  try {
    const span = document.createElement('span');
    Object.assign(span.style, style);
    span.appendChild(range.extractContents());
    range.insertNode(span);
    return span;
  } catch {
    return null;
  }
}

function applyInlineStyle(range: Range, style: Partial<CSSStyleDeclaration>) {
  const root = editableRoot(range.commonAncestorContainer);
  if (!root) return false;
  const parts = cellsInRange(range, root)
    .map((cell) => intersectCell(range, cell))
    .filter((part): part is Range => !!part && !part.collapsed);
  if (parts.length === 0) return false;

  const spans = parts.map((part) => wrapRange(part, style)).filter((span): span is HTMLSpanElement => !!span);
  if (spans.length > 0) {
    const next = document.createRange();
    if (spans.length === 1) next.selectNodeContents(spans[0]);
    else {
      next.setStartBefore(spans[0]);
      next.setEndAfter(spans[spans.length - 1]);
    }
    savedTableRange = next.cloneRange();
  }
  dispatchEditorInput(root);
  return spans.length > 0;
}

function applyFontSize(range: Range, px: number) {
  return applyInlineStyle(range, { fontSize: `${px}px`, lineHeight: '1.45' });
}

function applyTextColor(range: Range, color: string) {
  return applyInlineStyle(range, { color });
}

function applyHighlight(range: Range, color: string) {
  return applyInlineStyle(range, { backgroundColor: color });
}

function nearestToolbar(button: HTMLButtonElement): HTMLElement | null {
  return button.closest('.flex.min-w-0.max-w-full.flex-wrap, [data-rich-text-toolbar]');
}

function fontSizeFromToolbarButton(button: HTMLButtonElement, range: Range): number | null {
  const label = (button.textContent ?? '').trim();
  if (label !== '+' && label !== '-' && label !== '−') return null;
  const group = button.parentElement;
  const input = group?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) return null;
  const root = editableRoot(range.startContainer);
  const cell = closestCell(range.startContainer) ?? closestCell(range.commonAncestorContainer);
  const current = Number.parseInt(input.value, 10) || Number.parseInt(window.getComputedStyle(cell ?? root!).fontSize, 10) || 15;
  const sizes = [10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28, 32, 36, 48];
  if (label === '+') return sizes.find((size) => size > current) ?? sizes[sizes.length - 1];
  return [...sizes].reverse().find((size) => size < current) ?? sizes[0];
}

function colorFromSwatch(target: Element): string | null {
  const el = target instanceof HTMLElement ? target : target.closest('div, button');
  if (!(el instanceof HTMLElement)) return null;
  const bg = el.style.background || el.style.backgroundColor;
  if (!bg || bg === 'transparent') return null;
  const rect = el.getBoundingClientRect();
  if (rect.width > 40 || rect.height > 40) return null;
  return bg;
}

function isTextColorPalette(target: Element): boolean {
  const palette = target.closest('.fixed.z-\\[9999\\].grid');
  return palette instanceof HTMLElement && palette.className.includes('w-[184px]');
}

function isHighlightPalette(target: Element): boolean {
  const palette = target.closest('.fixed.z-\\[9999\\].grid');
  return palette instanceof HTMLElement && palette.className.includes('w-[164px]');
}

function buttonCommand(button: HTMLButtonElement): TableCommand | null {
  const label = (button.textContent ?? '').trim().toUpperCase();
  const title = (button.getAttribute('title') ?? '').toLowerCase();
  if (label === 'B' || /bold|fet|غامق|تغميق/.test(title)) return 'bold';
  if (label === 'I' || label === '/' || /italic|kursiv|مائل/.test(title)) return 'italic';
  if (label === 'U' || /underline|understr|تحته|تسطير/.test(title)) return 'underline';
  if (label === 'S' || /strike|genomstr|شطب/.test(title)) return 'strikeThrough';
  if (/bullet|punktlista|قائمة نقط/.test(title)) return 'insertUnorderedList';
  if (/numbered|numrerad|قائمة رقم/.test(title)) return 'insertOrderedList';
  return null;
}

function buttonAlignment(button: HTMLButtonElement): TableAlign | null {
  const title = (button.getAttribute('title') ?? '').toLowerCase();
  if (/left|vänster|يسار/.test(title)) return 'left';
  if (/center|centr|mitten|وسط|منتصف/.test(title)) return 'center';
  if (/right|höger|يمين/.test(title)) return 'right';
  return null;
}

document.addEventListener('selectionchange', rememberTableSelection);

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.closest('.flex.items-center.overflow-hidden')) {
    rememberTableSelection();
  }
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || event.key !== 'Enter') return;
  const range = selectedRange();
  if (!range || !target.closest('.flex.items-center.overflow-hidden')) return;
  const px = Number.parseInt(target.value, 10);
  if (!px) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  applyFontSize(range, Math.max(8, Math.min(96, px)));
  target.blur();
}, true);

document.addEventListener('blur', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const range = selectedRange();
  if (!range || !target.closest('.flex.items-center.overflow-hidden')) return;
  const px = Number.parseInt(target.value, 10);
  if (px) applyFontSize(range, Math.max(8, Math.min(96, px)));
}, true);

document.addEventListener('mousedown', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const range = selectedRange();
  if (!range) return;

  const paletteColor = colorFromSwatch(target);
  if (paletteColor && isTextColorPalette(target)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyTextColor(range, paletteColor);
    return;
  }
  if (paletteColor && isHighlightPalette(target)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyHighlight(range, paletteColor);
    return;
  }

  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.closest('[data-note-table-toolbar], .note-table-toolbar')) return;
  if (!nearestToolbar(button) && !button.closest('.fixed.z-\\[9999\\]')) return;

  const nextFontSize = fontSizeFromToolbarButton(button, range);
  if (nextFontSize) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyFontSize(range, nextFontSize);
    return;
  }

  const command = buttonCommand(button);
  if (command) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyCommand(range, command);
    return;
  }

  const align = buttonAlignment(button);
  if (align) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    applyAlignment(range, align);
    return;
  }
}, true);
