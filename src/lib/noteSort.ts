import type { Note } from '../types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Sort key from note creation — uses explicit-year dates or note.id (Date.now() at create). */
export function noteCreatedAtMs(note: Note): number {
  const createdMs = note.id;
  if (!note.date) return createdMs;

  // Locale strings like "4 Jul, 14:05" have no year — Date.parse picks ~2001, so use note.id.
  if (!ISO_DATE.test(note.date) && !/\d{4}/.test(note.date)) {
    return createdMs;
  }

  const parsed = Date.parse(note.date);
  if (!Number.isNaN(parsed)) return parsed;
  return createdMs;
}

export function sortNotesByCreatedDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => noteCreatedAtMs(b) - noteCreatedAtMs(a));
}
