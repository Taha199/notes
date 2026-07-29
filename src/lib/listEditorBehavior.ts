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
  return !!getPseudoListPrefix(probe) || !!getGenericBulletPrefix(probe);
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

const INLINE_WRAP_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'SPAN', 'FONT', 'SUB', 'SUP', 'MARK', 'BR']);

/**
 * Character-agnostic bullet detection: a single leading symbol char (any non
 * letter/number/space) followed by whitespace. Used only for runs of 2+
 * consecutive lines so normal prose is never affected.
 */
const GENERIC_BULLET_PREFIX_RE =
  /^[\s\u00a0\u200B\uFEFF\u202F]*([^\p{L}\p{N}\s\u00a0\u200B\uFEFF\u202F])[\s\u00a0\u202F]+/u;

// Symbols that are NOT bullets even when they lead a line (emoji, quotes,
// brackets, sentence punctuation) — never strip these as list markers.
const NON_BULLET_LEAD_RE = /[\p{Extended_Pictographic}"'`«»‹›“”‘’()\[\]{}<>@#&$%^_=+|~,.?!;:]/u;

function isBulletLikeSymbol(symbol: string): boolean {
  if (!symbol) return false;
  return !NON_BULLET_LEAD_RE.test(symbol);
}

function getGenericBulletPrefix(block: HTMLElement): RegExpMatchArray | null {
  if (block.closest('li, ul, ol')) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  const pick = (raw: string): RegExpMatchArray | null => {
    const m = raw.match(GENERIC_BULLET_PREFIX_RE);
    return m && isBulletLikeSymbol(m[1]) ? m : null;
  };
  while (node) {
    const raw = node.textContent ?? '';
    if (!raw.replace(/[\u200B\uFEFF\s\u00a0]/g, '')) {
      node = walker.nextNode();
      continue;
    }
    return pick(raw);
  }
  return pick(block.textContent ?? '');
}

function stripGenericBulletPrefixFromElement(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const raw = node.textContent ?? '';
    if (!raw.replace(/[\u200B\uFEFF\s\u00a0]/g, '')) {
      node = walker.nextNode();
      continue;
    }
    const stripped = raw.replace(GENERIC_BULLET_PREFIX_RE, '');
    if (stripped !== raw) node.textContent = stripped;
    return;
  }
}

/**
 * Convert runs of 2+ consecutive sibling blocks that each start with the same
 * leading symbol (any bullet-like char) into a native <ul>. Char-agnostic, so
 * it catches whatever glyph ChatGPT/Word/etc. used.
 */
export function convertSymbolPrefixedRunsToLists(root: HTMLElement): boolean {
  let changed = false;
  const parents = new Set<HTMLElement>([root]);
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    if (el.children.length > 0) parents.add(el);
  });

  for (const parent of parents) {
    let i = 0;
    const kids = () => [...parent.children].filter((c): c is HTMLElement => c instanceof HTMLElement);
    let children = kids();
    while (i < children.length) {
      const block = children[i];
      if (
        !PSEUDO_LIST_BLOCK_TAGS.has(block.tagName)
        || block.closest('li, ul, ol') !== null && block.parentElement !== parent
      ) { i++; continue; }
      const std = getPseudoListPrefix(block);
      const gen = std ? null : getGenericBulletPrefix(block);
      if (!gen) { i++; continue; }
      const symbol = gen[1];
      // Collect the consecutive run sharing this same leading symbol.
      const run: HTMLElement[] = [block];
      let j = i + 1;
      while (j < children.length) {
        const next = children[j];
        if (!PSEUDO_LIST_BLOCK_TAGS.has(next.tagName)) break;
        const m = getGenericBulletPrefix(next);
        if (!m || m[1] !== symbol) break;
        run.push(next);
        j++;
      }
      if (run.length < 2) { i++; continue; }

      const list = document.createElement('ul');
      list.setAttribute('dir', 'auto');
      parent.insertBefore(list, block);
      run.forEach((b) => {
        const li = document.createElement('li');
        li.setAttribute('dir', 'auto');
        while (b.firstChild) li.appendChild(b.firstChild);
        stripGenericBulletPrefixFromElement(li);
        if (!li.textContent?.replace(/\u200B/g, '').trim() && !li.querySelector('img')) {
          li.innerHTML = '<br>';
        }
        list.appendChild(li);
      });
      run.forEach((b) => b.remove());
      changed = true;
      children = kids();
      i = 0;
    }
  }
  return changed;
}

/**
 * Wrap loose top-level text / inline nodes (e.g. a bare "• …" text node pasted
 * straight under the editor) into block divs so the list logic can see them.
 */
export function wrapLooseInlineChildren(root: HTMLElement): boolean {
  let changed = false;
  let run: HTMLElement | null = null;
  const flush = () => { run = null; };
  for (const node of [...root.childNodes]) {
    const isInline =
      node.nodeType === Node.TEXT_NODE
      || (node instanceof HTMLElement && INLINE_WRAP_TAGS.has(node.tagName));
    if (!isInline) { flush(); continue; }
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').replace(/[\u200B\uFEFF]/g, '').trim()) {
      // Keep stray whitespace attached to the current run if one exists.
      if (run) run.appendChild(node);
      continue;
    }
    if (!run) {
      run = document.createElement('div');
      run.setAttribute('dir', 'auto');
      root.insertBefore(run, node);
      changed = true;
    }
    run.appendChild(node);
  }
  return changed;
}

/**
 * Turn pasted ChatGPT/plain pseudo-lists (`• text` in div/p) into real ul/ol/li
 * so Enter/Backspace/list toolbar match manually created lists.
 */
export function convertPseudoBulletBlocksToNativeLists(root: HTMLElement): boolean {
  const wrapChanged = wrapLooseInlineChildren(root);
  const splitChanged = splitBrSeparatedPseudoListBlocks(root);
  let changed = wrapChanged || splitChanged;
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

  // Char-agnostic fallback for exotic bullet glyphs (runs of 2+ lines).
  if (convertSymbolPrefixedRunsToLists(root)) changed = true;

  if (explodePseudoBulletLinesInListItems(root)) changed = true;
  if (normalizeListItemStructure(root)) changed = true;
  if (changed) mergeAdjacentLists(root);
  return changed;
}

/**
 * Normalize an HTML *string* so any pseudo bullet/number lines become real
 * ul/ol/li. Runs on a detached node — safe to call on serialized output.
 * Returns the original string when nothing needed converting.
 */
export function normalizePseudoListsInHtmlString(html: string): string {
  if (!html) return html;
  // Cheap gate: known bullet/number markers, OR any symbol char right after a
  // block open tag followed by whitespace (catches exotic bullet glyphs).
  const hasKnownMarker = /[\uF0B7\uF0A7\u2022\u2023\u2043\u2219\u2024\u25E6\u25AA\u25CF\u25CB•●◦▪▫‣⁃·∙・○■□➢➤]|\d+[.)]/.test(html);
  const hasGenericMarker = />[\s\u00a0]*[^\w\s<>&][\s\u00a0\u202F]/u.test(html);
  if (!hasKnownMarker && !hasGenericMarker) return html;
  const root = document.createElement('div');
  root.innerHTML = html;
  const changed = convertPseudoBulletBlocksToNativeLists(root);
  return changed ? root.innerHTML : html;
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

/** Build mixed HTML from plain text: bullet runs → lists, other lines → paragraphs. */
export function plainTextToMixedHtml(plain: string): string | null {
  const lines = plain.replace(/\r\n/g, '\n').split('\n');
  let sawBullet = false;
  const parts: string[] = [];
  let listBuffer: { ordered: boolean; content: string }[] = [];
  const flushList = () => {
    if (listBuffer.length === 0) return;
    const ordered = listBuffer.every((it) => it.ordered);
    const tag = ordered ? 'ol' : 'ul';
    const body = listBuffer
      .map((it) => `<li dir="auto">${escapeHtmlPlain(it.content.trim()) || '<br>'}</li>`)
      .join('');
    parts.push(`<${tag} dir="auto">${body}</${tag}>`);
    listBuffer = [];
  };
  for (const line of lines) {
    const match = line.match(BULLET_PREFIX_RE);
    if (match && line.slice(match[0].length).trim()) {
      sawBullet = true;
      listBuffer.push({ ordered: /\d+[.)]/.test(match[0]), content: line.slice(match[0].length) });
      continue;
    }
    flushList();
    if (line.trim()) parts.push(`<div dir="auto">${escapeHtmlPlain(line.trim())}</div>`);
  }
  flushList();
  if (!sawBullet || parts.length === 0) return null;
  return parts.join('');
}

/**
 * Infer the list type from plain-text markers. Returns 'ol'/'ul' only when the
 * WHOLE plain text is a marked list (so mixed content returns null and keeps its
 * original structure).
 */
export function inferPlainListType(plain: string): 'ol' | 'ul' | null {
  const lines = plain.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return null;
  let allNumbered = true;
  let allBulleted = true;
  for (const line of lines) {
    const m = line.match(BULLET_PREFIX_RE);
    if (!m || !line.slice(m[0].length).trim()) return null;
    if (/\d+[.)]/.test(m[0])) allBulleted = false;
    else allNumbered = false;
  }
  if (allNumbered) return 'ol';
  if (allBulleted) return 'ul';
  return null;
}

function renameListElement(list: HTMLElement, tag: 'ol' | 'ul'): HTMLElement {
  if (list.tagName.toLowerCase() === tag) return list;
  const next = document.createElement(tag);
  for (const attr of list.attributes) next.setAttribute(attr.name, attr.value);
  next.setAttribute('dir', 'auto');
  while (list.firstChild) next.appendChild(list.firstChild);
  list.parentNode?.replaceChild(next, list);
  return next;
}

/** Wrap consecutive bare <li> (not inside ul/ol) into a list of the given type. */
function wrapBareListItems(root: HTMLElement, tag: 'ol' | 'ul'): boolean {
  let changed = false;
  const parents = new Set<HTMLElement>([root]);
  root.querySelectorAll<HTMLElement>('*').forEach((el) => { if (el.children.length) parents.add(el); });
  for (const parent of parents) {
    if (parent.tagName === 'UL' || parent.tagName === 'OL') continue;
    let child = parent.firstElementChild;
    while (child) {
      if (child.tagName === 'LI') {
        const list = document.createElement(tag);
        list.setAttribute('dir', 'auto');
        parent.insertBefore(list, child);
        let node: Element | null = child;
        while (node && node.tagName === 'LI') {
          const next: Element | null = node.nextElementSibling;
          list.appendChild(node);
          node = next;
        }
        changed = true;
        child = list.nextElementSibling;
        continue;
      }
      child = child.nextElementSibling;
    }
  }
  return changed;
}

/**
 * Normalize a whole clipboard payload for insertion: keeps headings/paragraphs
 * AND converts pseudo bullet blocks to real lists. Returns null when there is no
 * list at all (so normal rich/text paste handling can proceed unchanged).
 */
export function clipboardToNormalizedHtml(html: string, plain: string): string | null {
  const plainType = inferPlainListType(plain);
  const h = html.trim();
  if (h) {
    const root = document.createElement('div');
    root.innerHTML = extractClipboardFragment(h);
    root.querySelectorAll('script, style, meta, link, title').forEach((el) => el.remove());
    convertPseudoBulletBlocksToNativeLists(root);
    // Browser can drop the <ol>/<ul> wrapper when a list is copied alone → wrap bare <li>.
    wrapBareListItems(root, plainType ?? 'ul');
    // Only intercept when there is an actual list — otherwise let default paste run.
    if (!root.querySelector('ul, ol')) return null;
    // Plain text is the source of truth for ordering: if the whole copy is a
    // numbered/bulleted list, make the top-level lists match (fixes alone-copy
    // becoming bullets when the browser lost the <ol> wrapper).
    if (plainType) {
      [...root.querySelectorAll('ul, ol')]
        .filter((list) => !list.parentElement?.closest('ul, ol'))
        .forEach((list) => renameListElement(list as HTMLElement, plainType));
    }
    normalizeListItemStructure(root);
    mergeAdjacentLists(root);
    const out = root.innerHTML.trim();
    return out || null;
  }
  const p = plain.trim();
  if (!p) return null;
  return plainTextToMixedHtml(p);
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

/**
 * Innermost DIV/P under `li` that contains the caret — e.g. pasted
 * `<li>Antivirala<div>Vad är skillnad</div></li>` where the inner line has
 * no bullet of its own but still sits at list-body indent.
 */
export function getStuckInnerBlockInListItem(
  li: HTMLLIElement,
  range: Range,
  root?: HTMLElement | null,
): HTMLElement | null {
  if (!li.contains(range.startContainer)) return null;
  let el: Node | null = range.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  let inner: HTMLElement | null = null;
  while (el instanceof HTMLElement && el !== li) {
    if ((el.tagName === 'DIV' || el.tagName === 'P') && el !== root) inner = el;
    el = el.parentElement;
  }
  return inner;
}

/** True when a non-list block still has leftover margin/padding/MSO indent. */
export function blockHasLeftoverIndent(block: HTMLElement, root?: HTMLElement | null): boolean {
  if (LIST_EXIT_INDENT_PROPS.some((prop) => block.style.getPropertyValue(prop))) return true;
  if ([...block.classList].some((cls) => /mso/i.test(cls))) return true;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first?.nodeType === Node.TEXT_NODE) {
    const text = first.textContent ?? '';
    if (/^[\s\u00a0\u2002\u2003]+/.test(text)) return true;
  }
  const parent = block.parentElement;
  if (
    parent
    && parent !== root
    && !LIST_TAG_NAMES.has(parent.tagName)
    && parent.tagName !== 'LI'
  ) {
    if (LIST_EXIT_INDENT_PROPS.some((prop) => parent.style.getPropertyValue(prop))) return true;
    if ([...parent.classList].some((cls) => /mso/i.test(cls))) return true;
  }
  return false;
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

/** Outermost ul/ol containing `from` under `root` (null when not inside a list). */
export function findOutermostList(
  from: HTMLElement,
  root: HTMLElement,
): HTMLUListElement | HTMLOListElement | null {
  let top: HTMLUListElement | HTMLOListElement | null = null;
  let el: HTMLElement | null = from;
  while (el && el !== root) {
    if (LIST_TAG_NAMES.has(el.tagName)) top = el as HTMLUListElement | HTMLOListElement;
    el = el.parentElement;
  }
  return top;
}

/** Insert `node` after a list, walking out of indented wrappers that only wrap the list. */
export function insertAfterListAtRoot(
  list: HTMLUListElement | HTMLOListElement,
  root: HTMLElement,
  node: Node,
): void {
  let anchor: HTMLElement = list;
  let parent: Node | null = list.parentNode;
  let before: Node | null = list.nextSibling;

  while (parent instanceof HTMLElement && parent !== root) {
    const wrapper = parent;
    const hasIndent =
      LIST_EXIT_INDENT_PROPS.some((prop) => wrapper.style.getPropertyValue(prop))
      || [...wrapper.classList].some((cls) => /mso/i.test(cls));
    const onlyListContent = [...wrapper.children].every((child) => {
      if (child === anchor) return true;
      if (child instanceof HTMLElement && LIST_TAG_NAMES.has(child.tagName)) return true;
      if (child instanceof HTMLElement) {
        const text = child.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ').trim() ?? '';
        return !text && !child.querySelector('img');
      }
      return !(child.textContent?.replace(/\u200B/g, '').trim());
    });
    if (hasIndent && onlyListContent && wrapper.parentNode) {
      before = wrapper.nextSibling;
      anchor = wrapper;
      parent = wrapper.parentNode;
      continue;
    }
    break;
  }

  (parent ?? root).insertBefore(node, before);
}

function cleanupEmptyListAncestors(start: HTMLElement | null, root: HTMLElement): void {
  let clean: HTMLElement | null = start;
  while (clean && clean !== root) {
    const parent: HTMLElement | null = clean.parentElement;
    if (LIST_TAG_NAMES.has(clean.tagName) && clean.children.length === 0) {
      clean.remove();
    } else if (
      clean.tagName === 'LI'
      && !(clean.textContent?.replace(/\u200B/g, '').trim())
      && !clean.querySelector('img, ul, ol')
    ) {
      clean.remove();
    } else {
      break;
    }
    clean = parent;
  }
}

function makeRootParagraphFromContents(source: HTMLElement): HTMLDivElement {
  const div = document.createElement('div');
  div.setAttribute('dir', 'auto');
  while (source.firstChild) div.appendChild(source.firstChild);
  stripNewParagraphIndent(div);
  const text = div.textContent?.replace(/\u200B/g, '').trim() ?? '';
  if (!text && !div.querySelector('img')) div.innerHTML = '<br>';
  return div;
}

/** Promote nested li to its parent list (one level). */
function outdentListItemOnce(li: HTMLLIElement): boolean {
  const subList = li.parentElement;
  if (!subList || !LIST_TAG_NAMES.has(subList.tagName)) return false;
  const parentLi = subList.parentElement;
  if (!(parentLi instanceof HTMLLIElement)) return false;
  const outerList = parentLi.parentElement;
  if (!outerList || !LIST_TAG_NAMES.has(outerList.tagName)) return false;
  outerList.insertBefore(li, parentLi.nextSibling);
  if (subList.children.length === 0) subList.remove();
  return true;
}

function isNestedListItemNode(li: HTMLLIElement): boolean {
  const list = li.parentElement;
  return !!list
    && LIST_TAG_NAMES.has(list.tagName)
    && list.parentElement?.closest('li') instanceof HTMLLIElement;
}

/** Lift paragraph out of any remaining list/indent wrappers up to `root`. */
export function forceParagraphToContentMargin(block: HTMLElement, root: HTMLElement): void {
  stripNewParagraphIndent(block);
  let guard = 0;
  while (block.isConnected && block.parentElement && block.parentElement !== root && guard++ < 20) {
    const wrapper = block.parentElement;
    if (LIST_TAG_NAMES.has(wrapper.tagName) || wrapper.tagName === 'LI') {
      const topList = findOutermostList(wrapper, root);
      if (topList?.isConnected) insertAfterListAtRoot(topList, root, block);
      else wrapper.parentNode?.insertBefore(block, wrapper.nextSibling);
      cleanupEmptyListAncestors(wrapper, root);
      stripNewParagraphIndent(block);
      continue;
    }
    const hasIndent =
      LIST_EXIT_INDENT_PROPS.some((prop) => wrapper.style.getPropertyValue(prop))
      || [...wrapper.classList].some((cls) => /mso/i.test(cls));
    if (hasIndent) {
      wrapper.parentNode?.insertBefore(block, wrapper.nextSibling);
      stripNewParagraphIndent(block);
      continue;
    }
    break;
  }
  stripNewParagraphIndent(block);
}

/**
 * Lift a list item completely out of ALL ancestor ul/ol/li to a free paragraph
 * at the same content margin as sibling headings.
 * Outdents fully, splits the top-level list (preserves order), then clears indent wrappers.
 */
export function extractListItemToRootParagraph(
  li: HTMLLIElement,
  root: HTMLElement,
): HTMLDivElement | null {
  if (!root.contains(li)) return null;

  let current = li;
  let guard = 0;
  while (isNestedListItemNode(current) && current.isConnected && guard++ < 20) {
    if (!outdentListItemOnce(current)) break;
  }
  if (!current.isConnected) return null;

  const div = convertListItemToParagraph(current, (listEl) => {
    cleanupEmptyListAncestors(listEl, root);
  });
  if (!div) return null;

  forceParagraphToContentMargin(div, root);
  return div;
}

/**
 * Lift an inner block stuck inside a list item (e.g. `<li>text<div>stuck</div></li>`)
 * out to the editor content margin — without taking sibling content of the li.
 */
export function extractInnerBlockFromListToRoot(
  block: HTMLElement,
  root: HTMLElement,
): HTMLDivElement | null {
  if (!root.contains(block) || block === root) return null;
  if (block.tagName === 'LI') return extractListItemToRootParagraph(block as HTMLLIElement, root);

  const li = block.closest('li');
  if (!(li instanceof HTMLLIElement) || !root.contains(li)) {
    const topList = findOutermostList(block, root);
    stripNewParagraphIndent(block);
    if (topList) insertAfterListAtRoot(topList, root, block);
    else if (block.parentElement !== root) root.appendChild(block);
    forceParagraphToContentMargin(block, root);
    return block instanceof HTMLDivElement ? block : null;
  }

  // If this block is effectively the only content of the li, exit the whole item.
  const probe = li.cloneNode(true) as HTMLLIElement;
  const blocks = [...li.querySelectorAll(':scope > div, :scope > p')];
  const idx = blocks.indexOf(block);
  if (idx >= 0) {
    const probeBlocks = [...probe.querySelectorAll(':scope > div, :scope > p')];
    probeBlocks[idx]?.remove();
  } else {
    const all = [...li.querySelectorAll('div, p')];
    const allIdx = all.indexOf(block);
    if (allIdx >= 0) [...probe.querySelectorAll('div, p')][allIdx]?.remove();
  }
  probe.querySelectorAll('ul, ol').forEach((n) => n.remove());
  const otherText = (probe.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
  if (!otherText && !probe.querySelector('img')) {
    return extractListItemToRootParagraph(li, root);
  }

  const topList = findOutermostList(li, root);
  const div = makeRootParagraphFromContents(block);
  block.remove();
  if (topList?.isConnected) insertAfterListAtRoot(topList, root, div);
  else root.appendChild(div);
  forceParagraphToContentMargin(div, root);
  return div;
}

/**
 * Split list at the current item → normal margin paragraph (keep text if any).
 * Result: [list before?][paragraph][list after?]. Never unwraps sibling items.
 * For nested items prefer {@link extractListItemToRootParagraph}.
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

/**
 * Merge `list` with an immediately-adjacent same-type sibling list, if any.
 * Unlike {@link mergeAdjacentLists}, this never touches unrelated lists elsewhere
 * in the document — a document-wide scan after every list-item Backspace could
 * silently fuse together two otherwise-separate lists far from the edit (e.g. two
 * different bullet lists in a long note), making a later list "inherit" behavior
 * from an earlier one.
 */
export function mergeListWithNeighbors(
  list: HTMLUListElement | HTMLOListElement,
): HTMLUListElement | HTMLOListElement | null {
  if (!list.isConnected) return null;
  let target: HTMLUListElement | HTMLOListElement = list;
  const next = target.nextElementSibling;
  if (next instanceof HTMLElement && next.tagName === target.tagName) {
    while (next.firstChild) target.appendChild(next.firstChild);
    next.remove();
  }
  const prev = target.previousElementSibling;
  if (prev instanceof HTMLElement && prev.tagName === target.tagName) {
    while (target.firstChild) prev.appendChild(target.firstChild);
    target.remove();
    target = prev as HTMLUListElement | HTMLOListElement;
  }
  return target;
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

  const touchedLists = new Set<HTMLUListElement | HTMLOListElement>();
  for (const el of fullyCovered) {
    if (!el.isConnected) continue;
    const text = (el.textContent?.replace(/\u200B/g, '').replace(/\u00a0/g, ' ') ?? '').trim();
    const hasMedia = !!el.querySelector('img, table, iframe, .note-table-wrap, .note-img-frame, .note-yt-frame');
    if (text || hasMedia) continue;
    if (el.tagName === 'LI') {
      const list = el.parentElement;
      el.remove();
      if (list && LIST_TAG_NAMES.has(list.tagName)) {
        if (list.children.length === 0) list.remove();
        else touchedLists.add(list as HTMLUListElement | HTMLOListElement);
      }
    } else if (!el.closest('li, ul, ol')) {
      el.remove();
    }
  }

  // Only re-check adjacency for lists this delete actually touched (plus whatever
  // list sits at the resulting caret boundary) — never scan the whole document.
  // A document-wide merge here could silently fuse two otherwise-unrelated lists
  // elsewhere in a long note together whenever the user deletes a selection.
  const boundaryNode = del.startContainer.nodeType === Node.TEXT_NODE
    ? del.startContainer.parentElement
    : (del.startContainer as HTMLElement | null);
  const boundaryList = boundaryNode ? findOutermostList(boundaryNode, root) : null;
  if (boundaryList) touchedLists.add(boundaryList);
  touchedLists.forEach((list) => mergeListWithNeighbors(list));

  return del;
}
