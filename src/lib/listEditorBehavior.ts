/** Shared list keyboard/DOM helpers for RichTextEditor (native ul/ol/li). */

export const LIST_TAG_NAMES = new Set(['UL', 'OL']);
export const BLOCK_TAG_NAMES = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);
export const BULLET_PREFIX_RE = /^[\s\u00a0]*(?:[•●◦▪▫‣⁃·\-–—*+]|\d+[.)])\s*/;

export const LIST_EXIT_INDENT_PROPS = [
  'margin-left',
  'padding-left',
  'text-indent',
  'margin-inline-start',
  'padding-inline-start',
] as const;

export const LIST_PASTE_INDENT_PROPS = [
  'margin-left',
  'padding-left',
  'text-indent',
  'margin-inline-start',
  'padding-inline-start',
  'margin-right',
  'padding-right',
  'margin-inline-end',
  'padding-inline-end',
] as const;

export function isLiEmpty(li: HTMLLIElement): boolean {
  const scratch = li.cloneNode(true) as HTMLLIElement;
  scratch.querySelectorAll('br').forEach((br) => br.remove());
  const text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
  return !text && !li.querySelector('img');
}

export function isLiEffectivelyEmpty(li: HTMLLIElement): boolean {
  if (isLiEmpty(li)) return true;
  const scratch = li.cloneNode(true) as HTMLLIElement;
  scratch.querySelectorAll('br').forEach((el) => el.remove());
  scratch.querySelectorAll('p, div, span, b, u, i, strong, em').forEach((el) => {
    const text = (el.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    if (!text && !el.querySelector('img')) el.remove();
  });
  let text = (scratch.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
  text = text.replace(BULLET_PREFIX_RE, '').trim();
  return !text && !li.querySelector('img');
}

export function isCaretAtStartOfLi(li: HTMLLIElement, range: Range): boolean {
  const probe = document.createRange();
  probe.selectNodeContents(li);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().replace(/\u200B/g, '').length === 0;
}

export function isCaretAtStartOfBlock(block: HTMLElement, range: Range): boolean {
  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().replace(/\u200B/g, '').length === 0;
}

export function isEmptyTextLine(el: HTMLElement): boolean {
  const text = el.textContent?.replace(/\u200B/g, '').trim() ?? '';
  return !text && !el.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame');
}

export function collectListItemsBetween(startLi: HTMLLIElement, endLi: HTMLLIElement): HTMLLIElement[] {
  const list = startLi.parentElement;
  if (!list || list !== endLi.parentElement) return [startLi];
  const items: HTMLLIElement[] = [];
  let collecting = false;
  for (const child of list.children) {
    if (child === startLi) collecting = true;
    if (collecting && child instanceof HTMLLIElement) items.push(child);
    if (child === endLi) break;
  }
  return items.length > 0 ? items : [startLi];
}

export function selectionSpansEntireListItems(
  startLi: HTMLLIElement,
  endLi: HTMLLIElement,
  range: Range,
): boolean {
  return collectListItemsBetween(startLi, endLi).every((item) => {
    const itemRange = document.createRange();
    itemRange.selectNodeContents(item);
    return range.compareBoundaryPoints(Range.START_TO_START, itemRange) <= 0
      && range.compareBoundaryPoints(Range.END_TO_END, itemRange) >= 0;
  });
}

export function stripNewParagraphIndent(block: HTMLElement): void {
  for (const prop of LIST_EXIT_INDENT_PROPS) {
    block.style.removeProperty(prop);
  }
  block.style.removeProperty('list-style-type');
  block.style.removeProperty('display');
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first?.nodeType === Node.TEXT_NODE) {
    const text = first.textContent ?? '';
    const stripped = text.replace(/^[\s\u00a0\u2002\u2003]+/, '');
    if (stripped !== text) first.textContent = stripped;
  }
}

export function stripListPasteIndent(block: HTMLElement, afterList = false): boolean {
  if (block.closest('li, ul, ol')) return false;
  let changed = false;
  for (const prop of LIST_PASTE_INDENT_PROPS) {
    if (block.style.getPropertyValue(prop)) {
      block.style.removeProperty(prop);
      changed = true;
    }
  }
  if (block.style.listStyleType || block.style.display === 'list-item') {
    block.style.removeProperty('list-style-type');
    block.style.removeProperty('display');
    changed = true;
  }
  if ([...block.classList].some((cls) => /mso/i.test(cls))) {
    block.className = block.className.replace(/\bMso\S+/g, '').trim();
    changed = true;
  }
  if (!block.getAttribute('class')) block.removeAttribute('class');
  if (!block.getAttribute('style')?.trim()) block.removeAttribute('style');
  if (afterList) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    if (first?.nodeType === Node.TEXT_NODE) {
      const text = first.textContent ?? '';
      const stripped = text.replace(/^[\s\u00a0\u2002\u2003]+/, '');
      if (stripped !== text) {
        first.textContent = stripped;
        changed = true;
      }
    }
  }
  return changed;
}

export function createEmptyParagraph(): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('dir', 'auto');
  div.innerHTML = '<br>';
  stripNewParagraphIndent(div);
  return div;
}

export function makeListElement(ordered: boolean): HTMLUListElement | HTMLOListElement {
  const el = document.createElement(ordered ? 'ol' : 'ul');
  el.setAttribute('dir', 'auto');
  return el;
}

/** Split list at empty item → margin paragraph (Word step 1: remove bullet, keep line). Returns new paragraph. */
export function convertEmptyListItemToParagraph(
  li: HTMLLIElement,
  cleanupEmptyListShell: (list: HTMLUListElement | HTMLOListElement) => void,
): HTMLDivElement | null {
  const list = li.parentElement;
  if (!list || !LIST_TAG_NAMES.has(list.tagName)) return null;
  const parent = list.parentNode;
  if (!parent) return null;

  const listEl = list as HTMLUListElement | HTMLOListElement;
  const ordered = listEl.tagName === 'OL';
  const div = createEmptyParagraph();

  const beforeItems: HTMLLIElement[] = [];
  const afterItems: HTMLLIElement[] = [];
  let passed = false;
  for (const child of [...list.children]) {
    if (child === li) { passed = true; continue; }
    if (child instanceof HTMLLIElement) {
      if (!passed) beforeItems.push(child);
      else afterItems.push(child);
    }
  }
  li.remove();

  const appendList = (items: HTMLLIElement[]) => {
    const el = makeListElement(ordered);
    items.forEach((item) => el.appendChild(item));
    return el;
  };

  if (beforeItems.length > 0) parent.insertBefore(appendList(beforeItems), list);
  parent.insertBefore(div, list);
  if (afterItems.length > 0) parent.insertBefore(appendList(afterItems), list);
  list.remove();
  cleanupEmptyListShell(listEl);
  return div;
}

/** Insert empty paragraph directly above a list (Shift+Enter at first item). */
export function insertParagraphAboveList(list: HTMLUListElement | HTMLOListElement): HTMLDivElement {
  const div = createEmptyParagraph();
  list.parentNode?.insertBefore(div, list);
  return div;
}

export function mergeAdjacentLists(root: ParentNode): void {
  const lists = [...root.querySelectorAll('ul, ol')];
  for (const list of lists) {
    if (!list.isConnected) continue;
    const next = list.nextElementSibling;
    if (!(next instanceof HTMLElement) || next.tagName !== list.tagName) continue;
    while (next.firstChild) list.appendChild(next.firstChild);
    next.remove();
  }
}

export function removeListItemsInRangeDom(
  startLi: HTMLLIElement,
  endLi: HTMLLIElement,
  cleanupEmptyListShell: (list: HTMLUListElement | HTMLOListElement) => void,
): HTMLLIElement | null {
  const list = startLi.parentElement;
  const prevLi = startLi.previousElementSibling;
  const items = collectListItemsBetween(startLi, endLi);
  for (let i = items.length - 1; i >= 0; i--) items[i].remove();
  if (list && LIST_TAG_NAMES.has(list.tagName)) {
    if (list.children.length === 0) list.remove();
    else cleanupEmptyListShell(list as HTMLUListElement | HTMLOListElement);
  }
  if (prevLi instanceof HTMLLIElement) return prevLi;
  const first = list?.querySelector(':scope > li:first-child');
  return first instanceof HTMLLIElement ? first : null;
}
