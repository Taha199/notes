/** Inline data-URI images are the main reason work PCs OOM (duplicate strings + blobs). */

const SRC_DATA_RE = /src=["']data:image\/[^"']+["']/gi;

export function htmlHasInlineImage(html: string | undefined | null): boolean {
  return !!html && html.includes('data:image');
}

/** Drop base64 <img src> so snapshots stay small. Storage URLs are kept. */
export function stripInlineDataImages(html: string): string {
  if (!htmlHasInlineImage(html)) return html;
  return html.replace(SRC_DATA_RE, 'src="" data-tn-stripped="1"');
}
