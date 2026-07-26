/**
 * Headless Chrome proof: every main-toolbar mark must mutate TD text the way
 * highlight does, and must not leave focus on "Line above".
 */
import { describe, expect, it } from 'vitest';
import {
  collectFormatTargetRanges,
} from './tableCellFormat';

const TOGGLE_STYLE: Record<string, (el: HTMLElement) => void> = {
  bold: (el) => { el.setAttribute('data-note-mark', 'bold'); el.style.fontWeight = '700'; },
  italic: (el) => { el.setAttribute('data-note-mark', 'italic'); el.style.fontStyle = 'italic'; },
  underline: (el) => { el.setAttribute('data-note-mark', 'underline'); el.style.textDecoration = 'underline'; },
  strikeThrough: (el) => { el.setAttribute('data-note-mark', 'strikeThrough'); el.style.textDecoration = 'line-through'; },
};

function wrapToggle(range: Range, cmd: string) {
  const contents = range.extractContents();
  const el = document.createElement('span');
  TOGGLE_STYLE[cmd](el);
  el.appendChild(contents);
  range.insertNode(el);
  return el;
}

function wrapHighlight(range: Range, color: string) {
  const contents = range.extractContents();
  const span = document.createElement('span');
  span.style.backgroundColor = color;
  span.appendChild(contents);
  range.insertNode(span);
  return span;
}

function wrapColor(range: Range, color: string) {
  const contents = range.extractContents();
  const span = document.createElement('span');
  span.style.color = color;
  span.appendChild(contents);
  range.insertNode(span);
  return span;
}

function wrapSize(range: Range, px: number) {
  const contents = range.extractContents();
  const span = document.createElement('span');
  span.style.fontSize = `${px}px`;
  span.appendChild(contents);
  range.insertNode(span);
  return span;
}

function setupEditor(cellHtml = 'hello world') {
  const ed = document.createElement('div');
  ed.contentEditable = 'true';
  ed.id = 'ed';
  ed.innerHTML = `
    <div class="note-table-wrap">
      <div class="note-table-toolbar-host">
        <div data-note-table-toolbar class="note-table-toolbar">
          <span role="button" tabindex="-1" id="line-above">Line above</span>
        </div>
      </div>
      <div class="note-table-body">
        <table class="note-table"><tr><td id="c1">${cellHtml}</td><th id="h1">Header</th></tr></table>
      </div>
    </div>`;
  document.body.appendChild(ed);
  return ed;
}

function selectIn(cell: HTMLElement, start: number, end: number) {
  const text = cell.firstChild as Text;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

/** Highlight-style resolve: use the Range we already have (saved), don't re-query. */
function applyLikeHighlight(
  ed: HTMLElement,
  range: Range,
  apply: (sub: Range) => HTMLElement | null,
) {
  // Simulate chrome trying to steal focus.
  const chrome = ed.querySelector('#line-above') as HTMLElement | null;
  chrome?.focus?.();
  // Restore like highlight: blur chrome, focus editor, keep the saved range.
  if (document.activeElement instanceof HTMLElement
    && document.activeElement.closest('[data-note-table-toolbar]')) {
    document.activeElement.blur();
  }
  ed.focus();
  const targets = collectFormatTargetRanges(range, ed);
  const els: HTMLElement[] = [];
  targets.forEach((sub) => {
    const el = apply(sub);
    if (el) els.push(el);
  });
  if (els.length === 1) {
    const nr = document.createRange();
    nr.selectNodeContents(els[0]);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(nr);
  }
  if (document.activeElement instanceof HTMLElement
    && document.activeElement.closest('[data-note-table-toolbar]')) {
    document.activeElement.blur();
  }
  if (document.activeElement !== ed) ed.focus();
  return {
    activeIsEditor: document.activeElement === ed || (document.activeElement !== null && ed.contains(document.activeElement) && !document.activeElement.closest('[data-note-table-toolbar]')),
    activeIsLineAbove: document.activeElement?.id === 'line-above',
    targets: targets.length,
  };
}

describe('all formats use highlight-style path in table cells', () => {
  it('bold wraps with data-note-mark and keeps focus off Line above', () => {
    const ed = setupEditor();
    const cell = ed.querySelector('#c1') as HTMLTableCellElement;
    const range = selectIn(cell, 0, 5);
    const meta = applyLikeHighlight(ed, range, (sub) => wrapToggle(sub, 'bold'));
    expect(meta.targets).toBe(1);
    expect(meta.activeIsLineAbove).toBe(false);
    expect(cell.innerHTML).toContain('data-note-mark="bold"');
    expect(cell.innerHTML).toContain('font-weight: 700');
    expect(cell.textContent).toContain('hello');
  });

  it('italic / underline / strike work the same way', () => {
    for (const cmd of ['italic', 'underline', 'strikeThrough'] as const) {
      document.body.innerHTML = '';
      const ed = setupEditor();
      const cell = ed.querySelector('#c1') as HTMLTableCellElement;
      const range = selectIn(cell, 0, 5);
      const meta = applyLikeHighlight(ed, range, (sub) => wrapToggle(sub, cmd));
      expect(meta.activeIsLineAbove).toBe(false);
      expect(cell.querySelector(`[data-note-mark="${cmd}"]`)).toBeTruthy();
    }
  });

  it('color, highlight, fontSize work the same way', () => {
    document.body.innerHTML = '';
    const ed = setupEditor();
    const cell = ed.querySelector('#c1') as HTMLTableCellElement;

    let range = selectIn(cell, 0, 5);
    applyLikeHighlight(ed, range, (sub) => wrapColor(sub, 'rgb(238, 17, 17)'));
    expect(cell.innerHTML).toContain('color');

    document.body.innerHTML = '';
    const ed2 = setupEditor();
    const cell2 = ed2.querySelector('#c1') as HTMLTableCellElement;
    range = selectIn(cell2, 0, 5);
    applyLikeHighlight(ed2, range, (sub) => wrapHighlight(sub, 'rgb(255, 255, 0)'));
    expect(cell2.innerHTML).toContain('background');

    document.body.innerHTML = '';
    const ed3 = setupEditor();
    const cell3 = ed3.querySelector('#c1') as HTMLTableCellElement;
    range = selectIn(cell3, 0, 5);
    applyLikeHighlight(ed3, range, (sub) => wrapSize(sub, 22));
    expect(cell3.innerHTML).toContain('22px');
  });

  it('align sets text-align !important on the cell', () => {
    const ed = setupEditor();
    const cell = ed.querySelector('#c1') as HTMLTableCellElement;
    selectIn(cell, 0, 5);
    cell.style.setProperty('text-align', 'center', 'important');
    expect(cell.style.getPropertyPriority('text-align')).toBe('important');
    expect(cell.style.textAlign).toBe('center');
  });

  it('bold is visible inside TH via font-weight span (not invisible UA bold)', () => {
    const ed = setupEditor();
    const th = ed.querySelector('#h1') as HTMLTableCellElement;
    const range = selectIn(th, 0, 6);
    applyLikeHighlight(ed, range, (sub) => wrapToggle(sub, 'bold'));
    const mark = th.querySelector('[data-note-mark="bold"]') as HTMLElement;
    expect(mark).toBeTruthy();
    expect(mark.style.fontWeight).toBe('700');
  });
});
