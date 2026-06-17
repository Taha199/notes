export type Lang = 'en' | 'sv';

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
  lastEdited?: string;
}

export interface DraftContent {
  title: string;
  html: string;
}

export type Page = 'home' | 'fav' | 'unread' | 'read' | 'library' | 'files' | 'archive' | 'trash' | 'quiz';

export interface QuizItem {
  id: number;
  noteId: number;
  noteTitle: string;
  question: string;
  answer: string;
  date: string;
}
