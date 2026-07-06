import { extractYouTubeVideoId } from './youtubeEmbed';

export const AUTO_LINK_CLASS = 'note-auto-link';

const URL_IN_TEXT_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function normalizeHref(url: string): string {
  return url.startsWith('www.') ? `https://${url}` : url;
}

function trimTrailingPunctuation(url: string): { href: string; display: string; trailing: string } {
  let display = url;
  let trailing = '';
  while (/[.,;:!?)\]}>]$/.test(display)) {
    const ch = display.slice(-1);
    if (ch === ')' && (display.match(/\(/g)?.length ?? 0) >= (display.match(/\)/g)?.length ?? 0)) break;
    trailing = ch + trailing;
    display = display.slice(0, -1);
  }
  return { href: normalizeHref(display), display, trailing };
}

function isSkippableContainer(el: HTMLElement | null): boolean {
  if (!el) return true;
  if (el.closest('a')) return true;
  if (el.closest('.note-yt-frame')) return true;
  if (el.closest('.note-img-frame')) return true;
  return false;
}

export function isPlainUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (extractYouTubeVideoId(trimmed)) return false;
  return /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed);
}

export function createAutoLinkElement(url: string, label?: string): HTMLAnchorElement {
  const { href, display } = trimTrailingPunctuation(url.trim());
  const link = document.createElement('a');
  link.className = AUTO_LINK_CLASS;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label ?? display;
  return link;
}

function findUrlsInText(text: string): { index: number; length: number; url: string }[] {
  const matches: { index: number; length: number; url: string }[] = [];
  URL_IN_TEXT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_IN_TEXT_RE.exec(text)) !== null) {
    const raw = match[0];
    const { href, display } = trimTrailingPunctuation(raw);
    if (extractYouTubeVideoId(href)) continue;
    const index = match.index;
    const length = display.length;
    const overlaps = matches.some(
      (existing) => index < existing.index + existing.length && index + length > existing.index,
    );
    if (!overlaps) matches.push({ index, length, url: display });
  }
  return matches.sort((a, b) => a.index - b.index);
}

function upgradeTextNodeToLinks(textNode: Text): boolean {
  const parent = textNode.parentNode;
  if (!parent) return false;
  const text = textNode.textContent ?? '';
  const matches = findUrlsInText(text);
  if (matches.length === 0) return false;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    frag.appendChild(createAutoLinkElement(match.url));
    lastIndex = match.index + match.length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  parent.replaceChild(frag, textNode);
  return true;
}

/** Turn bare URLs in text nodes into clickable links (YouTube URLs are left for embed handling). */
export function normalizeAutoLinks(root: HTMLElement): boolean {
  let changed = false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (isSkippableContainer(parent)) return NodeFilter.FILTER_REJECT;
      const text = node.textContent ?? '';
      if (!/(?:https?:\/\/|www\.)/i.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);

  for (const textNode of textNodes) {
    if (upgradeTextNodeToLinks(textNode)) changed = true;
  }

  root.querySelectorAll(`a.${AUTO_LINK_CLASS}[href]`).forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return;
    node.target = '_blank';
    node.rel = 'noopener noreferrer';
  });

  return changed;
}

export function insertAutoLinkAtRange(range: Range, url: string): void {
  range.deleteContents();
  const link = createAutoLinkElement(url);
  range.insertNode(link);

  const after = document.createRange();
  after.setStartAfter(link);
  after.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(after);
}
