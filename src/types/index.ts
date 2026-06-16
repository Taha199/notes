export type Lang = 'ar' | 'en' | 'sv';

export interface Note {
  id: number;
  title: string;
  html: string;
  text: string;
  fav: boolean;
  read: boolean;
  archived: boolean;
  trashed?: boolean;
  date: string;
}

export interface DraftContent {
  title: string;
  html: string;
}

export type Page = 'home' | 'fav' | 'unread' | 'read' | 'library' | 'archive' | 'trash';
