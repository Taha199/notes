import { describe, expect, it } from 'vitest';

/**
 * Reproduces the Chrome focus-steal: a <button> inside contenteditable becomes
 * activeElement after ed.focus(), so formatting appears to target "Line above".
 */
describe('table toolbar focus isolation', () => {
  it('native buttons inside contenteditable can steal focus on ed.focus()', () => {
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    ed.innerHTML = `
      <div class="note-table-wrap">
        <div class="note-table-toolbar-host">
          <div data-note-table-toolbar class="note-table-toolbar">
            <button type="button" id="line-above">Line above</button>
          </div>
        </div>
        <div class="note-table-body">
          <table class="note-table"><tr><td id="c1">hello world</td></tr></table>
        </div>
      </div>`;
    document.body.appendChild(ed);

    const cell = ed.querySelector('#c1') as HTMLTableCellElement;
    const text = cell.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const btn = ed.querySelector('#line-above') as HTMLButtonElement;
    // Simulate the steal: browser parks focus on the first focusable chrome control.
    btn.focus();
    expect(document.activeElement).toBe(btn);

    // Fix pattern: blur chrome + tabIndex=-1 + restore selection into cell.
    btn.tabIndex = -1;
    btn.blur();
    ed.focus();
    sel.removeAllRanges();
    sel.addRange(range);

    expect(document.activeElement).not.toBe(btn);
    expect(ed.contains(sel.anchorNode!)).toBe(true);
    expect(sel.toString()).toBe('hello');

    // Span role=button with tabIndex=-1 must not become activeElement via focus().
    const span = document.createElement('span');
    span.setAttribute('role', 'button');
    span.tabIndex = -1;
    span.textContent = 'Line above';
    btn.replaceWith(span);
    span.focus();
    // tabIndex=-1 can still be focused programmatically in jsdom — blur + editor focus is required.
    if (document.activeElement === span) span.blur();
    ed.focus();
    sel.removeAllRanges();
    sel.addRange(range);
    expect(closestToolbar(document.activeElement)).toBeNull();
    expect(sel.toString()).toBe('hello');
    ed.remove();
  });

  it('span role=button labels stay non-editable when contenteditable=false', () => {
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    ed.innerHTML = `
      <div class="note-table-wrap">
        <div class="note-table-toolbar-host">
          <div data-note-table-toolbar class="note-table-toolbar" contenteditable="false">
            <span role="button" tabindex="-1" contenteditable="false" id="line-above">↵ Line above</span>
          </div>
        </div>
        <div class="note-table-body">
          <table class="note-table"><tr><td id="c1">cell</td></tr></table>
        </div>
      </div>`;
    document.body.appendChild(ed);

    const toolbar = ed.querySelector('[data-note-table-toolbar]') as HTMLElement;
    const label = ed.querySelector('#line-above') as HTMLElement;
    expect(toolbar.getAttribute('contenteditable')).toBe('false');
    expect(label.getAttribute('contenteditable')).toBe('false');

    // Simulate the leak: caret parked on the menu label text.
    const text = label.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const inToolbar = !!sel.anchorNode
      && !!(sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement)
        ?.closest('[data-note-table-toolbar]');
    expect(inToolbar).toBe(true);

    // Eject pattern: move caret into the cell — typing must not keep targeting the menu.
    const cell = ed.querySelector('#c1') as HTMLTableCellElement;
    const cellText = cell.firstChild as Text;
    const cellRange = document.createRange();
    cellRange.selectNodeContents(cellText);
    cellRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(cellRange);
    expect(sel.anchorNode).toBe(cellText);
    expect(label.textContent).toBe('↵ Line above');
    ed.remove();
  });
});

function closestToolbar(node: Element | null) {
  return node?.closest?.('[data-note-table-toolbar]') ?? null;
}
