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

export function addTableColumn(ctx: TableCellContext, position: 'before' | 'after'): TableEditPosition {
  tableRows(ctx.table).forEach((row) => {
    const cells = rowCells(row);
    const refCell = cells[ctx.colIndex];
    if (!refCell) return;
    const tag = refCell.tagName === 'TH' ? 'th' : 'td';
    const newCell = emptyCell(tag);
    if (position === 'before') refCell.before(newCell);
    else refCell.after(newCell);
  });
  return {
    rowIndex: ctx.rowIndex,
    colIndex: position === 'before' ? ctx.colIndex + 1 : ctx.colIndex,
  };
}

export function removeTableColumn(ctx: TableCellContext): TableEditPosition | false {
  const firstRow = tableRows(ctx.table)[0];
  if (!firstRow || rowCells(firstRow).length <= 1) return false;
  tableRows(ctx.table).forEach((row) => {
    rowCells(row)[ctx.colIndex]?.remove();
  });
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
        newCell.innerHTML = cleanCellHtml(cell);
        newRow.appendChild(newCell);
      });
      fallbackBody.appendChild(newRow);
    });
    table.appendChild(fallbackBody);
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
      el.removeAttribute('width');
      if (!el.getAttribute('dir')) el.setAttribute('dir', 'auto');
    });
  });
  return changed;
}
