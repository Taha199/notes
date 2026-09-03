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
});
