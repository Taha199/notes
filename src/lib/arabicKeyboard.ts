/** Windows Arabic 101 — physical Latin key → Arabic (unshifted / shifted). */
export const ARABIC_KEY_MAP: Record<string, [string, string]> = {
  Backquote: ['ذ', 'ّ'],
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', ')'],
  Digit0: ['0', '('],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  KeyQ: ['ض', 'َ'],
  KeyW: ['ص', 'ً'],
  KeyE: ['ث', 'ُ'],
  KeyR: ['ق', 'ٌ'],
  KeyT: ['ف', 'لإ'],
  KeyY: ['غ', 'إ'],
  KeyU: ['ع', '‘'],
  KeyI: ['ه', '÷'],
  KeyO: ['خ', '×'],
  KeyP: ['ح', '؛'],
  BracketLeft: ['ج', '<'],
  BracketRight: ['د', '>'],
  Backslash: ['\\', '|'],
  KeyA: ['ش', ']'],
  KeyS: ['س', '['],
  KeyD: ['ي', 'ِ'],
  KeyF: ['ب', 'ٍ'],
  KeyG: ['ل', 'لأ'],
  KeyH: ['ا', 'أ'],
  KeyJ: ['ت', 'ـ'],
  KeyK: ['ن', '،'],
  KeyL: ['م', '/'],
  Semicolon: ['ك', ':'],
  Quote: ['ط', '"'],
  KeyZ: ['ئ', '~'],
  KeyX: ['ء', 'ْ'],
  KeyC: ['ؤ', '}'],
  KeyV: ['ر', '{'],
  KeyB: ['لا', 'لآ'],
  KeyN: ['ى', 'آ'],
  KeyM: ['ة', "'"],
  Comma: ['و', ','],
  Period: ['ز', '.'],
  Slash: ['ظ', '؟'],
};

export type ArabicKey = {
  code: string;
  normal: string;
  shift: string;
  wide?: 'space' | 'enter' | 'backspace' | 'shift';
  label?: string;
};

export const ARABIC_ROWS: ArabicKey[][] = [
  [
    { code: 'Backquote', normal: 'ذ', shift: 'ّ' },
    { code: 'Digit1', normal: '1', shift: '!' },
    { code: 'Digit2', normal: '2', shift: '@' },
    { code: 'Digit3', normal: '3', shift: '#' },
    { code: 'Digit4', normal: '4', shift: '$' },
    { code: 'Digit5', normal: '5', shift: '%' },
    { code: 'Digit6', normal: '6', shift: '^' },
    { code: 'Digit7', normal: '7', shift: '&' },
    { code: 'Digit8', normal: '8', shift: '*' },
    { code: 'Digit9', normal: '9', shift: ')' },
    { code: 'Digit0', normal: '0', shift: '(' },
    { code: 'Minus', normal: '-', shift: '_' },
    { code: 'Equal', normal: '=', shift: '+' },
    { code: 'Backspace', normal: '', shift: '', wide: 'backspace', label: '⌫' },
  ],
  [
    { code: 'KeyQ', normal: 'ض', shift: 'َ' },
    { code: 'KeyW', normal: 'ص', shift: 'ً' },
    { code: 'KeyE', normal: 'ث', shift: 'ُ' },
    { code: 'KeyR', normal: 'ق', shift: 'ٌ' },
    { code: 'KeyT', normal: 'ف', shift: 'لإ' },
    { code: 'KeyY', normal: 'غ', shift: 'إ' },
    { code: 'KeyU', normal: 'ع', shift: '‘' },
    { code: 'KeyI', normal: 'ه', shift: '÷' },
    { code: 'KeyO', normal: 'خ', shift: '×' },
    { code: 'KeyP', normal: 'ح', shift: '؛' },
    { code: 'BracketLeft', normal: 'ج', shift: '<' },
    { code: 'BracketRight', normal: 'د', shift: '>' },
  ],
  [
    { code: 'KeyA', normal: 'ش', shift: ']' },
    { code: 'KeyS', normal: 'س', shift: '[' },
    { code: 'KeyD', normal: 'ي', shift: 'ِ' },
    { code: 'KeyF', normal: 'ب', shift: 'ٍ' },
    { code: 'KeyG', normal: 'ل', shift: 'لأ' },
    { code: 'KeyH', normal: 'ا', shift: 'أ' },
    { code: 'KeyJ', normal: 'ت', shift: 'ـ' },
    { code: 'KeyK', normal: 'ن', shift: '،' },
    { code: 'KeyL', normal: 'م', shift: '/' },
    { code: 'Semicolon', normal: 'ك', shift: ':' },
    { code: 'Quote', normal: 'ط', shift: '"' },
    { code: 'Enter', normal: '\n', shift: '\n', wide: 'enter', label: '↵' },
  ],
  [
    { code: 'ShiftLeft', normal: '', shift: '', wide: 'shift', label: '⇧' },
    { code: 'KeyZ', normal: 'ئ', shift: '~' },
    { code: 'KeyX', normal: 'ء', shift: 'ْ' },
    { code: 'KeyC', normal: 'ؤ', shift: '}' },
    { code: 'KeyV', normal: 'ر', shift: '{' },
    { code: 'KeyB', normal: 'لا', shift: 'لآ' },
    { code: 'KeyN', normal: 'ى', shift: 'آ' },
    { code: 'KeyM', normal: 'ة', shift: "'" },
    { code: 'Comma', normal: 'و', shift: ',' },
    { code: 'Period', normal: 'ز', shift: '.' },
    { code: 'Slash', normal: 'ظ', shift: '؟' },
    { code: 'ShiftRight', normal: '', shift: '', wide: 'shift', label: '⇧' },
  ],
  [
    { code: 'Space', normal: ' ', shift: ' ', wide: 'space', label: 'مسافة' },
  ],
];

export function arabicFromCode(code: string, shifted: boolean): string | null {
  if (code === 'Space') return ' ';
  if (code === 'Enter') return '\n';
  const pair = ARABIC_KEY_MAP[code];
  if (!pair) return null;
  return shifted ? pair[1] : pair[0];
}

export function insertAtCursor(value: string, start: number, end: number, insert: string): {
  next: string;
  caret: number;
} {
  const next = `${value.slice(0, start)}${insert}${value.slice(end)}`;
  return { next, caret: start + insert.length };
}

const SKIP_REMAP_KEYS = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
]);

export function shouldRemapPhysicalKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (SKIP_REMAP_KEYS.has(e.key)) return false;
  return true;
}

const NON_TEXT_INPUT = new Set([
  'button', 'checkbox', 'radio', 'file', 'submit', 'reset', 'hidden', 'range', 'color',
]);

export function isEditableTarget(el: EventTarget | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && !NON_TEXT_INPUT.has(el.type);
  }
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  return el.isContentEditable;
}

function setTextFieldValue(el: HTMLInputElement | HTMLTextAreaElement, next: string, caret: number) {
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.setSelectionRange(caret, caret);
}

export function insertIntoEditable(el: HTMLElement, chunk: string): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (chunk === '\n' && el instanceof HTMLInputElement) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const { next, caret } = insertAtCursor(el.value, start, end, chunk);
    setTextFieldValue(el, next, caret);
    return true;
  }
  if (el.isContentEditable) {
    el.focus();
    return document.execCommand('insertText', false, chunk);
  }
  return false;
}

export function backspaceInEditable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    let next: string;
    let caret: number;
    if (start !== end) {
      ({ next, caret } = insertAtCursor(el.value, start, end, ''));
    } else if (start <= 0) {
      return false;
    } else {
      next = el.value.slice(0, start - 1) + el.value.slice(end);
      caret = start - 1;
    }
    setTextFieldValue(el, next, caret);
    return true;
  }
  if (el.isContentEditable) {
    el.focus();
    return document.execCommand('delete');
  }
  return false;
}
