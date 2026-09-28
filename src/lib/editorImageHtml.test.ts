import { describe, expect, it } from 'vitest';
import {
  applyHtmlPreservingImageSrcs,
  extractDataImageSrcs,
  injectDataImageSrcs,
  persistableImageSrc,
  registerInlineImage,
  serializeHtmlPreservingImageSrcs,
} from './editorImageHtml';

const PHOTO = `data:image/png;base64,${'A'.repeat(4000)}`;

describe('editorImageHtml', () => {
  it('round-trips a long data-URI through token extract/inject', () => {
    const html = `<div class="note-img-frame"><img src="${PHOTO}"></div>`;
    const { html: slim, srcs } = extractDataImageSrcs(html);
    expect(slim).toContain('data:image/tn,0');
    expect(slim).not.toContain('base64,');
    expect(srcs[0]).toBe(PHOTO);
    expect(injectDataImageSrcs(slim, srcs)).toBe(html);
  });

  it('serializes from the image registry even when the live src is a blob URL', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="note-img-frame"><img alt=""></div>';
    const img = root.querySelector('img') as HTMLImageElement;
    const { id, blobUrl } = registerInlineImage(PHOTO);
    img.setAttribute('data-tn-img', id);
    img.src = blobUrl;
    const html = serializeHtmlPreservingImageSrcs(root);
    expect(html).toContain(PHOTO);
    expect(html).not.toContain('blob:');
    expect(persistableImageSrc(img)).toBe(PHOTO);
  });

  it('applies HTML so persistableImageSrc still returns the photo', () => {
    const el = document.createElement('div');
    applyHtmlPreservingImageSrcs(el, `<div class="note-img-frame"><img src="${PHOTO}"></div>`);
    const img = el.querySelector('img') as HTMLImageElement;
    expect(persistableImageSrc(img)).toBe(PHOTO);
  });
});
