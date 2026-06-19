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

export type Page = 'home' | 'fav' | 'unread' | 'read' | 'library' | 'files' | 'archive' | 'trash' | 'quiz' | 'chat';

export interface ChatAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  base64: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: string;
  attachment?: ChatAttachment;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

export interface QuizItem {
  id: number;
  noteId: number;
  noteTitle: string;
  question: string;
  answer: string;
  date: string;
}

export interface QuizSet {
  id: string;
  name: string;
  items: QuizItem[];
  createdAt: string;
  color?: string;
}
