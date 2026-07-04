import type { Note } from '../types';

/** Best-effort timestamp for when the note was last saved (newest sort key). */
export function noteSavedAtMs(note: Note): number {
  if (note.savedAt) {
    const t = Date.parse(note.savedAt);
    if (!Number.isNaN(t)) return t;
  }
  for (const raw of [note.lastEdited, note.date]) {
    if (!raw) continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return t;
  }
  return note.id;
}

export function sortNotesBySavedDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => noteSavedAtMs(b) - noteSavedAtMs(a));
}
