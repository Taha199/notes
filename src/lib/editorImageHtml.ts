/** Keep huge data-URI photos out of innerHTML — Chrome truncates or absolutizes them. */

import { dataUrlToBlob } from './files/fileStorage';

const TOKEN = (i: number) => `data:image/tn,${i}`;
const TOKEN_RE = /^data:image\/tn,(\d+)$/;
const SRC_DATA_ATTR_RE = /src=(["'])(data:image\/(?!tn,)[\s\S]*?)\1/gi;

const registry = new Map<string, string>();
const blobToData = new Map<string, string>();
const elToData = new WeakMap<HTMLImageElement, string>();

export function registerInlineImage(dataUrl: string): { id: string; blobUrl: string } {
  const id = `tnimg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  registry.set(id, dataUrl);
  let blobUrl = dataUrl;
  try {
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      blobUrl = URL.createObjectURL(dataUrlToBlob(dataUrl));
    }
  } catch {
    blobUrl = dataUrl;
  }
  blobToData.set(blobUrl, dataUrl);
  return { id, blobUrl };
}

export function lookupInlineImage(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return registry.get(id);
}

export function bindInlineImageToElement(
  img: HTMLImageElement,
  dataUrl: string,
  mounted?: { id: string; blobUrl: string },
): { id: string; blobUrl: string } {
  const rec = mounted ?? registerInlineImage(dataUrl);
  blobToData.set(rec.blobUrl, dataUrl);
  elToData.set(img, dataUrl);
  img.setAttribute('data-tn-img', rec.id);
  img.src = rec.blobUrl;
  return rec;
}

export function persistableImageSrc(img: HTMLImageElement): string {
  const bound = elToData.get(img);
  if (bound) return bound;
  const fromReg = lookupInlineImage(img.getAttribute('data-tn-img'));
  if (fromReg) return fromReg;
  const attr = img.getAttribute('src') || '';
  const fromBlob = blobToData.get(attr) || blobToData.get(img.src);
  if (fromBlob) return fromBlob;
  if (attr.startsWith('data:image/') && !attr.startsWith('data:image/tn,') && attr.length > 32) {
    return attr;
  }
  if (img.src.startsWith('data:image/') && !img.src.startsWith('data:image/tn,') && img.src.length > 32) {
    return img.src;
  }
  if (/^https?:/i.test(attr) && !attr.includes('#tnimg-') && !attr.includes('data:image')) return attr;
  return '';
}

export function extractDataImageSrcs(html: string): { html: string; srcs: string[] } {
  const srcs: string[] = [];
  const next = html.replace(SRC_DATA_ATTR_RE, (_full, quote: string, data: string) => {
    const i = srcs.length;
    srcs.push(data);
    return `src=${quote}${TOKEN(i)}${quote}`;
  });
  return { html: next, srcs };
}

export function injectDataImageSrcs(html: string, srcs: string[]): string {
  let out = html;
  srcs.forEach((src, i) => {
    out = out.split(TOKEN(i)).join(src);
  });
  return out;
}

function restoreLiveImgSrc(img: HTMLImageElement, src: string) {
  if (src.startsWith('data:image/') && !src.startsWith('data:image/tn,')) {
    bindInlineImageToElement(img, src);
    return;
  }
  if (src) img.src = src;
  else img.removeAttribute('src');
}

/** innerHTML with short tokens, then splice registry/live data URLs into the string. */
export function serializeHtmlPreservingImageSrcs(root: HTMLElement): string {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return root.innerHTML;
  const originals = imgs.map((img) => ({
    persist: persistableImageSrc(img),
    attr: img.getAttribute('src'),
    id: img.getAttribute('data-tn-img'),
  }));
  imgs.forEach((img, i) => {
    img.setAttribute('src', TOKEN(i));
  });
  const slim = root.innerHTML;
  imgs.forEach((img, i) => {
    const orig = originals[i]!;
    if (orig.attr) img.setAttribute('src', orig.attr);
    else img.removeAttribute('src');
    if (orig.id) img.setAttribute('data-tn-img', orig.id);
  });
  return injectDataImageSrcs(slim, originals.map((row) => row.persist));
}

/** Assign HTML without putting data URLs through innerHTML; show via blob URLs. */
export function applyHtmlPreservingImageSrcs(el: HTMLElement, html: string): void {
  const { html: slim, srcs } = extractDataImageSrcs(html);
  el.innerHTML = slim;
  el.querySelectorAll('img').forEach((node) => {
    if (!(node instanceof HTMLImageElement)) return;
    const attr = node.getAttribute('src') || '';
    const hit = attr.match(TOKEN_RE);
    if (hit) {
      const src = srcs[Number(hit[1])] || '';
      restoreLiveImgSrc(node, src);
      return;
    }
    const live = persistableImageSrc(node);
    if (live.startsWith('data:image/')) restoreLiveImgSrc(node, live);
  });
}
