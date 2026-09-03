import { describe, expect, it } from 'vitest';
import { fileAddedAtMs, sortStoredFiles, type StoredFile } from './fileTypes';

function file(partial: Partial<StoredFile> & Pick<StoredFile, 'id' | 'name' | 'size' | 'addedAt'>): StoredFile {
  return { type: 'application/pdf', ...partial };
}

describe('sortStoredFiles', () => {
  const a = file({ id: 'a', name: 'a.pdf', size: 100, addedAt: '2026-09-01 10:00:00' });
  const b = file({ id: 'b', name: 'b.pdf', size: 500, addedAt: '2026-09-03 12:00:00' });
  const c = file({ id: 'c', name: 'c.pdf', size: 200, addedAt: '2026-08-01 08:00:00' });

  it('sorts newest upload first', () => {
    expect(sortStoredFiles([a, b, c], 'date-new').map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });

  it('sorts oldest upload first', () => {
    expect(sortStoredFiles([a, b, c], 'date-old').map((f) => f.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts by size largest first', () => {
    expect(sortStoredFiles([a, b, c], 'size-large').map((f) => f.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by size smallest first', () => {
    expect(sortStoredFiles([a, b, c], 'size-small').map((f) => f.id)).toEqual(['a', 'c', 'b']);
  });

  it('parses locale-style timestamps', () => {
    expect(fileAddedAtMs('2026-09-03 01:18:26')).toBeGreaterThan(fileAddedAtMs('2026-08-27 10:38:00'));
  });

  it('sorts mixed ISO and day/month locale dates newest first', () => {
    const mixed = [
      file({ id: 'iso-jul21', name: 'a.pdf', size: 1, addedAt: '2026-07-21 00:38:32' }),
      file({ id: 'iso-jul16', name: 'b.pdf', size: 1, addedAt: '2026-07-16 20:43:46' }),
      file({ id: 'eu-jul29', name: 'c.pdf', size: 1, addedAt: '29/07/2026, 09:58:32' }),
      file({ id: 'eu-aug31', name: 'd.pdf', size: 1, addedAt: '31/08/2026, 12:07:24' }),
      file({ id: 'eu-jul17', name: 'e.pdf', size: 1, addedAt: '17/07/2026, 09:42:39' }),
    ];
    expect(sortStoredFiles(mixed, 'date-new').map((f) => f.id)).toEqual([
      'eu-aug31',
      'eu-jul29',
      'iso-jul21',
      'eu-jul17',
      'iso-jul16',
    ]);
  });

  it('treats 29/07/2026 as 29 July, not invalid US month', () => {
    const jul29 = fileAddedAtMs('29/07/2026, 09:58:32');
    const jul21 = fileAddedAtMs('2026-07-21 00:38:32');
    expect(jul29).toBeGreaterThan(jul21);
  });

  it('parses day/month dates with RTL marks or odd slashes', () => {
    expect(fileAddedAtMs('\u200e31/08/2026, 12:07:24')).toBe(fileAddedAtMs('31/08/2026, 12:07:24'));
    expect(fileAddedAtMs('31.08.2026, 12:07:24')).toBe(fileAddedAtMs('31/08/2026, 12:07:24'));
  });

  it('falls back to Date.now prefix in the file id', () => {
    const aug = Date.parse('2026-08-31T12:07:24');
    const listed = [
      file({ id: '1', name: 'old.pdf', size: 1, addedAt: '2026-07-21 00:38:32' }),
      file({ id: `${aug}-xyz`, name: 'newer.jpeg', size: 1, addedAt: 'not-a-date' }),
    ];
    expect(sortStoredFiles(listed, 'date-new').map((f) => f.name)).toEqual(['newer.jpeg', 'old.pdf']);
  });
});
