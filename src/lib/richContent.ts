/** Plain text of an editor HTML fragment (tags stripped, &nbsp; normalized). */
export function extractPlainText(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/**
 * True when an editor HTML fragment holds meaningful content: text, an image,
 * or an embedded YouTube frame. Checking stripped text alone treats an
 * image-only note/question as empty, which silently blocked saving it (the
 * quiz page had this right; notes/drafts stripped `<img>` away before the
 * emptiness check).
 */
export function hasRichContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  if (/note-yt-frame/i.test(html)) return true;
  return extractPlainText(html).length > 0;
}
