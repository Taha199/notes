export const NOTE_TABLE_CLASS = 'note-table';
export const NOTE_TABLE_WRAP = 'note-table-wrap';
export const NOTE_TABLE_ACTIVE_WRAP = 'note-table-wrap--active';
export const NOTE_TABLE_TOOLBAR_HOST = 'note-table-toolbar-host';
export const NOTE_TABLE_BODY = 'note-table-body';

export type TableCellContext = {
  table: HTMLTableElement;
  wrap: HTMLElement;
  cell: HTMLTableCellElement;
  row: HTMLTableRowElement;
  rowIndex: number;
  colIndex: number;
};

function emptyCell(tag: 'th' | 'td') {
  const cell = document.createElement(tag);
  cell.setAttribute('dir', 'auto');
  cell.innerHTML = '&nbsp;';
  return cell;
}

function tableRows(table: HTMLTableElement) {
  return [...table.querySelectorAll('tr')];
}

function rowCells(row: HTMLTableRowElement): HTMLTableCellElement[] {
  return [...row.querySelectorAll<HTMLTableCellElement>('th, td')];
}

export function resolveTableContext(node: Node | null, root?: HTMLElement | null): TableCellContext | null {
  if (!node) return null;
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
  const cell = el?.closest('td, th');
  if (!(cell instanceof HTMLTableCellElement)) return null;
  const table = cell.closest('table');
  if (!(table instanceof HTMLTableElement)) return null;
  if (!table.classList.contains(NOTE_TABLE_CLASS)) table.classList.add(NOTE_TABLE_CLASS);
  if (root && !root.contains(table)) return null;
  const wrap = table.closest(`.${NOTE_TABLE_WRAP}`);
  if (!(wrap instanceof HTMLElement)) return null;
  const row = cell.closest('tr');
  if (!(row instanceof HTMLTableRowElement)) return null;
  const rows = tableRows(table);
  const rowIndex = rows.indexOf(row);
  const colIndex = rowCells(row).indexOf(cell);
  if (rowIndex < 0 || colIndex < 0) return null;
  return { table, wrap, cell, row, rowIndex, colIndex };
}

export function resolveTableContextAt(
  table: HTMLTableElement,
  rowIndex: number,
  colIndex: number,
  root?: HTMLElement | null,
): TableCellContext | null {
  if (root && !root.contains(table)) return null;
  const wrap = table.closest(`.${NOTE_TABLE_WRAP}`);
  if (!(wrap instanceof HTMLElement)) return null;
  const rows = tableRows(table);
  const row = rows[Math.max(0, Math.min(rowIndex, rows.length - 1))];
  if (!row) return null;
  const cells = rowCells(row);
  const cell = cells[Math.max(0, Math.min(colIndex, cells.length - 1))];
  if (!cell) return null;
  return {
    table,
    wrap,
    cell,
    row,
    rowIndex: rows.indexOf(row),
    colIndex: cells.indexOf(cell),
  };
}

export function placeCaretInTableCell(cell: HTMLTableCellElement) {
  const range = document.createRange();
  range.selectNodeContents(cell);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export type TableEditPosition = { rowIndex: number; colIndex: number };

function newRowFromReference(refRow: HTMLTableRowElement, forceBody = false) {
  const newRow = document.createElement('tr');
  rowCells(refRow).forEach((refCell) => {
    const tag = forceBody ? 'td' : (refCell.tagName === 'TH' ? 'th' : 'td');
    newRow.appendChild(emptyCell(tag));
  });
  return newRow;
}

function tableBody(table: HTMLTableElement) {
  return table.tBodies[0] ?? table.createTBody();
}

export function addTableRow(ctx: TableCellContext, position: 'above' | 'below'): TableEditPosition {
  const inHead = ctx.row.parentElement?.tagName === 'THEAD';
  if (position === 'below' && inHead) {
    const tbody = tableBody(ctx.table);
    const newRow = newRowFromReference(ctx.row, true);
    tbody.insertBefore(newRow, tbody.firstChild);
    const rows = tableRows(ctx.table);
    const rowIndex = rows.indexOf(newRow);
    return { rowIndex, colIndex: ctx.colIndex };
  }
  const newRow = newRowFromReference(ctx.row, false);
  if (position === 'above') ctx.row.before(newRow);
  else ctx.row.after(newRow);
  const rows = tableRows(ctx.table);
  return {
    rowIndex: rows.indexOf(newRow),
    colIndex: ctx.colIndex,
  };
}

export function removeTableRow(ctx: TableCellContext): TableEditPosition | false {
  const rows = tableRows(ctx.table);
  if (rows.length <= 1) return false;
  const nextIndex = Math.min(ctx.rowIndex, rows.length - 2);
  const nextCol = ctx.colIndex;
  ctx.row.remove();
  return { rowIndex: Math.max(0, nextIndex), colIndex: nextCol };
}

/** Percent of table width per narrow/widen click. */
export const TABLE_COLUMN_WIDTH_STEP = 5;
/** Floor so a column cannot collapse to zero. */
export const TABLE_COLUMN_WIDTH_MIN = 10;

function tableColumnCount(table: HTMLTableElement): number {
  const firstRow = tableRows(table)[0];
  return firstRow ? rowCells(firstRow).length : 0;
}

function parsePercentWidth(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.trim().match(/^([\d.]+)\s*%$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function equalColumnWidths(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor((10000 / count)) / 100;
  const widths = Array.from({ length: count }, () => base);
  const sum = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] = Math.round((widths[widths.length - 1] + (100 - sum)) * 100) / 100;
  return widths;
}

function normalizeColumnWidths(widths: number[], min = TABLE_COLUMN_WIDTH_MIN): number[] {
  const count = widths.length;
  if (count === 0) return [];
  const cappedMin = Math.min(min, Math.floor(100 / count));
  let next = widths.map((w) => (Number.isFinite(w) && w > 0 ? w : 100 / count));
  // Lift anything below the floor first.
  next = next.map((w) => Math.max(w, cappedMin));
  let sum = next.reduce((a, b) => a + b, 0);
  if (sum > 100) {
    let excess = sum - 100;
    // Shrink columns that are above the floor, proportionally.
    for (let pass = 0; pass < 8 && excess > 0.01; pass += 1) {
      const shrinkable = next
        .map((w, i) => ({ i, room: w - cappedMin }))
        .filter((x) => x.room > 0.01);
      const roomSum = shrinkable.reduce((a, x) => a + x.room, 0);
      if (roomSum <= 0) break;
      shrinkable.forEach(({ i, room }) => {
        const take = Math.min(room, (room / roomSum) * excess);
        next[i] -= take;
      });
      sum = next.reduce((a, b) => a + b, 0);
      excess = sum - 100;
    }
  } else if (sum < 100) {
    const deficit = 100 - sum;
    next = next.map((w) => w + deficit / count);
  }
  // Round to 1 decimal and fix leftover on the last column.
  next = next.map((w) => Math.round(w * 10) / 10);
  const roundedSum = next.reduce((a, b) => a + b, 0);
  next[next.length - 1] = Math.round((next[next.length - 1] + (100 - roundedSum)) * 10) / 10;
  return next;
}

function measureColumnWidths(table: HTMLTableElement, count: number): number[] {
  if (count <= 0) return [];
  const tableWidth = table.getBoundingClientRect().width;
  if (tableWidth <= 0) return equalColumnWidths(count);
  const firstRow = tableRows(table)[0];
  if (!firstRow) return equalColumnWidths(count);
  const cells = rowCells(firstRow);
  const measured = cells.slice(0, count).map((cell) => {
    const w = cell.getBoundingClientRect().width;
    return w > 0 ? (w / tableWidth) * 100 : 100 / count;
  });
  while (measured.length < count) measured.push(100 / count);
  return normalizeColumnWidths(measured);
}

function readStoredColumnWidths(table: HTMLTableElement, count: number): number[] | null {
  if (count <= 0) return null;
  const cols = [...table.querySelectorAll(':scope > colgroup > col')];
  if (cols.length === count) {
    const fromCols = cols.map((col) => {
      if (!(col instanceof HTMLElement)) return null;
      return parsePercentWidth(col.style.width) ?? parsePercentWidth(col.getAttribute('width'));
    });
    if (fromCols.every((w): w is number => w != null)) {
      return normalizeColumnWidths(fromCols);
    }
  }
  // Fallback: percentage width on the first-row cells (legacy).
  const firstRow = tableRows(table)[0];
  if (!firstRow) return null;
  const cells = rowCells(firstRow);
  if (cells.length !== count) return null;
  const fromCells = cells.map((cell) => (
    parsePercentWidth(cell.style.width) ?? parsePercentWidth(cell.getAttribute('width'))
  ));
  if (fromCells.every((w): w is number => w != null)) {
    return normalizeColumnWidths(fromCells);
  }
  return null;
}

function ensureColgroup(table: HTMLTableElement, count: number, widths?: number[]): void {
  let colgroup = table.querySelector(':scope > colgroup');
  if (!(colgroup instanceof HTMLElement)) {
    colgroup = document.createElement('colgroup');
    table.insertBefore(colgroup, table.firstChild);
  }
  const resolved = normalizeColumnWidths(
    widths ?? readStoredColumnWidths(table, count) ?? measureColumnWidths(table, count),
  );
  while (colgroup.childElementCount > count) colgroup.lastElementChild?.remove();
  while (colgroup.childElementCount < count) {
    colgroup.appendChild(document.createElement('col'));
  }
  [...colgroup.children].forEach((node, i) => {
    if (!(node instanceof HTMLElement)) return;
    const pct = resolved[i] ?? (100 / Math.max(count, 1));
    node.style.width = `${pct}%`;
    node.removeAttribute('width');
  });
  // Prefer colgroup as the single source of truth — clear cell width hints.
  table.querySelectorAll('th, td').forEach((cell) => {
    if (!(cell instanceof HTMLElement)) return;
    cell.style.removeProperty('width');
    cell.removeAttribute('width');
  });
  table.style.tableLayout = 'fixed';
}

export function adjustTableColumnWidth(
  ctx: TableCellContext,
  deltaPercent: number,
): TableEditPosition {
  const count = tableColumnCount(ctx.table);
  if (count <= 0 || ctx.colIndex < 0 || ctx.colIndex >= count) {
    return { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex };
  }
  const min = Math.min(TABLE_COLUMN_WIDTH_MIN, Math.floor(100 / count));
  const widths = readStoredColumnWidths(ctx.table, count) ?? measureColumnWidths(ctx.table, count);
  const target = widths[ctx.colIndex];
  const max = 100 - min * (count - 1);
  const nextTarget = Math.min(max, Math.max(min, target + deltaPercent));
  const actualDelta = nextTarget - target;
  if (Math.abs(actualDelta) < 0.05) {
    ensureColgroup(ctx.table, count, widths);
    return { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex };
  }

  widths[ctx.colIndex] = nextTarget;
  const otherIndexes = widths.map((_, i) => i).filter((i) => i !== ctx.colIndex);
  if (otherIndexes.length === 0) {
    ensureColgroup(ctx.table, count, widths);
    return { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex };
  }

  if (actualDelta > 0) {
    let need = actualDelta;
    for (let pass = 0; pass < 8 && need > 0.01; pass += 1) {
      const donors = otherIndexes.filter((i) => widths[i] - min > 0.01);
      const roomSum = donors.reduce((a, i) => a + (widths[i] - min), 0);
      if (roomSum <= 0) break;
      let taken = 0;
      donors.forEach((i) => {
        const room = widths[i] - min;
        const take = Math.min(room, (room / roomSum) * need);
        widths[i] -= take;
        taken += take;
      });
      need -= taken;
    }
    // If donors ran out of room, clamp the target back.
    if (need > 0.01) widths[ctx.colIndex] -= need;
  } else {
    const share = (-actualDelta) / otherIndexes.length;
    otherIndexes.forEach((i) => {
      widths[i] += share;
    });
  }

  ensureColgroup(ctx.table, count, normalizeColumnWidths(widths, min));
  return { rowIndex: ctx.rowIndex, colIndex: ctx.colIndex };
}

export function addTableColumn(ctx: TableCellContext, position: 'before' | 'after'): TableEditPosition {
  const prevCount = tableColumnCount(ctx.table);
  const prevWidths = prevCount > 0
    ? (readStoredColumnWidths(ctx.table, prevCount) ?? measureColumnWidths(ctx.table, prevCount))
    : [];
  tableRows(ctx.table).forEach((row) => {
    const cells = rowCells(row);
    const refCell = cells[ctx.colIndex];
    if (!refCell) return;
    const tag = refCell.tagName === 'TH' ? 'th' : 'td';
    const newCell = emptyCell(tag);
    if (position === 'before') refCell.before(newCell);
    else refCell.after(newCell);
  });
  const insertAt = position === 'before' ? ctx.colIndex : ctx.colIndex + 1;
  const nextCount = prevCount + 1;
  const nextWidths = [...prevWidths];
  if (nextWidths.length === prevCount && prevCount > 0) {
    const seed = Math.max(TABLE_COLUMN_WIDTH_MIN, 100 / nextCount);
    nextWidths.splice(insertAt, 0, seed);
  }
  ensureColgroup(ctx.table, nextCount, nextWidths.length === nextCount ? nextWidths : equalColumnWidths(nextCount));
  return {
    rowIndex: ctx.rowIndex,
    colIndex: position === 'before' ? ctx.colIndex + 1 : ctx.colIndex,
  };
}

export function removeTableColumn(ctx: TableCellContext): TableEditPosition | false {
  const firstRow = tableRows(ctx.table)[0];
  if (!firstRow || rowCells(firstRow).length <= 1) return false;
  const prevCount = tableColumnCount(ctx.table);
  const prevWidths = readStoredColumnWidths(ctx.table, prevCount) ?? measureColumnWidths(ctx.table, prevCount);
  tableRows(ctx.table).forEach((row) => {
    rowCells(row)[ctx.colIndex]?.remove();
  });
  const nextWidths = prevWidths.filter((_, i) => i !== ctx.colIndex);
  ensureColgroup(ctx.table, prevCount - 1, nextWidths);
  return {
    rowIndex: ctx.rowIndex,
    colIndex: Math.max(0, ctx.colIndex - 1),
  };
}

export function deleteTable(ctx: TableCellContext) {
  ctx.wrap.remove();
}

function suppressToolbarHostCaret(host: HTMLElement) {
  // Never let nested controls become tab stops — Chrome will park focus on the first
  // <button> inside contenteditable ("Line above") when the main toolbar runs ed.focus().
  host.querySelectorAll('button, [href], input, select, textarea, [tabindex]').forEach((el) => {
    if (el instanceof HTMLElement) el.tabIndex = -1;
  });
  if (host.dataset.noteTableHostBound === '1') return;
  host.dataset.noteTableHostBound = '1';
  // Do NOT set contenteditable=false on the host: in Chrome/Safari that makes the
  // surrounding table wrap behave like a non-editable island, so clicks never land
  // in cells. Keep the strip non-editable via preventDefault + CSS user-select.
  host.addEventListener('mousedown', (e) => {
    // Always preventDefault so nested controls never steal focus from the editor.
    // Action handlers still run (React onMouseDown); they must not rely on focus.
    e.preventDefault();
  });
  host.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t === host) return;
    // Kick focus off chrome controls back to the nearest contenteditable editor.
    t.blur();
    const ed = host.closest('[contenteditable="true"]');
    if (ed instanceof HTMLElement) ed.focus({ preventScroll: true });
  });
}

export function ensureTableWrapStructure(wrap: HTMLElement): { toolbarHost: HTMLElement; table: HTMLTableElement | null } {
  const existingHost = wrap.querySelector(`:scope > .${NOTE_TABLE_TOOLBAR_HOST}`);
  let toolbarHost: HTMLElement;
  if (existingHost instanceof HTMLElement) {
    toolbarHost = existingHost;
  } else {
    toolbarHost = document.createElement('div');
    toolbarHost.className = NOTE_TABLE_TOOLBAR_HOST;
    wrap.insertBefore(toolbarHost, wrap.firstChild);
  }
  // Legacy saved notes may still have contenteditable=false on the host — clear it.
  toolbarHost.removeAttribute('contenteditable');
  suppressToolbarHostCaret(toolbarHost);

  const table = wrap.querySelector(`:scope > table.${NOTE_TABLE_CLASS}`)
    ?? wrap.querySelector(`:scope > .${NOTE_TABLE_BODY} > table.${NOTE_TABLE_CLASS}`);

  if (table instanceof HTMLTableElement) {
    let body = wrap.querySelector(`:scope > .${NOTE_TABLE_BODY}`);
    if (!(body instanceof HTMLElement)) {
      body = document.createElement('div');
      body.className = NOTE_TABLE_BODY;
      wrap.appendChild(body);
    }
    body.removeAttribute('contenteditable');
    if (table.parentElement !== body) body.appendChild(table);
    // Always pin: [toolbarHost, note-table-body, …]. Never leave the host under the table
    // after serialize/selection refresh paths reattach chrome.
    if (wrap.firstElementChild !== toolbarHost) wrap.insertBefore(toolbarHost, wrap.firstChild);
    if (toolbarHost.nextElementSibling !== body) wrap.insertBefore(body, toolbarHost.nextSibling);
  }

  return { toolbarHost, table: table instanceof HTMLTableElement ? table : null };
}

export function getTableToolbarHost(wrap: HTMLElement): HTMLElement {
  return ensureTableWrapStructure(wrap).toolbarHost;
}

export function setActiveTableWrap(wrap: HTMLElement | null) {
  document.querySelectorAll(`.${NOTE_TABLE_ACTIVE_WRAP}`).forEach((el) => {
    el.classList.remove(NOTE_TABLE_ACTIVE_WRAP);
  });
  if (wrap) wrap.classList.add(NOTE_TABLE_ACTIVE_WRAP);
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cleanCellHtml(el: Element): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.style.removeProperty('display');
    node.style.removeProperty('width');
    node.style.removeProperty('height');
    node.style.removeProperty('position');
    node.removeAttribute('width');
    node.removeAttribute('height');
  });
  clone.style.removeProperty('display');
  clone.style.removeProperty('width');
  clone.style.removeProperty('height');
  const html = clone.innerHTML.trim();
  return html || '&nbsp;';
}

export function buildEmptyTableHtml(cols = 3, bodyRows = 2): string {
  const headers = Array.from({ length: cols }, () => '<th dir="auto">&nbsp;</th>').join('');
  const body = Array.from({ length: bodyRows }, () => (
    `<tr>${Array.from({ length: cols }, () => '<td dir="auto">&nbsp;</td>').join('')}</tr>`
  )).join('');
  return (
    `<div class="${NOTE_TABLE_WRAP}" dir="auto">` +
    `<table class="${NOTE_TABLE_CLASS}" dir="auto">` +
    `<thead><tr>${headers}</tr></thead><tbody>${body}</tbody>` +
    `</table></div><br>`
  );
}

export function sanitizeTableElement(source: HTMLTableElement): HTMLTableElement {
  const table = document.createElement('table');
  table.className = NOTE_TABLE_CLASS;
  table.setAttribute('dir', 'auto');

  const rows = [...source.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr')];
  const firstRow = rows[0];
  const headerRow = !!firstRow?.querySelector('th');

  const thead = headerRow ? document.createElement('thead') : null;
  const tbody = document.createElement('tbody');

  rows.forEach((row, index) => {
    const cells = [...row.querySelectorAll('th, td')];
    if (!cells.length) return;
    const newRow = document.createElement('tr');
    cells.forEach((cell) => {
      const tableCell = cell as HTMLTableCellElement;
      const isHeader = headerRow && index === 0;
      const tag = isHeader || cell.tagName === 'TH' ? 'th' : 'td';
      const newCell = document.createElement(tag);
      newCell.setAttribute('dir', 'auto');
      if (tableCell.colSpan > 1) newCell.colSpan = tableCell.colSpan;
      if (tableCell.rowSpan > 1) newCell.rowSpan = tableCell.rowSpan;
      // Keep percentage column widths when present (migrated to colgroup below).
      const pct = parsePercentWidth(tableCell.style.width) ?? parsePercentWidth(tableCell.getAttribute('width'));
      if (pct != null) newCell.style.width = `${pct}%`;
      newCell.innerHTML = cleanCellHtml(cell);
      newRow.appendChild(newCell);
    });
    if (index === 0 && thead) thead.appendChild(newRow);
    else tbody.appendChild(newRow);
  });

  if (thead?.childNodes.length) table.appendChild(thead);
  if (tbody.childNodes.length) table.appendChild(tbody);
  if (!table.tBodies.length && !table.tHead) {
    const fallbackBody = document.createElement('tbody');
    rows.forEach((row) => {
      const cells = [...row.querySelectorAll('th, td')];
      if (!cells.length) return;
      const newRow = document.createElement('tr');
      cells.forEach((cell) => {
        const newCell = document.createElement('td');
        newCell.setAttribute('dir', 'auto');
        const tableCell = cell as HTMLTableCellElement;
        const pct = parsePercentWidth(tableCell.style.width) ?? parsePercentWidth(tableCell.getAttribute('width'));
        if (pct != null) newCell.style.width = `${pct}%`;
        newCell.innerHTML = cleanCellHtml(cell);
        newRow.appendChild(newCell);
      });
      fallbackBody.appendChild(newRow);
    });
    table.appendChild(fallbackBody);
  }

  const colCount = tableColumnCount(table);
  if (colCount > 0) {
    const sourceCols = [...source.querySelectorAll(':scope > colgroup > col')];
    const fromSource = sourceCols.length === colCount
      ? sourceCols.map((col) => {
        if (!(col instanceof HTMLElement)) return null;
        return parsePercentWidth(col.style.width) ?? parsePercentWidth(col.getAttribute('width'));
      })
      : null;
    if (fromSource && fromSource.every((w): w is number => w != null)) {
      ensureColgroup(table, colCount, fromSource);
    } else {
      const stored = readStoredColumnWidths(table, colCount);
      if (stored) ensureColgroup(table, colCount, stored);
    }
  }

  return table;
}

export function extractTableHtmlFromClipboard(html: string): string | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  return wrapTableHtml(sanitizeTableElement(table));
}

export function wrapTableHtml(table: HTMLTableElement): string {
  const wrap = document.createElement('div');
  wrap.className = NOTE_TABLE_WRAP;
  wrap.setAttribute('dir', 'auto');
  wrap.appendChild(table);
  return `${wrap.outerHTML}<br>`;
}

export function plainTextToTableHtml(text: string): string | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  if (lines.length < 2) return null;

  const delim = lines[0].includes('\t') ? '\t' : (lines.every((line) => line.includes('|')) ? '|' : null);
  if (!delim) return null;

  const rows = lines.map((line) => line.split(delim).map((cell) => cell.trim()));
  const colCount = rows[0].length;
  if (colCount < 2 || !rows.every((row) => row.length === colCount)) return null;

  const headerCells = rows[0].map((cell) => `<th dir="auto">${escapeHtml(cell)}</th>`).join('');
  const bodyRows = rows.slice(1).map((row) => (
    `<tr>${row.map((cell) => `<td dir="auto">${escapeHtml(cell)}</td>`).join('')}</tr>`
  )).join('');

  return (
    `<div class="${NOTE_TABLE_WRAP}" dir="auto">` +
    `<table class="${NOTE_TABLE_CLASS}" dir="auto">` +
    `<thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody>` +
    `</table></div><br>`
  );
}

export function normalizeTablesInEditor(root: HTMLElement): boolean {
  let changed = false;
  root.querySelectorAll('table').forEach((table) => {
    if (!(table instanceof HTMLTableElement)) return;

    if (!table.classList.contains(NOTE_TABLE_CLASS)) {
      table.classList.add(NOTE_TABLE_CLASS);
      changed = true;
    }
    if (!table.getAttribute('dir')) {
      table.setAttribute('dir', 'auto');
      changed = true;
    }

    const parent = table.parentElement;
    const wrap = table.closest(`.${NOTE_TABLE_WRAP}`) ?? (parent?.classList.contains(NOTE_TABLE_WRAP) ? parent : null);
    if (!(wrap instanceof HTMLElement)) {
      const newWrap = document.createElement('div');
      newWrap.className = NOTE_TABLE_WRAP;
      newWrap.setAttribute('dir', 'auto');
      table.parentNode?.insertBefore(newWrap, table);
      newWrap.appendChild(table);
      changed = true;
    }

    const activeWrap = table.closest(`.${NOTE_TABLE_WRAP}`);
    if (activeWrap instanceof HTMLElement) {
      ensureTableWrapStructure(activeWrap);
      changed = true;
    }

    table.querySelectorAll('tr, td, th').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.removeProperty('display');
      el.style.removeProperty('flex');
      el.style.removeProperty('flex-direction');
      // Keep percentage widths — migrate onto colgroup below. Drop bare width attrs.
      const pct = parsePercentWidth(el.style.width) ?? parsePercentWidth(el.getAttribute('width'));
      el.removeAttribute('width');
      if (pct != null && (el.tagName === 'TD' || el.tagName === 'TH')) {
        el.style.width = `${pct}%`;
      } else {
        el.style.removeProperty('width');
      }
      if (!el.getAttribute('dir')) el.setAttribute('dir', 'auto');
    });

    const colCount = tableColumnCount(table);
    if (colCount > 0) {
      const stored = readStoredColumnWidths(table, colCount);
      if (stored) {
        ensureColgroup(table, colCount, stored);
        changed = true;
      } else if (table.querySelector(':scope > colgroup > col')) {
        // Repair mismatched colgroup length after edits.
        ensureColgroup(table, colCount);
        changed = true;
      }
    }
  });
  return changed;
}
