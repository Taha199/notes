/**
 * Regression: toolbar can detect bold via computed style (class / parent weight)
 * while toggle-off used to only strip explicit <b>/inline marks — B stayed stuck ON.
 */
import { describe, expect, it } from 'vitest';

function styleHasBold(style: CSSStyleDeclaration): boolean {
  const val = (style.fontWeight || '').toLowerCase();
  if (['bold', 'bolder', '600', '700', '800', '900'].includes(val)) return true;
  const n = parseInt(val, 10);
  return !Number.isNaN(n) && n >= 600;
}

function elementHasBold(el: HTMLElement): boolean {
  if (el.getAttribute('data-note-mark') === 'bold') return true;
  if (el.tagName === 'B' || el.tagName === 'STRONG') return true;
  return styleHasBold(el.style);
}

function elementCancelsBold(el: HTMLElement): boolean {
  const raw = (el.style.fontWeight || '').toLowerCase().trim();
  if (!raw) return false;
  const n = parseInt(raw, 10);
  return raw === 'normal' || raw === 'lighter' || (!Number.isNaN(n) && n < 600);
}

function elementIntroducesBold(el: HTMLElement, boundary: Node): boolean {
  if (elementCancelsBold(el)) return false;
  if (elementHasBold(el)) return true;
  const cs = window.getComputedStyle(el);
  const parentEl = el.parentElement;
  const parentCs = parentEl && parentEl !== boundary && boundary.contains(parentEl)
    ? window.getComputedStyle(parentEl)
    : null;
  const weight = (v: string) => v === 'bold' || v === 'bolder' || parseInt(v, 10) >= 600;
  const here = weight(cs.fontWeight);
  const parent = parentCs ? weight(parentCs.fontWeight) : false;
  return here && !parent;
}

function findBoldAncestor(node: Node, boundary: Node): HTMLElement | null {
  let el: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  while (el && el !== boundary) {
    if (el instanceof HTMLElement) {
      if (elementCancelsBold(el)) return null;
      if (elementIntroducesBold(el, boundary)) return el;
    }
    el = el.parentNode;
  }
  return null;
}

function forceClearBold(range: Range): HTMLElement {
  const contents = range.extractContents();
  const el = document.createElement('span');
  el.style.fontWeight = 'normal';
  el.appendChild(contents);
  range.insertNode(el);
  return el;
}

describe('bold toggle-off with computed weight', () => {
  it('clears class-based bold that has no <b>/inline mark', () => {
    const ed = document.createElement('div');
    ed.contentEditable = 'true';
    const style = document.createElement('style');
    style.textContent = '.paste-bold { font-weight: 700; }';
    document.head.appendChild(style);
    ed.innerHTML = '<p class="paste-bold">Använd handflatan med sträckt arm</p>';
    document.body.appendChild(ed);

    const p = ed.querySelector('p') as HTMLElement;
    const text = p.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, text.length);

    expect(findBoldAncestor(text, ed)).toBe(p);

    // Partial/ancestor mark: force clear with font-weight:normal
    forceClearBold(range);
    const cleared = ed.querySelector('span') as HTMLElement;
    expect(cleared.style.fontWeight).toBe('normal');
    expect(findBoldAncestor(cleared.firstChild as Text, ed)).toBeNull();

    document.body.removeChild(ed);
    document.head.removeChild(style);
  });

  it('unwraps explicit data-note-mark bold', () => {
    const ed = document.createElement('div');
    ed.innerHTML = '<span data-note-mark="bold" style="font-weight: 700">hello</span>';
    document.body.appendChild(ed);
    const mark = ed.querySelector('span') as HTMLElement;
    expect(elementHasBold(mark)).toBe(true);
    const parent = mark.parentNode!;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    expect(ed.textContent).toBe('hello');
    expect(ed.querySelector('[data-note-mark]')).toBeNull();
    document.body.removeChild(ed);
  });
});
