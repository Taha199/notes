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

function noteSearchHaystack(note: Note) {
  const plainHtml = decodeBasicEntities(note.html.replace(/<[^>]*>/g, ' '));
  return normalizeSearch([note.title, note.text, plainHtml, note.date].join(' '));
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

export function buildSearchHighlightPattern(search: string) {
  const tokens = searchTokens(search);
  if (!tokens.length) return null;
  return new RegExp(`(${tokens.map(escapeRegex).join('|')})`, 'gi');
}

export function isSearchHit(part: string, search: string) {
  const tokens = searchTokens(search);
  const normalized = normalizeSearch(part);
  return tokens.some((token) => normalized === token);
}

export function splitForHighlight(text: string, search: string) {
  const pattern = buildSearchHighlightPattern(search);
  if (!pattern) return [text];
  return text.split(pattern);
}

export function highlightHtmlContent(html: string, search: string) {
  const pattern = buildSearchHighlightPattern(search);
  if (!pattern) return html;
  return html.replace(/>([^<]+)</g, (_match, text: string) => {
    const highlighted = text.replace(pattern, '<mark class="note-search-hit">$1</mark>');
    return `>${highlighted}<`;
  });
}
