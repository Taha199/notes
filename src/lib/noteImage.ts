export const NOTE_IMG_FRAME = 'note-img-frame';
export const NOTE_IMG_TOOLBAR = 'note-img-frame__toolbar';
export const NOTE_IMG_TOOLBAR_HOST = 'note-img-frame__toolbar-host';

/** Resolve a click/hover target to the enclosed note image, if any. */
export function resolveNoteImage(target: EventTarget | null): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target;
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest(`.${NOTE_IMG_TOOLBAR}`)) return null;
  const frame = target.closest(`.${NOTE_IMG_FRAME}`);
  if (!(frame instanceof HTMLElement)) return null;
  const img = frame.querySelector('img');
  return img instanceof HTMLImageElement ? img : null;
}

/** True when the target is inside an actively editable rich-text surface. */
export function isInsideEditableEditor(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('[contenteditable="true"]');
}
