/** Shared list keyboard/DOM helpers for RichTextEditor (native ul/ol/li). */

export const LIST_TAG_NAMES = new Set(['UL', 'OL']);
export const BLOCK_TAG_NAMES = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3']);
/** Leading bullet/number markers from ChatGPT, Word, plain text, etc. */
export const BULLET_PREFIX_RE =
  /^[\s\u00a0\u200B\uFEFF\u202F]*(?:[\uF0B7\uF0A7\u2022\u2023\u2043\u2219\u2024\u25E6\u25AA\u25CF\u25CB•●◦▪▫‣⁃·∙・○■□➢➤\-–—*+]|\d+[.)])[\s\u00a0\u200B\uFEFF\u202F]*/;

const PSEUDO_LIST_BLOCK_TAGS = new Set(['DIV', 'P', 'H1', 'H2', 'H3']);
const STRONG_BULLET_RE = /[\uF0B7\uF0A7\u2022\u2023\u2043\u2219\u2024\u25E6\u25AA\u25CF\u25CB•●◦▪▫‣⁃·∙・*○■□➢➤]/;

/** True when caret sits inside the leading "• " zone (so Backspace can remove the bullet). */
export function isCaretInBulletPrefixZone(block: HTMLElement, range: Range): boolean {
  const match = getPseudoListPrefix(block);
  if (!match) return false;
  const probe = document.createRange();
  probe.selectNodeContents(block);
  probe.setEnd(range.startContainer, range.startOffset);
  const before = probe.toString().replace(/[\u200B\uFEFF]/g, '');
  return before.length <= match[0].replace(/[\u200B\uFEFF]/g, '').length;
}

export function getPseudoListPrefix(block: HTMLElement): RegExpMatchArray | null {
  if (block.closest('li, ul, ol')) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.textContent ?? '';
    if (!raw.replace(/[\u200B\uFEFF\s\u00a0]/g, '')) {
      node = walker.nextNode();
      continue;
    }
    return raw.match(BULLET_PREFIX_RE);
  }
  const text = block.textContent ?? '';
  return text.match(BULLET_PREFIX_RE);
}

export function isOrderedPseudoPrefix(match: RegExpMatchArray): boolean {
  return /\d+[.)]/.test(match[0]);
}

export function stripBulletPrefixFromElement(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.textContent ?? '';
    if (!raw.replace(/[\u200B\uFEFF\s\u00a0]/g, '')) {
      node = walker.nextNode();
      continue;
    }
    const stripped = raw.replace(BULLET_PREFIX_RE, '');
    if (stripped !== raw) node.textContent = stripped;
    return;
  }
}

function blockHasNestedPseudoItems(block: HTMLElement): boolean {
  return [...block.children].some(
    (child) =>
      child instanceof HTMLElement
      && PSEUDO_LIST_BLOCK_TAGS.has(child.tagName)
      && !!getPseudoListPrefix(child),
  );
}

function convertBlockGroupToNativeList(blocks: HTMLElement[], ordered: boolean): HTMLUListElement | HTMLOListElement {
  const list = document.createElement(ordered ? 'ol' : 'ul');
  list.setAttribute('dir', 'auto');
  const parent = blocks[0].parentNode;
  if (!parent) return list;
  blocks.forEach((block) => {
    const li = document.createElement('li');
    li.setAttribute('dir', 'auto');
    while (block.firstChild) li.appendChild(block.firstChild);
    stripBulletPrefixFromElement(li);
    if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
      li.innerHTML = '<br>';
    }
    list.appendChild(li);
  });
  parent.insertBefore(list, blocks[0]);
  blocks.forEach((b) => b.remove());
  return list;
}

/** Split a block's children into lines at top-level <br> nodes. */
export function splitNodesByBr(block: HTMLElement): ChildNode[][] {
  const lines: ChildNode[][] = [[]];
  for (const child of [...block.childNodes]) {
    if (child instanceof HTMLElement && child.tagName === 'BR') {
      lines.push([]);
      continue;
    }
    lines[lines.length - 1].push(child);
  }
  return lines;
}

function lineNodesLookLikePseudoItem(nodes: ChildNode[]): boolean {
  const probe = document.createElement('div');
  nodes.forEach((n) => probe.appendChild(n.cloneNode(true)));
  return !!getPseudoListPrefix(probe);
}

/**
 * ChatGPT often pastes one div/p with "• a<br>• b<br>• c".
 * Split those into sibling blocks so each becomes its own <li>.
 */
export function splitBrSeparatedPseudoListBlocks(root: HTMLElement): boolean {
  let changed = false;
  const blocks = [...root.querySelectorAll<HTMLElement>('div, p, h1, h2, h3')];
  for (const block of blocks) {
    if (!block.isConnected) continue;
    if (block.closest('li, ul, ol')) continue;
    if (blockHasNestedPseudoItems(block)) continue;
    if (!block.querySelector(':scope > br')) continue;

    const lines = splitNodesByBr(block);
    if (lines.length < 2) continue;
    const pseudoCount = lines.filter(lineNodesLookLikePseudoItem).length;
    if (pseudoCount < 2) continue;

    const parent = block.parentNode;
    if (!parent) continue;
    const frag = document.createDocumentFragment();
    for (const nodes of lines) {
      const div = document.createElement('div');
      div.setAttribute('dir', 'auto');
      if (nodes.length === 0) {
        div.innerHTML = '<br>';
      } else {
        nodes.forEach((n) => div.appendChild(n));
      }
      frag.appendChild(div);
    }
    parent.insertBefore(frag, block);
    block.remove();
    changed = true;
  }
  return changed;
}

/**
 * If a single <li> still contains "• next<br>• next", explode into sibling <li>s.
 */
export function explodePseudoBulletLinesInListItems(root: HTMLElement): boolean {
  let changed = false;
  for (const li of [...root.querySelectorAll('li')]) {
    if (!(li instanceof HTMLLIElement) || !li.isConnected) continue;
    if (!li.querySelector(':scope > br')) continue;

    const lines = splitNodesByBr(li);
    if (lines.length < 2) continue;
    const pseudoCount = lines.filter(lineNodesLookLikePseudoItem).length;
    // First line may already have had its bullet stripped — still split if later lines are bullets.
    if (pseudoCount < 1) continue;

    const list = li.parentElement;
    if (!list || !LIST_TAG_NAMES.has(list.tagName)) continue;

    let insertAfter: Element = li;
    lines.forEach((nodes, index) => {
      if (index === 0) {
        while (li.firstChild) li.removeChild(li.firstChild);
        if (nodes.length === 0) {
          li.innerHTML = '<br>';
        } else {
          nodes.forEach((n) => li.appendChild(n));
        }
        stripBulletPrefixFromElement(li);
        if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
          li.innerHTML = '<br>';
        }
        return;
      }
      const newLi = document.createElement('li');
      newLi.setAttribute('dir', 'auto');
      if (nodes.length === 0) {
        newLi.innerHTML = '<br>';
      } else {
        nodes.forEach((n) => newLi.appendChild(n));
      }
      stripBulletPrefixFromElement(newLi);
      if (!newLi.textContent?.replace(/\u200B/g, '').trim() && !newLi.querySelector('img')) {
        newLi.innerHTML = '<br>';
      }
      list.insertBefore(newLi, insertAfter.nextSibling);
      insertAfter = newLi;
      changed = true;
    });
  }
  return changed;
}

/** Make pasted <li> structure match manually created ones (no wrapping <p>). */
export function normalizeListItemStructure(root: HTMLElement): boolean {
  let changed = false;
  root.querySelectorAll('ul, ol').forEach((list) => {
    if (!list.getAttribute('dir')) {
      list.setAttribute('dir', 'auto');
      changed = true;
    }
  });
  root.querySelectorAll('li').forEach((li) => {
    if (!(li instanceof HTMLLIElement)) return;
    if (!li.getAttribute('dir')) {
      li.setAttribute('dir', 'auto');
      changed = true;
    }
    while (
      li.children.length === 1
      && li.firstElementChild instanceof HTMLElement
      && (li.firstElementChild.tagName === 'P' || li.firstElementChild.tagName === 'DIV')
      && !li.firstElementChild.querySelector('ul, ol, table, img, .note-table-wrap, .note-img-frame, .note-yt-frame')
    ) {
      const wrap = li.firstElementChild;
      while (wrap.firstChild) li.insertBefore(wrap.firstChild, wrap);
      wrap.remove();
      changed = true;
    }
    const before = li.textContent;
    stripBulletPrefixFromElement(li);
    if (li.textContent !== before) changed = true;
    if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img, br')) {
      li.innerHTML = '<br>';
      changed = true;
    }
  });
  return changed;
}

/**
 * Turn pasted ChatGPT/plain pseudo-lists (`• text` in div/p) into real ul/ol/li
 * so Enter/Backspace/list toolbar match manually created lists.
 */
export function convertPseudoBulletBlocksToNativeLists(root: HTMLElement): boolean {
  const splitChanged = splitBrSeparatedPseudoListBlocks(root);
  let changed = splitChanged;
  let guard = 0;
  while (guard++ < 80) {
    let start: HTMLElement | null = null;
    for (const el of root.querySelectorAll<HTMLElement>('div, p, h1, h2, h3')) {
      if (el.dataset.skipPseudoList === '1') continue;
      if (el.closest('li, ul, ol')) continue;
      if (!PSEUDO_LIST_BLOCK_TAGS.has(el.tagName)) continue;
      if (blockHasNestedPseudoItems(el)) continue;
      if (!getPseudoListPrefix(el)) continue;
      start = el;
      break;
    }
    if (!start) break;

    const startPrefix = getPseudoListPrefix(start);
    if (!startPrefix) break;
    const ordered = isOrderedPseudoPrefix(startPrefix);
    const group: HTMLElement[] = [start];
    let sibling = start.nextElementSibling;
    while (sibling instanceof HTMLElement) {
      if (!PSEUDO_LIST_BLOCK_TAGS.has(sibling.tagName)) break;
      if (sibling.closest('li, ul, ol') && sibling.tagName !== 'LI') break;
      if (blockHasNestedPseudoItems(sibling)) break;
      const prefix = getPseudoListPrefix(sibling);
      if (!prefix || isOrderedPseudoPrefix(prefix) !== ordered) break;
      group.push(sibling);
      sibling = sibling.nextElementSibling;
    }

    const strongBullet = STRONG_BULLET_RE.test(startPrefix[0]);
    if (group.length < 2 && !strongBullet) {
      start.dataset.skipPseudoList = '1';
      continue;
    }

    convertBlockGroupToNativeList(group, ordered);
    changed = true;
  }

  root.querySelectorAll('[data-skip-pseudo-list]').forEach((el) => {
    el.removeAttribute('data-skip-pseudo-list');
  });

  if (explodePseudoBulletLinesInListItems(root)) changed = true;
  if (normalizeListItemStructure(root)) changed = true;
  if (changed) mergeAdjacentLists(root);
  return changed;
}

/** Convert plain-text clipboard lines like "• a\\n• b" into list HTML. */
export function plainTextToListHtml(plain: string): string | null {
  const lines = plain.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
  if (lines.length === 0) return null;
  const resolved: { ordered: boolean; content: string; marker: string }[] = [];
  for (const line of lines) {
    const match = line.match(BULLET_PREFIX_RE);
    if (!match) return null;
    resolved.push({
      ordered: /\d+[.)]/.test(match[0]),
      content: line.slice(match[0].length),
      marker: match[0],
    });
  }
  const strong = resolved.some((item) => STRONG_BULLET_RE.test(item.marker));
  if (resolved.length < 2 && !strong) return null;
  const ordered = resolved.every((item) => item.ordered);
  const unordered = resolved.every((item) => !item.ordered);
  if (!ordered && !unordered) return null;
  const tag = ordered ? 'ol' : 'ul';
  const body = resolved
    .map((item) => {
      const text = item.content.trim() || '<br>';
      const safe = text === '<br>' ? text : escapeHtmlPlain(text);
      return `<li dir="auto">${safe}</li>`;
    })
    .join('');
  return `<${tag} dir="auto">${body}</${tag}>`;
}

function escapeHtmlPlain(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countListItems(html: string): number {
  return (html.match(/<li\b/gi) || []).length;
}

function extractClipboardFragment(html: string): string {
  const start = html.indexOf('<!--StartFragment-->');
  const end = html.indexOf('<!--EndFragment-->');
  if (start !== -1 && end !== -1 && end > start) {
    return html.slice(start + '<!--StartFragment-->'.length, end);
  }
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) return body[1];
  return html;
}

const INLINE_KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'BR', 'SPAN', 'SUB', 'SUP']);

function sanitizeListItemContents(li: HTMLElement): void {
  li.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    if (!INLINE_KEEP.has(node.tagName)) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }
    node.removeAttribute('style');
    node.removeAttribute('class');
    node.removeAttribute('align');
    node.removeAttribute('dir');
    if (node.tagName === 'SPAN' && !node.getAttribute('style') && node.attributes.length === 0) {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
    }
  });
  li.removeAttribute('style');
  li.removeAttribute('class');
  li.removeAttribute('align');
}

function unwrapSingleBlockWrapper(li: HTMLElement): void {
  while (
    li.children.length === 1
    && li.firstElementChild instanceof HTMLElement
    && (li.firstElementChild.tagName === 'P' || li.firstElementChild.tagName === 'DIV')
    && !li.firstElementChild.querySelector('ul, ol, table, img')
  ) {
    const wrap = li.firstElementChild;
    while (wrap.firstChild) li.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  }
}

function serializeCleanList(list: HTMLElement): string {
  const ordered = list.tagName === 'OL';
  const tag = ordered ? 'ol' : 'ul';
  const items = [...list.querySelectorAll(':scope > li')].map((li) => {
    const clone = li.cloneNode(true) as HTMLElement;
    unwrapSingleBlockWrapper(clone);
    stripBulletPrefixFromElement(clone);
    sanitizeListItemContents(clone);
    const inner = clone.innerHTML.trim() || '<br>';
    return `<li dir="auto">${inner}</li>`;
  });
  if (items.length === 0) return '';
  return `<${tag} dir="auto">${items.join('')}</${tag}>`;
}

function collectLeafPasteBlocks(root: HTMLElement): HTMLElement[] {
  splitBrSeparatedPseudoListBlocks(root);
  const out: HTMLElement[] = [];
  const walk = (parent: HTMLElement) => {
    for (const child of [...parent.children]) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.tagName === 'UL' || child.tagName === 'OL') {
        child.querySelectorAll(':scope > li').forEach((li) => {
          if (li instanceof HTMLElement) out.push(li);
        });
        continue;
      }
      if (child.tagName === 'LI') {
        out.push(child);
        continue;
      }
      if (!PSEUDO_LIST_BLOCK_TAGS.has(child.tagName)) continue;
      if (blockHasNestedPseudoItems(child) || child.querySelector('div, p, li, ul, ol')) {
        walk(child);
        continue;
      }
      if ((child.textContent ?? '').replace(/\u200B/g, '').trim()) out.push(child);
    }
  };
  walk(root);
  return out;
}

/** Build a native list from clipboard HTML (preserves bold/etc. when possible). */
export function htmlClipboardToListHtml(html: string): string | null {
  const root = document.createElement('div');
  root.innerHTML = extractClipboardFragment(html);
  root.querySelectorAll('script, style, meta, link').forEach((el) => el.remove());

  convertPseudoBulletBlocksToNativeLists(root);

  const lists = [...root.querySelectorAll('ul, ol')].filter(
    (list) => !list.parentElement?.closest('ul, ol'),
  );
  if (lists.length > 0) {
    const parts = lists.map((list) => serializeCleanList(list as HTMLElement)).filter(Boolean);
    if (parts.length > 0) return parts.join('');
  }
  return null;
}

/**
 * When HTML has N paragraphs without "•" but plain text has N bullet lines,
 * rebuild a native list from the HTML blocks (keeps <b>/<strong>).
 */
export function htmlBlocksAlignedToPlainList(html: string, plain: string): string | null {
  const fromPlain = plainTextToListHtml(plain);
  if (!fromPlain) return null;
  const plainCount = countListItems(fromPlain);

  const root = document.createElement('div');
  root.innerHTML = extractClipboardFragment(html);
  root.querySelectorAll('script, style, meta, link').forEach((el) => el.remove());

  const blocks = collectLeafPasteBlocks(root).filter((block) => {
    if (block.tagName === 'LI') return true;
    return !!(block.textContent ?? '').replace(/\u200B/g, '').trim();
  });
  if (blocks.length !== plainCount || plainCount < 1) return null;

  const ordered = fromPlain.startsWith('<ol');
  const tag = ordered ? 'ol' : 'ul';
  const items = blocks.map((block) => {
    const clone = block.cloneNode(true) as HTMLElement;
    unwrapSingleBlockWrapper(clone);
    stripBulletPrefixFromElement(clone);
    sanitizeListItemContents(clone);
    const inner = clone.innerHTML.trim() || '<br>';
    return `<li dir="auto">${inner}</li>`;
  });
  return `<${tag} dir="auto">${items.join('')}</${tag}>`;
}

/**
 * Intercept ChatGPT/Word/etc. clipboard and return clean ul/ol HTML for insertHTML.
 * Prefer structured HTML (keeps bold); fall back to plain bullet lines.
 */
export function clipboardToNativeListHtml(html: string, plain: string): string | null {
  const plainTrimmed = plain.trim();
  const fromPlain = plainTrimmed ? plainTextToListHtml(plainTrimmed) : null;
  const fromHtml = html.trim() ? htmlClipboardToListHtml(html) : null;
  const aligned = html.trim() && fromPlain ? htmlBlocksAlignedToPlainList(html, plainTrimmed) : null;

  const candidates = [fromHtml, aligned, fromPlain].filter((x): x is string => !!x);
  if (candidates.length === 0) return null;

  // Prefer the candidate with the most list items; tie-break toward richer HTML.
  candidates.sort((a, b) => {
    const diff = countListItems(b) - countListItems(a);
    if (diff !== 0) return diff;
    return b.length - a.length;
  });
  return candidates[0];
}

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

export function removeEmptyListItemSimple(
  li: HTMLLIElement,
  cleanupEmptyListShell: (list: HTMLUListElement | HTMLOListElement) => void,
): HTMLLIElement | null {
  const prevLi = li.previousElementSibling;
  const nextLi = li.nextElementSibling;
  const list = li.parentElement;
  li.remove();
  if (list && LIST_TAG_NAMES.has(list.tagName)) {
    if (list.children.length === 0) list.remove();
    else cleanupEmptyListShell(list as HTMLUListElement | HTMLOListElement);
  }
  if (prevLi instanceof HTMLLIElement) return prevLi;
  if (nextLi instanceof HTMLLIElement) return nextLi;
  return null;
}

/**
 * Split list at the current item → normal margin paragraph (keep text if any).
 * Result: [list before?][paragraph][list after?]. Never unwraps sibling items.
 */
export function convertListItemToParagraph(
  li: HTMLLIElement,
  cleanupEmptyListShell: (list: HTMLUListElement | HTMLOListElement) => void,
): HTMLDivElement | null {
  const list = li.parentElement;
  if (!list || !LIST_TAG_NAMES.has(list.tagName)) return null;
  const parent = list.parentNode;
  if (!parent) return null;

  const listEl = list as HTMLUListElement | HTMLOListElement;
  const ordered = listEl.tagName === 'OL';
  const div = document.createElement('div');
  div.setAttribute('dir', 'auto');
  while (li.firstChild) div.appendChild(li.firstChild);
  stripNewParagraphIndent(div);
  const text = div.textContent?.replace(/\u200B/g, '').trim() ?? '';
  if (!text && !div.querySelector('img')) div.innerHTML = '<br>';

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

/** Split list at empty item → margin paragraph (Word step 1). */
export function convertEmptyListItemToParagraph(
  li: HTMLLIElement,
  cleanupEmptyListShell: (list: HTMLUListElement | HTMLOListElement) => void,
): HTMLDivElement | null {
  return convertListItemToParagraph(li, cleanupEmptyListShell);
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

/** Only strip a lone empty list shell; keep multi-item lists even when all items are empty. */
export function shouldRemoveOrphanEmptyLists(allLiCount: number, hasNonEmptyLi: boolean): boolean {
  if (hasNonEmptyLi) return false;
  if (allLiCount > 1) return false;
  return true;
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

/** True when range fully covers the element's contents. */
export function rangeFullyCoversNode(range: Range, el: Node): boolean {
  const itemRange = document.createRange();
  itemRange.selectNodeContents(el);
  return range.compareBoundaryPoints(Range.START_TO_START, itemRange) <= 0
    && range.compareBoundaryPoints(Range.END_TO_END, itemRange) >= 0;
}

/**
 * Delete a non-collapsed selection across paragraphs/list items.
 * Leaves the caret collapsed at the start of the deleted range.
 * Removes shells that were fully covered and became empty.
 */
export function deleteSelectionRangeContents(
  root: HTMLElement,
  range: Range,
): Range {
  const fullyCovered: HTMLElement[] = [];
  root.querySelectorAll<HTMLElement>('div, p, li').forEach((el) => {
    if (el === root) return;
    try {
      if (!range.intersectsNode(el)) return;
    } catch {
      return;
    }
    // Skip nested blocks inside list items (the li itself is enough).
    if (el.tagName !== 'LI' && el.closest('li')) return;
    if (rangeFullyCoversNode(range, el)) fullyCovered.push(el);
  });

  const del = range.cloneRange();
  del.deleteContents();

  for (const el of fullyCovered) {
    if (!el.isConnected) continue;
    const text = (el.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    const hasMedia = !!el.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame');
    if (text || hasMedia) continue;
    if (el.tagName === 'LI') {
      const list = el.parentElement;
      el.remove();
      if (list && LIST_TAG_NAMES.has(list.tagName) && list.children.length === 0) list.remove();
    } else if (!el.closest('li, ul, ol')) {
      el.remove();
    }
  }

  mergeAdjacentLists(root);
  return del;
}
