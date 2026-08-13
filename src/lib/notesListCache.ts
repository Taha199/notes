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
export const NOTES_ARCHIVE_CACHE_KEY = 'malacadhati_notes_archive_cache';

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

/** Tiny membership+preview cache — never store note HTML (images blow quota). */
export function compactNoteForListCache(note: Note): Note {
  const text = (note.text || '').slice(0, 400);
  return {
    id: Number(note.id),
    title: note.title || '',
    text,
    html: '',
    fav: !!note.fav,
    read: !!note.read,
    archived: !!note.archived,
    trashed: !!note.trashed,
    deletedAt: note.deletedAt,
    date: note.date || '',
    lastEdited: note.lastEdited,
    savedAt: note.savedAt,
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

/** Never shrink the durable list cache with an incomplete LS shell. */
export function writeNotesListCache(notes: Note[]): void {
  if (!notes.length) return;
  const prev = readNotesListCache();
  const byId = new Map<number, Note>();
  for (const note of [...prev, ...notes]) {
    const id = Number(note.id);
    if (!Number.isFinite(id)) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, note);
      continue;
    }
    // Prefer the incoming body when it is richer / newer meta.
    const incomingLen = (note.html || '').length + (note.title || '').length;
    const existingLen = (existing.html || '').length + (existing.title || '').length;
    const incomingAt = Date.parse(note.savedAt || '') || 0;
    const existingAt = Date.parse(existing.savedAt || '') || 0;
    if (incomingLen > existingLen || (incomingLen === existingLen && incomingAt >= existingAt)) {
      byId.set(id, note);
    }
  }
  const merged = [...byId.values()];
  const incomingArchived = notes.filter((n) => n.archived && !n.trashed);
  if (incomingArchived.length) writeArchiveNotesCache(incomingArchived);
  const compact = compactNotesForListCache(merged);
  try {
    const json = JSON.stringify(compact);
    if (!writeTinyDurableValue(NOTES_LIST_CACHE_KEY, json)) {
      localStorage.setItem(NOTES_LIST_CACHE_KEY, json);
    }
  } catch {
    /* quota — IDB remains source of truth */
  }
}

export function readArchiveNotesCache(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_ARCHIVE_CACHE_KEY);
    if (!raw) {
      return readNotesListCache().filter((n) => n.archived && !n.trashed);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is Note => !!n && typeof n === 'object' && (n as Note).id != null && !!(n as Note).archived);
  } catch {
    return [];
  }
}

export function writeArchiveNotesCache(notes: Note[]): void {
  const archived = compactNotesForListCache(notes.filter((n) => n.archived && !n.trashed));
  try {
    const json = JSON.stringify(archived);
    if (!writeTinyDurableValue(NOTES_ARCHIVE_CACHE_KEY, json)) {
      localStorage.setItem(NOTES_ARCHIVE_CACHE_KEY, json);
    }
  } catch {
    /* quota */
  }
}

export function clearNotesListCache(): void {
  try {
    localStorage.removeItem(NOTES_LIST_CACHE_KEY);
    localStorage.removeItem(NOTES_ARCHIVE_CACHE_KEY);
  } catch { /* ignore */ }
  clearNotesBootCache();
}
