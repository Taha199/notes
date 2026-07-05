/** Mac installer tracked in Git LFS at public/downloads/ (see docs/desktop.md). */
export const MAC_DMG_FILENAME = 'Taha Note-1.0.0-arm64.dmg';
/** GitHub media CDN serves the LFS binary; Vercel static /downloads/ is only the pointer. */
export const MAC_DMG_URL =
  `https://media.githubusercontent.com/media/Taha199/notes/main/public/downloads/${encodeURIComponent(MAC_DMG_FILENAME)}`;
