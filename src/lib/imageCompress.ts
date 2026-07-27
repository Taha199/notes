/** Longest side (px) inline note/quiz images are downscaled to before embedding. */
const MAX_DIMENSION = 1800;
/** Soft byte budget for the resulting base64 data URL. */
const TARGET_MAX_BYTES = 1.5 * 1024 * 1024;
const MIN_JPEG_QUALITY = 0.5;

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
function dataUrlByteLength(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Downscale + re-encode images before they're embedded as base64 in note/quiz HTML.
 * Uncompressed phone photos and document scans can be several MB each, which — once
 * inlined directly into `<img src="data:...">` — blows past the browser's localStorage
 * quota and Firebase Realtime Database's practical write size as they pile up across
 * many notes/questions. That silently drops the save (it succeeds in memory for the
 * current tab but never survives a reload) with no visible error.
 *
 * Falls back to the original file's raw data URL if anything goes wrong (unsupported
 * type, decode failure, canvas unavailable, or the "compressed" output isn't actually
 * smaller), so behavior never regresses for edge cases.
 */
export async function compressImageForInline(file: File): Promise<string> {
  // Vector/animated formats don't benefit from canvas re-encoding — keep as-is.
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
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
    return dataUrlByteLength(out) < dataUrlByteLength(original) ? out : original;
  } catch {
    return readFileAsDataUrl(file);
  }
}
