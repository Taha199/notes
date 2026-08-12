import { describe, expect, it } from 'vitest';
import { arabicFromCode, insertAtCursor, insertIntoEditable, shouldRemapPhysicalKey } from './arabicKeyboard';

describe('arabic keyboard mapping', () => {
  it('maps Latin physical keys to Arabic 101 letters', () => {
    expect(arabicFromCode('KeyH', false)).toBe('ا');
    expect(arabicFromCode('KeyF', false)).toBe('ب');
    expect(arabicFromCode('KeyB', false)).toBe('لا');
    expect(arabicFromCode('Slash', true)).toBe('؟');
  });

  it('inserts at the caret without replacing the rest of the text', () => {
    expect(insertAtCursor('مر', 2, 2, 'حبا')).toEqual({ next: 'مرحبا', caret: 5 });
  });

  it('does not steal Enter, shortcuts, or arrows from the app', () => {
    expect(shouldRemapPhysicalKey({ key: 'Enter', metaKey: false, ctrlKey: false, altKey: false })).toBe(false);
    expect(shouldRemapPhysicalKey({ key: 'h', metaKey: false, ctrlKey: true, altKey: false })).toBe(false);
    expect(shouldRemapPhysicalKey({ key: 'h', metaKey: false, ctrlKey: false, altKey: false })).toBe(true);
  });

  it('inserts Arabic into a focused input so React can see the change', () => {
    const input = document.createElement('input');
    input.value = '';
    document.body.appendChild(input);
    input.focus();
    expect(insertIntoEditable(input, 'ا')).toBe(true);
    expect(input.value).toBe('ا');
    input.remove();
  });
});
