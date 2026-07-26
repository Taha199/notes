type TableCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough';
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
      // Ignore detached nodes.
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

function applyCommand(range: Range, command: TableCommand) {
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
    document.execCommand(command, false);
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

function buttonCommand(button: HTMLButtonElement): TableCommand | null {
  const label = (button.textContent ?? '').trim().toUpperCase();
  const title = (button.getAttribute('title') ?? '').toLowerCase();
  if (label === 'B' || /bold|fet|غامق|تغميق/.test(title)) return 'bold';
  if (label === 'I' || label === '/' || /italic|kursiv|مائل/.test(title)) return 'italic';
  if (label === 'U' || /underline|understr|تحته|تسطير/.test(title)) return 'underline';
  if (label === 'S' || /strike|genomstr|شطب/.test(title)) return 'strikeThrough';
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

document.addEventListener('mousedown', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button');
  if (!(button instanceof HTMLButtonElement)) return;
  if (button.closest('[data-note-table-toolbar], .note-table-toolbar')) return;

  const range = selectedRange();
  if (!range) return;

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
  }
}, true);
