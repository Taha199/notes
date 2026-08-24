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

function notePinnedAtMs(note: Note): number {
  if (!note.pinned) return 0;
  const parsed = Date.parse(note.pinnedAt || '');
  if (!Number.isNaN(parsed)) return parsed;
  return noteCreatedAtMs(note);
}

/** Pinned notes first (newest pin on top), then by creation date descending. */
export function sortNotesByCreatedDesc(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    if (aPin && bPin) {
      const pinDiff = notePinnedAtMs(b) - notePinnedAtMs(a);
      if (pinDiff !== 0) return pinDiff;
    }
    return noteCreatedAtMs(b) - noteCreatedAtMs(a);
  });
}
