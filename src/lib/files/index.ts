export type {
  StoredFile,
  FileFolder,
  PreviewMode,
  UploadProgressItem,
} from './fileTypes';

export {
  MAX_FILE_SIZE_BYTES,
  LIST_TIMEOUT_MS,
  UPLOAD_STUCK_MS,
  UPLOAD_TOTAL_MS,
  PROFILE_TIMEOUT_MS,
  FILES_FOLDER_KEY,
  FILE_INPUT_ID,
  safeStorageFileName,
  formatFileSize,
  previewModeFor,
  canPreviewFile,
  fileHref,
  isInlinePendingFile,
  withHydratedInline,
  lightFileMeta,
  normalizeList,
  firebaseErrorCode,
  isMissingStorageError,
  withTimeout,
} from './fileTypes';

export {
  storagePathFromDownloadUrl,
  candidateStoragePaths,
  resolveStoragePath,
  defaultStoragePath,
} from './filePaths';

export {
  fetchFilesList,
  migrateFilesBatch,
  fetchFilesListFromRtdb,
  fetchFullFileRecord,
  loadFilesWithFallback,
  runBackgroundMigration,
  saveFileMeta,
  saveFolderMeta,
  deleteFileMeta,
  deleteFolderMeta,
  deleteFileFully,
  fetchUserProfile,
} from './fileApi';

export {
  MAX_RTDB_FILE_SIZE,
  dataUrlToBlob,
  dataUrlToBlobWithProgress,
  uploadFileToStorage,
  migrateInlineFileToStorage,
  uploadErrorMessage,
} from './fileStorage';

export {
  fetchBlobWithProgress,
  loadFileBlob,
  triggerBlobDownload,
  openDownloadUrlNow,
  openOrNavigateToDownloadUrl,
  navigateToDownloadUrl,
  resolveFileDownloadUrl,
  downloadStoredFile,
  hydrateInlineFile,
  loadTextPreview,
  loadDocxHtml,
  loadPreviewBlobUrl,
  getCachedPreviewBlobUrl,
  revokePreviewBlobCache,
  preloadImageUrl,
  prefetchPreview,
  healMissingDownloadUrls,
} from './filePreview';
