import { describe, expect, it } from 'vitest';
import {
  adjustTableColumnWidth,
  addTableColumn,
  removeTableColumn,
  resolveTableContext,
  TABLE_COLUMN_WIDTH_MIN,
  TABLE_COLUMN_WIDTH_STEP,
  sanitizeTableElement,
} from './noteTable';

function mountTwoColTable() {
  document.body.innerHTML = `
    <div class="note-table-wrap">
      <div class="note-table-body">
        <table class="note-table">
          <thead><tr><th id="c0">A</th><th id="c1">B</th></tr></thead>
          <tbody><tr><td>1</td><td>2</td></tr></tbody>
        </table>
      </div>
    </div>
  `;
  const cell = document.getElementById('c0');
  if (!(cell instanceof HTMLTableCellElement)) throw new Error('missing cell');
  const ctx = resolveTableContext(cell);
  if (!ctx) throw new Error('missing ctx');
  return ctx;
}

function colWidths(table: HTMLTableElement): number[] {
  return [...table.querySelectorAll(':scope > colgroup > col')].map((col) => {
    const match = (col as HTMLElement).style.width.match(/^([\d.]+)%$/);
    return match ? Number(match[1]) : NaN;
  });
}

describe('table column width', () => {
  it('widens the current column by the step size and persists on col elements', () => {
    const ctx = mountTwoColTable();
    adjustTableColumnWidth(ctx, TABLE_COLUMN_WIDTH_STEP);
    const widths = colWidths(ctx.table);
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeGreaterThan(50);
    expect(widths[1]).toBeLessThan(50);
    expect(Math.round(widths[0] + widths[1])).toBe(100);
    expect(ctx.table.style.tableLayout).toBe('fixed');
  });

  it('narrows the current column and refuses to go below the minimum', () => {
    const ctx = mountTwoColTable();
    for (let i = 0; i < 20; i += 1) {
      adjustTableColumnWidth(ctx, -TABLE_COLUMN_WIDTH_STEP);
    }
    const widths = colWidths(ctx.table);
    expect(widths[0]).toBeGreaterThanOrEqual(TABLE_COLUMN_WIDTH_MIN - 0.05);
    expect(widths[1]).toBeLessThanOrEqual(100 - TABLE_COLUMN_WIDTH_MIN + 0.05);
  });

  it('keeps col widths when adding/removing columns', () => {
    const ctx = mountTwoColTable();
    adjustTableColumnWidth(ctx, TABLE_COLUMN_WIDTH_STEP);
    const afterAdd = addTableColumn(ctx, 'after');
    expect(colWidths(ctx.table)).toHaveLength(3);
    const next = resolveTableContext(
      ctx.table.querySelectorAll('th, td')[afterAdd.colIndex] ?? null,
    );
    expect(next).toBeTruthy();
    removeTableColumn(next!);
    expect(colWidths(ctx.table)).toHaveLength(2);
  });

  it('preserves percentage col widths through sanitizeTableElement', () => {
    const ctx = mountTwoColTable();
    adjustTableColumnWidth(ctx, TABLE_COLUMN_WIDTH_STEP);
    const before = colWidths(ctx.table);
    const cleaned = sanitizeTableElement(ctx.table);
    expect(colWidths(cleaned)).toEqual(before);
  });
});
