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
  deletedAt?: string;
  date: string;
  lastEdited?: string;
}

export interface DraftContent {
  title: string;
  html: string;
}

export type Page = 'home' | 'fav' | 'unread' | 'read' | 'library' | 'files' | 'archive' | 'trash' | 'quiz' | 'chat' | 'settings';

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
  // Multiple-choice support. When present, `options` holds the choices and
  // `correctIndex` points at the right one. Plain Q/A items leave these unset.
  options?: string[];
  correctIndex?: number;
  correctIndexes?: number[];
  explanation?: string;
  createdAt?: string;
  updatedAt?: string;
  trashed?: boolean;
  deletedAt?: string;
}

export interface QuizSet {
  id: string;
  name: string;
  items: QuizItem[];
  createdAt: string;
  color?: string;
  colorInitialized?: boolean;
  trashed?: boolean;
  deletedAt?: string;
  // OneNote-style notebook this set belongs to (unset = ungrouped).
  folderId?: string;
}

// A OneNote-style notebook/folder that groups quiz sets.
export interface QuizFolder {
  id: string;
  name: string;
  color?: string;
  colorInitialized?: boolean;
  trashed?: boolean;
  deletedAt?: string;
  createdAt: string;
  system?: 'restored';
}
