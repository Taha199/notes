import type { Page } from '../types';

const PAGE_PATHS: Record<Page, string> = {
  home: '/',
  fav: '/favorites',
  unread: '/unread',
  read: '/read',
  library: '/library',
  files: '/files',
  archive: '/archive',
  trash: '/trash',
  quiz: '/quiz',
  chat: '/chat',
  settings: '/settings',
  admin: '/admin',
};

const PATH_TO_PAGE = Object.fromEntries(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as Page]),
) as Record<string, Page>;

export function pageFromPath(pathname: string): Page {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return PATH_TO_PAGE[normalized] ?? 'home';
}

export function pathFromPage(page: Page): string {
  return PAGE_PATHS[page];
}
