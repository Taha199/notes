/** Table structure tags that must never be pulled out via extractContents/wrap. */
export const TABLE_STRUCTURE_TAGS = new Set([
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'COLGROUP', 'COL',
]);

export function closestTableCell(node: Node | null): HTMLTableCellElement | null {
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
  const cell = el?.closest?.('td, th');
  return cell instanceof HTMLTableCellElement ? cell : null;
}

export function cellHasVisibleText(cell: HTMLElement): boolean {
  return (cell.textContent?.replace(/[\u200B\u00A0]/g, ' ').trim() ?? '').length > 0;
}

export function collectTableCellsInRange(range: Range, ed: HTMLElement): HTMLTableCellElement[] {
  const cells: HTMLTableCellElement[] = [];
  ed.querySelectorAll('td, th').forEach((node) => {
    if (!(node instanceof HTMLTableCellElement) || !ed.contains(node)) return;
    try {
      if (range.intersectsNode(node)) cells.push(node);
    } catch {
      /* detached */
    }
  });
  if (cells.length > 0) return cells;
  // Fallback when intersectsNode is unreliable (some engines / edge selections).
  const fallback = closestTableCell(range.commonAncestorContainer)
    ?? closestTableCell(range.startContainer)
    ?? closestTableCell(range.endContainer);
  return fallback && ed.contains(fallback) ? [fallback] : [];
}

/**
 * Intersect `range` with a cell's contents so formatting never wraps/extracts the cell itself.
 *
 * IMPORTANT: Do NOT use compareBoundaryPoints(END_TO_START / START_TO_END) for overlap tests.
 * In Chromium those how-values return the opposite sign of a naive WHATWG reading, so the old
 * `<= 0` / `>= 0` early-returns rejected EVERY overlapping in-cell selection and left Bold/etc
 * falling through to execCommand (no-op inside table cells).
 */
export function intersectRangeWithCellContents(
  range: Range,
  cell: HTMLTableCellElement,
): Range | null {
  let overlaps = false;
  try {
    overlaps = range.intersectsNode(cell);
  } catch {
    overlaps = false;
  }
  if (!overlaps) {
    const startCell = closestTableCell(range.startContainer);
    const endCell = closestTableCell(range.endContainer);
    if (startCell !== cell && endCell !== cell) return null;
  }

  const cellRange = document.createRange();
  cellRange.selectNodeContents(cell);
  const out = cellRange.cloneRange();
  try {
    // START_TO_START / END_TO_END clipping is reliable in Chromium; only the
    // END_TO_START / START_TO_END overlap pre-check was wrong.
    if (range.compareBoundaryPoints(Range.START_TO_START, cellRange) > 0) {
      out.setStart(range.startContainer, range.startOffset);
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, cellRange) < 0) {
      out.setEnd(range.endContainer, range.endOffset);
    }
  } catch {
    return cellHasVisibleText(cell) ? cellRange : null;
  }

  if (out.collapsed) return null;
  const ancestor = out.commonAncestorContainer;
  if (ancestor !== cell && !cell.contains(ancestor)) {
    return cellHasVisibleText(cell) ? cellRange : null;
  }
  return out;
}

/** True when the range boundary sits on a row/table node (selectNode(td) / row selection). */
export function rangeBoundaryOnTableStructure(node: Node): boolean {
  return node instanceof Element
    && TABLE_STRUCTURE_TAGS.has(node.tagName)
    && node.tagName !== 'TD'
    && node.tagName !== 'TH';
}

/**
 * True only when formatting must be applied per-cell (multi-cell selection, or the
 * range sits on table structure nodes). A normal text selection inside ONE cell —
 * including when commonAncestor is the TD because the selection spans inline nodes —
 * is safe for extractContents. Only selectNode(td/tr/table) needs clipping.
 */
export function rangeNeedsPerCellFormat(range: Range, ed: HTMLElement): boolean {
  if (range.collapsed) return false;
  const startCell = closestTableCell(range.startContainer);
  const endCell = closestTableCell(range.endContainer);
  if (startCell && endCell && startCell !== endCell) return true;

  if (rangeBoundaryOnTableStructure(range.startContainer)
    || rangeBoundaryOnTableStructure(range.endContainer)) {
    return true;
  }

  const ancestor = range.commonAncestorContainer;
  if (ancestor instanceof Element && rangeBoundaryOnTableStructure(ancestor)) {
    return true;
  }

  // TD/TH as commonAncestor with both endpoints in that same cell → direct wrap is safe.
  if (
    ancestor instanceof Element
    && (ancestor.tagName === 'TD' || ancestor.tagName === 'TH')
    && startCell
    && startCell === endCell
    && startCell === ancestor
  ) {
    return false;
  }

  // intersectsNode can over-report in WebKit; require real content intersections.
  const subs = collectTableCellsInRange(range, ed)
    .map((cell) => intersectRangeWithCellContents(range, cell))
    .filter((sub): sub is Range => !!sub && !sub.collapsed);
  return subs.length > 1;
}

/** Split a selection into table-safe sub-ranges for DOM wrap formatting. */
export function collectFormatTargetRanges(range: Range, ed: HTMLElement): Range[] {
  if (range.collapsed) return [];
  if (rangeNeedsPerCellFormat(range, ed)) {
    const subs = collectTableCellsInRange(range, ed)
      .map((cell) => intersectRangeWithCellContents(range, cell))
      .filter((sub): sub is Range => !!sub && !sub.collapsed);
    if (subs.length > 0) return subs;
    // Never return [] for an in-cell selection — that falls through to execCommand no-op.
    const cell = closestTableCell(range.commonAncestorContainer)
      ?? closestTableCell(range.startContainer)
      ?? closestTableCell(range.endContainer);
    if (cell && ed.contains(cell)) {
      const clipped = intersectRangeWithCellContents(range, cell);
      if (clipped && !clipped.collapsed) return [clipped];
      const all = document.createRange();
      all.selectNodeContents(cell);
      if (!all.collapsed) return [all];
    }
    return [];
  }
  return [range.cloneRange()];
}
