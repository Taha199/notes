/**
 * Sync-friendly notes snapshot for instant first paint.
 *
 * Full note HTML (esp. base64 images) often exceeds localStorage quota, so the
 * main `malacadhati` array can be empty/incomplete on refresh while IndexedDB
 * still holds every note. This compact cache strips bulky data-URI images so
 * the list/cards appear immediately; IDB/cloud then restore full bodies.
 */
import type { Note } from '../types';
import { writeTinyDurableValue } from './quizTrashTombstones';

export const NOTES_LIST_CACHE_KEY = 'malacadhati_notes_list_cache';

/** In-memory last painted notes for this JS session (survives React remount). */
let notesBootCache: Note[] | null = null;

export function rememberNotesBootCache(notes: Note[], force = false): void {
  if (!notes.length) return;
  if (
    !force
    && notesBootCache
    && notesBootCache.length > notes.length
  ) {
    return;
  }
  notesBootCache = notes;
}

export function readNotesBootCache(): Note[] {
  return notesBootCache ? [...notesBootCache] : [];
}

export function clearNotesBootCache(): void {
  notesBootCache = null;
}

/** Drop multi-MB data-URI images so the list cache fits in localStorage. */
export function compactNoteForListCache(note: Note): Note {
  const html = note.html;
  if (!html || !/data:image\//i.test(html)) return note;
  return {
    ...note,
    html: html.replace(
      /(<img\b[^>]*\bsrc\s*=\s*)(["'])data:image\/[^"']*\2/gi,
      '$1$2$2 data-img-pending="1"',
    ),
  };
}

export function compactNotesForListCache(notes: Note[]): Note[] {
  return notes.map(compactNoteForListCache);
}

export function readNotesListCache(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_LIST_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is Note => !!n && typeof n === 'object' && (n as Note).id != null);
  } catch {
    return [];
  }
}

export function writeNotesListCache(notes: Note[]): void {
  if (!notes.length) return;
  const compact = compactNotesForListCache(notes);
  try {
    const json = JSON.stringify(compact);
    if (!writeTinyDurableValue(NOTES_LIST_CACHE_KEY, json)) {
      localStorage.setItem(NOTES_LIST_CACHE_KEY, json);
    }
  } catch {
    /* quota — IDB remains source of truth */
  }
}

export function clearNotesListCache(): void {
  try {
    localStorage.removeItem(NOTES_LIST_CACHE_KEY);
  } catch { /* ignore */ }
  clearNotesBootCache();
}
