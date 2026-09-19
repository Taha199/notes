import { describe, expect, it } from 'vitest';
import { ensureTableWrapStructure, NOTE_TABLE_BODY, NOTE_TABLE_TOOLBAR_SPACER } from './noteTable';

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

  it('keeps an in-flow spacer above the table body so edit chrome cannot cover row 1', () => {
    const wrap = document.createElement('div');
    wrap.className = 'note-table-wrap';
    wrap.innerHTML = `<div class="${NOTE_TABLE_BODY}"><table class="note-table"><tr><th>Hb</th></tr></table></div>`;
    document.body.appendChild(wrap);
    ensureTableWrapStructure(wrap);
    expect(wrap.firstElementChild?.classList.contains(NOTE_TABLE_TOOLBAR_SPACER)).toBe(true);
    expect(wrap.firstElementChild?.nextElementSibling?.classList.contains(NOTE_TABLE_BODY)).toBe(true);
    wrap.remove();
  });

  it('keeps a live spacer toolbar across structure refresh', () => {
    const wrap = document.createElement('div');
    wrap.className = 'note-table-wrap';
    wrap.innerHTML = `
      <div class="note-table-toolbar-host">
        <div data-note-table-toolbar class="note-table-toolbar">stale host</div>
      </div>
      <div class="${NOTE_TABLE_BODY}"><table class="note-table"><tr><th>Hb</th></tr></table></div>`;
    document.body.appendChild(wrap);
    ensureTableWrapStructure(wrap);
    const spacer = wrap.querySelector(`.${NOTE_TABLE_TOOLBAR_SPACER}`);
    expect(spacer).toBeTruthy();
    const live = document.createElement('div');
    live.setAttribute('data-note-table-toolbar', '');
    live.className = 'note-table-toolbar--inflow';
    live.textContent = 'Add row';
    spacer!.appendChild(live);
    ensureTableWrapStructure(wrap);
    expect(wrap.querySelector('.note-table-toolbar-host')).toBeNull();
    expect(spacer!.contains(live)).toBe(true);
    expect(spacer!.querySelector('[data-note-table-toolbar]')).toBe(live);
    wrap.remove();
  });
});

function closestToolbar(node: Element | null) {
  return node?.closest?.('[data-note-table-toolbar]') ?? null;
}
