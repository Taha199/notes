import { describe, expect, it } from 'vitest';
import {
  collectFormatTargetRanges,
  intersectRangeWithCellContents,
  rangeNeedsPerCellFormat,
} from './tableCellFormat';

function makeEditor(cellHtml: string): { ed: HTMLElement; cell: HTMLTableCellElement } {
  const ed = document.createElement('div');
  ed.contentEditable = 'true';
  ed.innerHTML = `<div class="note-table-wrap"><div class="note-table-body"><table class="note-table"><tr><td id="c1">${cellHtml}</td><td>other</td></tr></table></div></div>`;
  document.body.appendChild(ed);
  return { ed, cell: ed.querySelector('#c1') as HTMLTableCellElement };
}

function wrapBold(range: Range): HTMLElement | null {
  try {
    const contents = range.extractContents();
    const el = document.createElement('b');
    el.appendChild(contents);
    range.insertNode(el);
    return el;
  } catch {
    return null;
  }
}

describe('tableCellFormat', () => {
  it('wraps partial text in a single text node', () => {
    const { ed, cell } = makeEditor('hello world');
    const text = cell.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    expect(rangeNeedsPerCellFormat(range, ed)).toBe(false);
    const targets = collectFormatTargetRanges(range, ed);
    expect(targets).toHaveLength(1);
    expect(wrapBold(targets[0])).toBeTruthy();
    expect(cell.innerHTML).toBe('<b>hello</b> world');
  });

  it('wraps mixed inline nodes when commonAncestor is the TD (the 2d7e644 failure)', () => {
    const { ed, cell } = makeEditor('aa <strong>bb</strong> cc');
    const range = document.createRange();
    range.setStart(cell.firstChild as Text, 0);
    range.setEnd(cell.lastChild as Text, 3);
    expect((range.commonAncestorContainer as Element).tagName).toBe('TD');
    // Direct wrap path — must NOT require per-cell clipping for same-cell mixed content.
    expect(rangeNeedsPerCellFormat(range, ed)).toBe(false);
    const targets = collectFormatTargetRanges(range, ed);
    expect(targets).toHaveLength(1);
    expect(wrapBold(targets[0])).toBeTruthy();
    expect(cell.querySelector('b')).toBeTruthy();
    expect(cell.textContent).toBe('aa bb cc');
  });

  it('clips selectNode(td) to cell contents instead of ripping the cell out', () => {
    const { ed, cell } = makeEditor('plain text');
    const range = document.createRange();
    range.selectNode(cell);
    expect(rangeNeedsPerCellFormat(range, ed)).toBe(true);
    const targets = collectFormatTargetRanges(range, ed);
    expect(targets.length).toBeGreaterThan(0);
    expect(wrapBold(targets[0])).toBeTruthy();
    expect(ed.querySelectorAll('td')).toHaveLength(2);
    expect(cell.querySelector('b')?.textContent).toBe('plain text');
  });

  it('intersectRangeWithCellContents returns a non-null overlap (Chromium END_TO_START trap)', () => {
    const { cell } = makeEditor('aa <strong>bb</strong> cc');
    const range = document.createRange();
    range.setStart(cell.firstChild as Text, 0);
    range.setEnd(cell.lastChild as Text, 3);
    const sub = intersectRangeWithCellContents(range, cell);
    expect(sub).not.toBeNull();
    expect(sub!.toString()).toBe('aa bb cc');
  });

  it('selectNodeContents of a cell is a direct-safe target', () => {
    const { ed, cell } = makeEditor('plain text');
    const range = document.createRange();
    range.selectNodeContents(cell);
    const targets = collectFormatTargetRanges(range, ed);
    expect(targets).toHaveLength(1);
    expect(wrapBold(targets[0])).toBeTruthy();
    expect(cell.innerHTML).toBe('<b>plain text</b>');
  });
});
