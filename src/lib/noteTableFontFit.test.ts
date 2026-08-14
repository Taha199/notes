import { describe, expect, it } from 'vitest';
import {
  NOTE_TABLE_BASE_FONT_PX,
  NOTE_TABLE_MIN_FONT_PX,
  suggestedNoteTableFontPx,
} from './noteTable';

describe('suggestedNoteTableFontPx', () => {
  it('keeps base size for a few wide columns', () => {
    expect(suggestedNoteTableFontPx(3, 600)).toBe(NOTE_TABLE_BASE_FONT_PX);
  });

  it('shrinks for six columns in a narrow editor', () => {
    const px = suggestedNoteTableFontPx(6, 420);
    expect(px).toBeLessThanOrEqual(11);
    expect(px).toBeGreaterThanOrEqual(NOTE_TABLE_MIN_FONT_PX);
  });

  it('never goes below the minimum', () => {
    expect(suggestedNoteTableFontPx(12, 200)).toBe(NOTE_TABLE_MIN_FONT_PX);
  });
});
