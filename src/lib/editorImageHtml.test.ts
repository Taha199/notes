import { describe, expect, it } from 'vitest';
import {
  applyHtmlPreservingImageSrcs,
  extractDataImageSrcs,
  injectDataImageSrcs,
  persistableImageSrc,
  serializeHtmlPreservingImageSrcs,
} from './editorImageHtml';

const PHOTO = `data:image/png;base64,${'A'.repeat(4000)}`;

describe('editorImageHtml', () => {
  it('round-trips a long data-URI through token extract/inject', () => {
    const html = `<div class="note-img-frame"><img src="${PHOTO}"></div>`;
    const { html: slim, srcs } = extractDataImageSrcs(html);
    expect(slim.includes('data:image')).toBe(false);
    expect(slim).toContain('#tnimg-0');
    expect(srcs[0]).toBe(PHOTO);
    expect(injectDataImageSrcs(slim, srcs)).toBe(html);
  });

  it('serializes from the live img.src property, not truncated innerHTML', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="note-img-frame"><img alt=""></div>';
    const img = root.querySelector('img') as HTMLImageElement;
    img.src = PHOTO;
    const html = serializeHtmlPreservingImageSrcs(root);
    expect(html).toContain(PHOTO);
    expect(img.getAttribute('src')?.startsWith('data:image')).toBe(true);
  });

  it('applies HTML by setting img.src after a short innerHTML write', () => {
    const el = document.createElement('div');
    applyHtmlPreservingImageSrcs(el, `<div class="note-img-frame"><img src="${PHOTO}"></div>`);
    const img = el.querySelector('img') as HTMLImageElement;
    expect(persistableImageSrc(img)).toBe(PHOTO);
  });
});
