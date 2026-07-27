/** Longest side (px) inline note/quiz images are downscaled to before embedding. */
const MAX_DIMENSION = 1800;
/** Soft byte budget the JPEG quality ladder aims for. */
const TARGET_MAX_BYTES = 900 * 1024;
const MIN_JPEG_QUALITY = 0.5;

/**
 * Hard cap for embedding an image as inline base64 in note/quiz HTML.
 * Above this the caller must use the Storage-upload path (or refuse the
 * insert) — inline base64 this large is what used to blow past localStorage
 * quota and the Realtime Database's practical write size, silently dropping
 * saves.
 */
export const INLINE_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** GIF/SVG passthrough limit — bigger ones go through canvas / Storage-only. */
const PASSTHROUGH_MAX_BYTES = 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/** Approximate decoded byte size of a base64 data URL. */
export function dataUrlByteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.floor((base64.length * 3) / 4);
}

/** True when a data URL is small enough to embed inline as a fallback. */
export function canInlineImage(dataUrl: string): boolean {
  return dataUrlByteLength(dataUrl) <= INLINE_IMAGE_MAX_BYTES;
}

/**
 * Downscale + re-encode an editor image and return it as a data URL.
 *
 * The primary persistence path uploads this result to Firebase Storage and
 * embeds only the download URL; the data URL form doubles as the inline
 * fallback for signed-out users. Callers must check `canInlineImage` before
 * embedding the base64 form — oversized results must never be inlined (that is
 * what used to silently break saving image-heavy notes/questions).
 *
 * SVG passes through only when small. Large GIFs lose animation: their first
 * frame is re-encoded like any raster image rather than passing multi-MB
 * originals through.
 */
export async function compressImageForInline(file: File): Promise<string> {
  // Vector images don't benefit from canvas re-encoding; small GIFs keep
  // their animation. Large ones fall through to the canvas path below.
  if (file.type === 'image/svg+xml' || (file.type === 'image/gif' && file.size <= PASSTHROUGH_MAX_BYTES)) {
    return readFileAsDataUrl(file);
  }
  try {
    const img = await loadImageFromFile(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return await readFileAsDataUrl(file);

    const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
    const targetW = Math.max(1, Math.round(w * scale));
    const targetH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return await readFileAsDataUrl(file);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const preferPng = file.type === 'image/png';
    let mime = preferPng ? 'image/png' : 'image/jpeg';
    let quality = 0.85;
    let out = canvas.toDataURL(mime, quality);

    // PNG screenshots of photos/scans can still be huge — fall back to JPEG if so.
    if (mime === 'image/png' && dataUrlByteLength(out) > TARGET_MAX_BYTES) {
      mime = 'image/jpeg';
      out = canvas.toDataURL(mime, quality);
    }

    while (mime === 'image/jpeg' && dataUrlByteLength(out) > TARGET_MAX_BYTES && quality > MIN_JPEG_QUALITY) {
      quality -= 0.1;
      out = canvas.toDataURL(mime, quality);
    }

    const original = await readFileAsDataUrl(file);
    // Prefer the smaller encoding — but NEVER return a multi-MB original when
    // we have a usable canvas result: callers used to refuse insert entirely
    // when canInlineImage(original) failed, so images "never loaded".
    if (dataUrlByteLength(out) <= dataUrlByteLength(original)) return out;
    if (dataUrlByteLength(original) <= INLINE_IMAGE_MAX_BYTES) return original;
    // Original is huge; force a more aggressive JPEG so insert always has something.
    mime = 'image/jpeg';
    quality = MIN_JPEG_QUALITY;
    out = canvas.toDataURL(mime, quality);
    while (dataUrlByteLength(out) > INLINE_IMAGE_MAX_BYTES && quality > 0.3) {
      quality -= 0.05;
      out = canvas.toDataURL(mime, quality);
    }
    return out;
  } catch {
    return readFileAsDataUrl(file);
  }
}
