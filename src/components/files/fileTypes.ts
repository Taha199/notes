export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: string;
  downloadUrl?: string;
  storagePath?: string;
  folderId?: string | null;
  dataUrl?: string;
  inlinePending?: boolean;
}

export interface FileFolder {
  id: string;
  name: string;
  createdAt: string;
}

export type PreviewMode = 'image' | 'pdf' | 'text' | 'unsupported';

export function safeStorageFileName(name: string): string {
  const cleaned = name
    .replace(/[/\\?#%[\]*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'file').slice(0, 180);
}

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function previewModeFor(file: StoredFile): PreviewMode {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html?)$/i.test(name)) return 'text';
  return 'unsupported';
}

export function canPreviewFile(file: StoredFile): boolean {
  return previewModeFor(file) !== 'unsupported';
}

/** Every file row must expose a direct download URL for instant <a href> clicks. */
export function fileDownloadUrl(file: StoredFile): string {
  return (file.downloadUrl || file.dataUrl || '').trim();
}

export function isChrome(): boolean {
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua) && !/OPR\//.test(ua);
}
