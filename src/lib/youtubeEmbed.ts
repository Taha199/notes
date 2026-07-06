export const NOTE_YT_FRAME = 'note-yt-frame';
export const NOTE_YT_LINK = 'note-yt-link';
export const NOTE_YT_PLAYER = 'note-yt-player';

const YOUTUBE_VIDEO_ID_RE = /[\w-]{11}/;

const YOUTUBE_URL_PATTERNS = [
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?(?:[^\s<>&"']*&)?v=([\w-]{11})[^\s<]*/gi,
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([\w-]{11})[^\s<]*/gi,
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/embed\/([\w-]{11})[^\s<]*/gi,
  /https?:\/\/youtu\.be\/([\w-]{11})[^\s<]*/gi,
];

export function extractYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(trimmed);
    if (match?.[1] && YOUTUBE_VIDEO_ID_RE.test(match[1])) return match[1];
  }
  return null;
}

export function normalizeYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function createYouTubeEmbedElement(videoId: string, watchUrl?: string): HTMLDivElement {
  const url = watchUrl ?? normalizeYouTubeWatchUrl(videoId);
  const frame = document.createElement('div');
  frame.className = NOTE_YT_FRAME;
  frame.setAttribute('contenteditable', 'false');
  frame.setAttribute('dir', 'auto');
  frame.dataset.ytVideoId = videoId;

  const link = document.createElement('a');
  link.className = NOTE_YT_LINK;
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = url;

  const player = document.createElement('div');
  player.className = NOTE_YT_PLAYER;

  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}`;
  iframe.title = 'YouTube video';
  iframe.setAttribute(
    'allow',
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  );
  iframe.allowFullscreen = true;
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';

  player.appendChild(iframe);
  frame.appendChild(link);
  frame.appendChild(player);
  return frame;
}

function findYouTubeUrls(text: string): { index: number; length: number; videoId: string; url: string }[] {
  const matches: { index: number; length: number; videoId: string; url: string }[] = [];
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const videoId = match[1];
      if (!videoId || !YOUTUBE_VIDEO_ID_RE.test(videoId)) continue;
      const url = match[0];
      const index = match.index;
      const overlaps = matches.some(
        (existing) => index < existing.index + existing.length && index + url.length > existing.index,
      );
      if (!overlaps) matches.push({ index, length: url.length, videoId, url });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function upgradeAnchorToEmbed(anchor: HTMLAnchorElement): boolean {
  if (anchor.closest(`.${NOTE_YT_FRAME}`)) return false;
  const videoId = extractYouTubeVideoId(anchor.href);
  if (!videoId) return false;
  anchor.replaceWith(createYouTubeEmbedElement(videoId, anchor.href));
  return true;
}

function upgradeTextNodeToEmbeds(textNode: Text): boolean {
  const parent = textNode.parentNode;
  if (!parent) return false;
  const text = textNode.textContent ?? '';
  const matches = findYouTubeUrls(text);
  if (matches.length === 0) return false;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    frag.appendChild(createYouTubeEmbedElement(match.videoId, match.url));
    lastIndex = match.index + match.length;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  parent.replaceChild(frag, textNode);
  return true;
}

/** Convert plain YouTube URLs (and bare YouTube links) into inline playable embeds. */
export function normalizeYouTubeEmbeds(root: HTMLElement): boolean {
  let changed = false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${NOTE_YT_FRAME}`)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('a')) return NodeFilter.FILTER_REJECT;
      const text = node.textContent ?? '';
      if (!/youtube|youtu\.be/i.test(text)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) textNodes.push(current as Text);

  for (const textNode of textNodes) {
    if (upgradeTextNodeToEmbeds(textNode)) changed = true;
  }

  root.querySelectorAll(`a[href]:not(.${NOTE_YT_LINK})`).forEach((node) => {
    if (node instanceof HTMLAnchorElement && upgradeAnchorToEmbed(node)) changed = true;
  });

  root.querySelectorAll(`.${NOTE_YT_FRAME}`).forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    node.setAttribute('contenteditable', 'false');
    const videoId = node.dataset.ytVideoId ?? extractYouTubeVideoId(node.querySelector(`.${NOTE_YT_LINK}`)?.textContent ?? '');
    if (!videoId) return;
    const iframe = node.querySelector('iframe');
    const expectedSrc = `https://www.youtube-nocookie.com/embed/${videoId}`;
    if (iframe instanceof HTMLIFrameElement && iframe.src !== expectedSrc) iframe.src = expectedSrc;
  });

  return changed;
}

export function insertYouTubeEmbedAtRange(range: Range, videoId: string, watchUrl: string): void {
  range.deleteContents();
  const embed = createYouTubeEmbedElement(videoId, watchUrl);
  range.insertNode(embed);

  const after = document.createRange();
  after.setStartAfter(embed);
  after.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(after);
}
