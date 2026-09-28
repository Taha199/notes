/** Keep huge data-URI photos out of innerHTML read/write (Chrome truncates them). */

const TOKEN = (i: number) => `#tnimg-${i}`;
const TOKEN_ATTR_RE = /^#tnimg-(\d+)$/;
const SRC_DATA_ATTR_RE = /src=(["'])(data:image\/[\s\S]*?)\1/gi;

export function persistableImageSrc(img: HTMLImageElement): string {
  const attr = img.getAttribute('src') || '';
  if (attr.startsWith('data:image') && attr.length > 32) return attr;
  if (img.src.startsWith('data:image') && img.src.length > 32) return img.src;
  if (/^https?:/i.test(attr) || attr.startsWith('blob:')) return attr;
  return attr;
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

/** innerHTML with short tokens, then splice live img.src (data URLs) into the string. */
export function serializeHtmlPreservingImageSrcs(root: HTMLElement): string {
  const imgs = Array.from(root.querySelectorAll('img'));
  if (!imgs.length) return root.innerHTML;
  const srcs = imgs.map((img) => persistableImageSrc(img));
  imgs.forEach((img, i) => {
    img.setAttribute('src', TOKEN(i));
  });
  const slim = root.innerHTML;
  imgs.forEach((img, i) => {
    const src = srcs[i] || '';
    if (src) img.setAttribute('src', src);
    else img.removeAttribute('src');
  });
  return injectDataImageSrcs(slim, srcs);
}

/** Assign HTML, then set img.src from extracted data URLs so the setter cannot truncate. */
export function applyHtmlPreservingImageSrcs(el: HTMLElement, html: string): void {
  const { html: slim, srcs } = extractDataImageSrcs(html);
  el.innerHTML = slim;
  if (!srcs.length) return;
  el.querySelectorAll('img').forEach((node) => {
    if (!(node instanceof HTMLImageElement)) return;
    const attr = node.getAttribute('src') || '';
    const hit = attr.match(TOKEN_ATTR_RE);
    if (!hit) return;
    const src = srcs[Number(hit[1])];
    if (src) node.src = src;
  });
}
