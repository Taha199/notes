export type Lang = 'en' | 'sv';

export interface Note {
  id: number;
  title: string;
  html: string;
  text: string;
  fav: boolean;
  /** When true, the note stays at the top of lists until unpinned. */
  pinned?: boolean;
  /** ISO timestamp of when the note was pinned — newer pins sort first among pinned. */
  pinnedAt?: string;
  read: boolean;
  archived: boolean;
  trashed?: boolean;
  deletedAt?: string;
  date: string;
  lastEdited?: string;
  /** ISO timestamp — set on each save for reliable sort order. */
  savedAt?: string;
}

export interface DraftContent {
  title: string;
  html: string;
}

export type Page = 'home' | 'fav' | 'todo' | 'unread' | 'read' | 'library' | 'files' | 'arabicKb' | 'countdown' | 'archive' | 'trash' | 'quiz' | 'download' | 'settings' | 'admin';

export type NoteViewMode = 'grid' | 'expanded';

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
  // When this item is a copy living in the Favorites set, points at the original item's id.
  favOf?: number;
  // In-progress question being composed; kept in cloud even when empty.
  draft?: boolean;
}

export interface QuizSet {
  id: string;
  name: string;
  items: QuizItem[];
  createdAt: string;
  updatedAt?: string;
  /** Optional persist stamp used by merge LWW when updatedAt is missing. */
  savedAt?: string;
  /** Manual question order inside this set — must not steal membership authority from updatedAt. */
  orderUpdatedAt?: string;
  /**
   * Durable Manual item-id sequence. Survives IndexedDB / shell journal rows that
   * strip items[] HTML — merge re-applies this after durable bodies reattach.
   */
  itemsOrder?: number[];
  /**
   * Manual SET LIST order only (folder / ungrouped column).
   * Must stay separate from orderUpdatedAt — item drag/reorder used to bump that
   * stamp and let a stale quizSets[] array win Manual set positions on merge.
   */
  listOrderUpdatedAt?: string;
  color?: string;
  colorInitialized?: boolean;
  trashed?: boolean;
  deletedAt?: string;
  // OneNote-style notebook this set belongs to (unset = ungrouped).
  folderId?: string;
  // Non-deletable system set (e.g. the Favorites mirror set).
  system?: 'favorites';
  /** Topic headings shown immediately before a question in the set list. */
  sections?: QuizSection[];
  /** LWW stamp for section metadata sync. */
  sectionsUpdatedAt?: string;
}

export interface QuizSection {
  id: string;
  title: string;
  /** Render this heading immediately before the question with this id. */
  beforeItemId: number;
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
  updatedAt?: string;
  /** Manual folder-list order only. */
  orderUpdatedAt?: string;
  system?: 'restored' | 'favorites';
}

/** Calendar to-do item — dated task, independent of notes/quiz sync. */
export interface TodoItem {
  id: string;
  title: string;
  done: boolean;
  /** Local calendar day `YYYY-MM-DD`. */
  date: string;
  /** Optional local time `HH:mm`. */
  time?: string;
  createdAt: number;
  updatedAt: number;
}

export type CountdownRepeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type CountdownBackground = 'sunset' | 'ocean' | 'night' | 'minimal';

export interface CountdownFormat {
  years: boolean;
  months: boolean;
  weeks: boolean;
  days: boolean;
  hours: boolean;
  minutes: boolean;
  seconds: boolean;
}

export interface CountdownItem {
  id: string;
  title: string;
  /** ISO datetime for the target moment. */
  targetAt: string;
  repeat: CountdownRepeat;
  format: CountdownFormat;
  textShadow: boolean;
  background: CountdownBackground;
  createdAt: string;
  updatedAt: string;
}
