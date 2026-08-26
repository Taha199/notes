import type { Note } from '../types';

export function normalizeSearch(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export type SearchHitCounter = { value: number };

type HaystackCacheEntry = { key: string; haystack: string };
const noteHaystackCache = new WeakMap<Note, HaystackCacheEntry>();

function noteHaystackKey(note: Note) {
  return `${note.title ?? ''}\0${note.text ?? ''}\0${note.html ?? ''}\0${note.date ?? ''}`;
}

function noteSearchHaystack(note: Note) {
  const key = noteHaystackKey(note);
  const cached = noteHaystackCache.get(note);
  if (cached?.key === key) return cached.haystack;
  const plainHtml = decodeBasicEntities(note.html.replace(/<[^>]*>/g, ' '));
  const haystack = normalizeSearch([note.title, note.text, plainHtml, note.date].join(' '));
  noteHaystackCache.set(note, { key, haystack });
  return haystack;
}

export function noteMatchesSearch(note: Note, search: string) {
  const query = normalizeSearch(search);
  if (!query) return true;
  const haystack = noteSearchHaystack(note);
  return query.split(/\s+/).filter(Boolean).every((token) => haystack.includes(token));
}

export function filterNotesBySearch(notes: Note[], search: string) {
  const query = normalizeSearch(search);
  if (!query) return notes;
  return notes.filter((note) => noteMatchesSearch(note, search));
}

export function searchTokens(search: string) {
  return normalizeSearch(search).split(/\s+/).filter(Boolean);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Base letters -> common precomposed accented variants (NFC text). */
const ACCENT_GROUPS: Record<string, string> = {
  a: 'aàáâãäåāăą',
  e: 'eèéêëēėę',
  i: 'iìíîïīį',
  o: 'oòóôõöøōő',
  u: 'uùúûüūůű',
  y: 'yýÿỳ',
  n: 'nñń',
  c: 'cçćč',
  s: 'sśšş',
  z: 'zźżž',
  l: 'lł',
  d: 'dđ',
  g: 'gğ',
  r: 'rř',
  t: 'tť',
};

/** Match a normalized token against raw text that may still contain diacritics. */
function tokenToAccentInsensitivePattern(token: string) {
  return token
    .split('')
    .map((char) => {
      const group = ACCENT_GROUPS[char];
      if (group) return `[${group}${group.toUpperCase()}]`;
      return escapeRegex(char);
    })
    .join('');
}

export function buildSearchHighlightPattern(search: string) {
  const tokens = searchTokens(search);
  if (!tokens.length) return null;
  return new RegExp(`(${tokens.map(tokenToAccentInsensitivePattern).join('|')})`, 'gi');
}

/** Cap hit counting so short/common queries cannot allocate huge match arrays. */
export const MAX_SEARCH_HIT_COUNT = 200;

export function countSearchMatchesInText(text: string, search: string, max = MAX_SEARCH_HIT_COUNT) {
  const pattern = buildSearchHighlightPattern(search);
  if (!pattern) return 0;
  const re = new RegExp(pattern.source, 'gi');
  let count = 0;
  while (re.exec(text) !== null) {
    count += 1;
    if (count >= max) break;
  }
  return count;
}

export function getNoteSearchPlainText(note: Note) {
  const plainHtml = decodeBasicEntities(note.html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  const plainText = decodeBasicEntities(note.text ?? '').replace(/\s+/g, ' ').trim();
  return plainText || plainHtml;
}

export function countNoteSearchHits(note: Note, search: string) {
  const title = note.title ?? '';
  const body = getNoteSearchPlainText(note);
  return countSearchMatchesInText(title, search) + countSearchMatchesInText(body, search);
}

export function buildSearchHitStarts(notes: Note[], search: string) {
  const starts: Record<number, number> = {};
  let total = 0;
  for (const note of notes) {
    starts[note.id] = total;
    total += countNoteSearchHits(note, search);
  }
  return { starts, total };
}

export function isSearchHit(part: string, search: string) {
  const tokens = searchTokens(search);
  const normalized = normalizeSearch(part);
  return tokens.some((token) => normalized === token || normalized.includes(token));
}

export function splitForHighlight(text: string, search: string) {
  const pattern = buildSearchHighlightPattern(search);
  if (!pattern) return [text];
  return text.split(pattern);
}

function markClass(activeHitIndex: number | null, hitIndex: number) {
  return hitIndex === activeHitIndex ? 'note-search-hit note-search-hit--active' : 'note-search-hit';
}

export function highlightHtmlContent(
  html: string,
  search: string,
  counter: SearchHitCounter,
  activeHitIndex: number | null,
) {
  const pattern = buildSearchHighlightPattern(search);
  if (!pattern) return html;

  const highlightText = (text: string) =>
    text.replace(pattern, (match: string) => {
      const hitIndex = counter.value++;
      return `<mark class="${markClass(activeHitIndex, hitIndex)}" data-search-hit="${hitIndex}">${match}</mark>`;
    });

  if (!/<[a-z][\s\S]*>/i.test(html)) return highlightText(html);

  return html.replace(/>([^<]+)</g, (_match, text: string) => `>${highlightText(text)}<`);
}

export function nextSearchHitIndex(current: number, total: number, direction: 1 | -1) {
  if (total <= 0) return 0;
  return (current + direction + total) % total;
}
