export const NOTE_TABLE_CLASS = 'note-table';
export const NOTE_TABLE_WRAP = 'note-table-wrap';

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
    if (!parent?.classList.contains(NOTE_TABLE_WRAP)) {
      const wrap = document.createElement('div');
      wrap.className = NOTE_TABLE_WRAP;
      wrap.setAttribute('dir', 'auto');
      table.parentNode?.insertBefore(wrap, table);
      wrap.appendChild(table);
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
