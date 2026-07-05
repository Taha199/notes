import { SITE_URL } from './seo';

/** Hosted Mac installer — place the built .dmg at public/downloads/ when ready. */
export const MAC_DMG_FILENAME = 'Taha Note-1.0.0-arm64.dmg';
export const MAC_DMG_URL = `${SITE_URL}/downloads/${encodeURIComponent(MAC_DMG_FILENAME)}`;
