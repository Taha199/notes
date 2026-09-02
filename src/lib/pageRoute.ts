import type { Page } from '../types';
import { SHOW_ADMIN_PANEL } from './firebase';

const PAGE_PATHS: Record<Page, string> = {
  home: '/',
  fav: '/favorites',
  todo: '/todo',
  unread: '/unread',
  read: '/read',
  library: '/library',
  files: '/files',
  arabicKb: '/arabic-keyboard',
  countdown: '/countdown',
  archive: '/archive',
  trash: '/trash',
  quiz: '/quiz',
  download: '/download',
  settings: '/settings',
  admin: '/admin',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as Page]),
) as Record<string, Page>;

export function pageFromPath(pathname: string): Page {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const page = PATH_TO_PAGE[normalized] ?? 'home';
  if (page === 'admin' && !SHOW_ADMIN_PANEL) return 'home';
  return page;
}

export function pathFromPage(page: Page): string {
  if (page === 'admin' && !SHOW_ADMIN_PANEL) return PAGE_PATHS.home;
  return PAGE_PATHS[page];
}
