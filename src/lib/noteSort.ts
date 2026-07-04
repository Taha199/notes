import type { Note } from '../types';

/** Sort key from note creation date (Created field), not lastEdited or savedAt. */
export function noteCreatedAtMs(note: Note): number {
  if (note.date) {
    const t = Date.parse(note.date);
    if (!Number.isNaN(t)) return t;
  }
  return note.id;
}

export function sortNotesByCreatedDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => noteCreatedAtMs(b) - noteCreatedAtMs(a));
}
