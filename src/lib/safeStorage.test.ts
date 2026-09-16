import { afterEach, describe, expect, it } from 'vitest';
import { MAX_LOCALSTORAGE_VALUE_CHARS, safeLocalStorageSet } from './safeStorage';

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('safeLocalStorageSet', () => {
  it('writes small values', () => {
    expect(safeLocalStorageSet('k', 'ok')).toBe(true);
    expect(localStorage.getItem('k')).toBe('ok');
  });

  it('skips oversized values without throwing or storing', () => {
    expect(safeLocalStorageSet('k', 'x'.repeat(MAX_LOCALSTORAGE_VALUE_CHARS + 1))).toBe(false);
    expect(localStorage.getItem('k')).toBeNull();
  });
});
