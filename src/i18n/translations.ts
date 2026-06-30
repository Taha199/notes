import type { Lang } from '../types';

export interface Translation {
  dir: 'rtl' | 'ltr';
  htmlLang: string;
  label: string;
  appName: string;
  appSubtitle: string;
  navHome: string;
  navFav: string;
  navUnread: string;
  navRead: string;
  navLibrary: string;
  navFiles: string;
  navArchive: string;
  navTrash: string;
  searchPh: string;
  newNote: string;
  locked: string;
  editing: string;
  mDel: string;
  mUnarch: string;
  mDone: string;
  mUndone: string;
  tUnstudied: string;
  mArchive: string;
  mSave: string;
  mCopy: string;
  mGenQuiz: string;
  mAddQ: string;
  mTiPh: string;
  archPill: string;
  userName: string;
  userSub: string;
  draft: string;
  draftTiPh: string;
  draftEdPh: string;
  saveDraft: string;
  cloudSaving: string;
  cloudSaved: string;
  cloudSavedMain: string;
  pageHome: string;
  pageLib: string;
  pageUnread: string;
  pageRead: string;
  pageFav: string;
  pageArch: string;
  pageFiles: string;
  pageTrash: string;
  statActive: string;
  statUnread: string;
  statFav: string;
  secAll: string;
  secUnread: string;
  secFav: string;
  secFavArch: string;
  secRead: string;
  secArch: string;
  tagFav: string;
  tagRead: string;
  tagUnread: string;
  tagArch: string;
  emptyNotes: string;
  emptySearch: string;
  emptyTrash: string;
  filesTitle: string;
  filesSub: string;
  filesSizeLimit: string;
  filesUpload: string;
  filesEmpty: string;
  filesDownload: string;
  filesPreview: string;
  filesRename: string;
  filesRenameSuccess: string;
  filesPreviewUnavailable: string;
  filesDelete: string;
  filesStored: string;
  filesTooLarge: string;
  filesSaveFailed: string;
  filesUploadFailed: string;
  filesUploadSuccess: string;
  filesQuotaExceeded: string;
  selDel: string;
  cancelSel: string;
  emptyTrashBtn: string;
  delSelected: string;
  titleBold: string;
  titleItalic: string;
  titleUnline: string;
  titleStrike: string;
  titleInsertDateHeader: string;
  titleRight: string;
  titleLeft: string;
  titleClr: string;
  titleColor: string;
  titleUnarch: string;
  titleDone: string;
  titleUnread: string;
  titleArch: string;
  titleDel: string;
  titleRestore: string;
  titlePermDel: string;
  titleFavAdd: string;
  titleFavRem: string;
  tAddNote: string;
  tMoved: string;
  tArched: string;
  tRestored: string;
  tFavAdd: string;
  tFavRem: string;
  tRead: string;
  tUnread: string;
  tSaved: string;
  tTrashEmpty: string;
  tDelSel: string;
  tRestored2: string;
  tPermDel: string;
  tCantEmpty: string;
  tStudied: string;
  tUnarch: string;
  cEmptyTrash: string;
  cDelSel: string;
  cPermDel: string;
  dateLocale: string;
  signOut: string;
  setPassLbl: string;
  setpassTitle: string;
  setpassSub: string;
  setpassPassPh: string;
  setpassPass2Ph: string;
  setpassBtn: string;
  setpassCancel: string;
  setpassErrShort: string;
  setpassErrMatch: string;
  setpassOk: string;
  setpassErrRelogin: string;
  setpassErrGeneric: string;
  resetpassTitle: string;
  resetpassEyebrow: string;
  resetpassSubtitle: string;
  resetpassFor: string;
  resetpassOk: string;
  resetpassSuccessTitle: string;
  resetpassSuccessSub: string;
  resetpassErrInvalid: string;
  resetpassErrExpired: string;
  resetpassChecking: string;
  resetpassNewLabel: string;
  resetpassConfirmLabel: string;
  resetpassHint: string;
  resetpassShow: string;
  resetpassHide: string;
  resetpassSaving: string;
  resetpassBack: string;
  resetpassRequestNew: string;
  // Auth page
  authLogin: string;
  authSignup: string;
  authLoginBtn: string;
  authSignupBtn: string;
  authForgot: string;
  authEmailPh: string;
  authPassPh: string;
  authPass2Ph: string;
  authGoogle: string;
  authOr: string;
  authErrRequired: string;
  authErrNotFound: string;
  authErrWrongPass: string;
  authErrInUse: string;
  authErrInvalidEmail: string;
  authErrTooMany: string;
  authErrInvalidCred: string;
  authErrGoogle: string;
  authErrNeedEmail: string;
  authResetSent: string;
  authErrSendFail: string;
  authErrEmailConfig: string;
  authErrRateLimited: string;
  featNotesTitle: string;
  featNotesSub: string;
  featCloudTitle: string;
  featCloudSub: string;
  featSecureTitle: string;
  featSecureSub: string;
  featQuizTitle: string;
  featQuizSub: string;
  featAiTitle: string;
  featAiSub: string;
  marketingTitle: string;
  marketingDesc: string;
  designedBy: string;
  // Settings page
  settingsTitle: string;
  adminTitle: string;
  settingsProfile: string;
  settingsProfileName: string;
  settingsProfileEmail: string;
  settingsProfilePhotoUpload: string;
  settingsProfilePhotoChange: string;
  settingsProfilePhotoUploading: string;
  settingsProfilePhotoError: string;
  settingsProfilePhotoInvalidType: string;
  settingsSave: string;
  settingsSaved: string;
  settingsPassword: string;
  settingsPasswordSet: string;
  settingsNoPassword: string;
  settingsNoPasswordSub: string;
  settingsCreatePassword: string;
  settingsChangePass: string;
  settingsSetPass: string;
  settingsPassEmailSent: string;
  settingsStorage: string;
  settingsStorageNotes: string;
  settingsStorageQuiz: string;
  settingsStorageChat: string;
  settingsStorageFiles: string;
  settingsStorageTotal: string;
  settingsStorageLimit: string;
  settingsFolderBackup: string;
  settingsFolderBackupEmpty: string;
  settingsFolderBackupLast: string;
  settingsFolderBackupRestore: string;
  settingsFolderBackupRestored: string;
  // Danger zone
  settingsDanger: string;
  settingsDeleteAccount: string;
  settingsDeleteConfirmTitle: string;
  settingsDeleteConfirmSub: string;
  settingsDeleteConfirmBtn: string;
  settingsDeleting: string;
  otterSearchTitle: string;
  otterSearchPlaceholder: string;
  otterSearchGo: string;
  otterSearchToggle: string;
  otterSearchClose: string;
  otterSearchExternal: string;
  otterSearchPopupBlocked: string;
  otterSearchPopupRetry: string;
  otterSearchPopupDocked: string;
  otterSearchPopupLoading: string;
  settingsPlan: string;
  settingsPlanFree: string;
  settingsPlanPlus: string;
  settingsPlanFreeSub: string;
  plusTitle: string;
  plusSub: string;
  plusFeatureStorage: string;
  plusFeatureAi: string;
  plusAiLocked: string;
  // Email verification
  verifyTitle: string;
  verifySub: string;
  verifyResend: string;
  verifyResent: string;
  verifySendFail: string;
  verifyDone: string;
  verifyCheck: string;
  verifyCancel: string;
  // Quiz
  quizQuestionLabel: string;
  quizAnswerLabel: string;
  quizStudyMore: string;
  quizRevealAnswer: string;
  quizExplanationLabel: string;
  quizMarkKnown: string;
  quizMarkNotKnown: string;
  quizFavorite: string;
  quizStopSpeak: string;
  quizSpeak: string;
  quizEdit: string;
  quizMoveToSet: string;
  quizMoveToSetTitle: string;
  quizNoSetsInFolder: string;
  quizSetsWord: string;
  quizItemsShort: string;
  quizDelete: string;
  quizCreated: string;
  quizUpdated: string;
  quizReorderHint: string;
  quizReorderAria: string;
  quizShowSidebar: string;
  quizHideSidebar: string;
  quizTitle: string;
  quizQuestionsFromNotes: string;
  quizQuestionOne: string;
  quizQuestionMany: string;
  quizKnownProgress: string;
  quizHideAnswers: string;
  quizShowAnswers: string;
  quizHideAnswersShort: string;
  quizShowAnswersShort: string;
  quizSortQuestions: string;
  quizFlashcards: string;
  quizDownloadPdf: string;
  quizPdfGeneratedOn: string;
  quizTypeAnswer: string;
  quizAdd: string;
  quizAddQuestion: string;
  quizSetsLabel: string;
  quizSortManualShort: string;
  quizSortManual: string;
  quizSortName: string;
  quizSortCount: string;
  quizSortAz: string;
  quizSortHash: string;
  quizFolderEmpty: string;
  quizNoUngroupedSets: string;
  quizFolder: string;
  quizAddSet: string;
  quizAddFolder: string;
  quizRename: string;
  quizColor: string;
  quizMoveToFolder: string;
  quizNoFoldersYet: string;
  quizDeleteSet: string;
  quizDeleteFolder: string;
  quizFavorites: string;
  quizRestored: string;
  quizOptions: string;
  quizNoFolders: string;
  quizResizeFoldersHint: string;
  quizNamelessSet: string;
  quizNewFolder: string;
  quizEmptySetMsg: string;
  quizEmptyFolderMsg: string;
  quizEmptySetTitle: string;
  quizEditQaBadge: string;
  quizEditMcqBadge: string;
  quizAiAnswer: string;
  quizAiSuggestion: string;
  quizKeepCurrent: string;
  quizReplaceAnswer: string;
  quizMcq: string;
  quizOptionsLabel: string;
  quizAddOption: string;
  quizCorrect: string;
  quizOptionPh: string;
  quizExplanationOptional: string;
  quizExplanationPh: string;
  quizColorDefault: string;
  quizColorPurple: string;
  quizColorBlue: string;
  quizColorGreen: string;
  quizColorYellow: string;
  quizColorRed: string;
  quizColorPink: string;
  quizColorCyan: string;
  quizSortManualFull: string;
  quizSortOldest: string;
  quizSortStudy: string;
  quizSortDateShort: string;
  quizSortStudyShort: string;
  quizStudyAllDone: string;
  quizStudyRoundComplete: string;
  quizStudyPercentCorrect: string;
  quizStudyKnownCount: string;
  quizStudyLearningCount: string;
  quizStudyMoreBtn: string;
  quizStudyClose: string;
  quizStudyPrevious: string;
  quizStudyNext: string;
  quizStudySkip: string;
  quizStudyNextArrow: string;
  quizStudyTapToReveal: string;
  quizStudyFlipCard: string;
  quizStudyFlipBack: string;
  quizStudyNoAnswer: string;
  quizStudyDontKnow: string;
  quizStudyKnowIt: string;
  quizStudyTypeAnswerPh: string;
  quizStudyCheckAnswer: string;
  quizStudyYourAnswer: string;
  quizStudyCorrectAnswer: string;
  quizStudyIncorrect: string;
  quizStudyCorrect: string;
  quizStudyRemaining: string;
  quizStudyChooseQuestions: string;
  quizStudyPick: string;
  quizStudyWhatToStudy: string;
  quizStudyScopeAll: string;
  quizStudyScopeNew: string;
  quizStudyScopeLearning: string;
  quizStudyScopeKnown: string;
  quizMoveFolderTrash: string;
  quizMoveSetTrash: string;
  quizMoveToTrash: string;
  quizDupFolderName: string;
  quizDupSetName: string;
  quizFolderInTrash: string;
  quizMissingFoldersRestored: string;
  quizNoMoreFoldersFound: string;
  quizSearchMissingFolders: string;
  quizMoveFolderTrashMsg: string;
  quizMoveSetTrashMsg: string;
  quizSetsCount: string;
  quizRestoredSets: string;
  noteCreateQuestion: string;
  noteClose: string;
  notePaste: string;
  noteWriteQuestionPh: string;
  noteWriteAnswerPh: string;
  noteGenerateAnswerPh: string;
  noteMcqCorrectHint: string;
  noteSaveQuestion: string;
  noteSavedQuiz: string;
  noteQuizSavedCount: string;
  noteAiQuestion: string;
  noteShowAnswer: string;
  noteGenerateQuestion: string;
  noteGenerateQuestionPh: string;
  noteGenerateMore: string;
  noteGenerating: string;
  noteEditBtn: string;
  noteDone: string;
  noteSkip: string;
  noteFinish: string;
  noteSaveNext: string;
  noteQuizPanel: string;
  noteWriteQuestionEditPh: string;
  noteCreatedLabel: string;
  noteUpdatedLabel: string;
  noteLastSaved: string;
}

export const LANGS: Record<Lang, Translation> = {
  en: {
    dir: 'ltr', htmlLang: 'en', label: 'EN',
    appName: 'Taha Note', appSubtitle: 'Write, organize, and sync your notes everywhere.',
    navHome: 'Home', navFav: 'Favourites', navUnread: 'Notes to Study', navRead: 'Studied Notes',
    navLibrary: 'Notes Library', navFiles: 'File Uploads', navArchive: 'Archive', navTrash: 'Trash',
    searchPh: 'Search...', newNote: 'New Note', locked: 'Locked', editing: 'Editing',
    mDel: 'Delete', mUnarch: 'Unarchive', mDone: 'Mark as Studied', mUndone: 'Mark as Unstudied', mArchive: 'Archive', mSave: 'Save', mCopy: 'Copy', mGenQuiz: 'Generate Quiz', mAddQ: 'Add Question', mTiPh: 'Title (optional)',
    archPill: 'Read & Archived', userName: 'User', userSub: 'My Personal Notes',
    draft: 'Draft', draftTiPh: 'Title (optional)', draftEdPh: 'Write your note here...', saveDraft: 'Save Note',
    cloudSaving: 'Saving...', cloudSaved: 'Saved', cloudSavedMain: 'Saved to cloud',
    pageHome: 'Home', pageLib: 'Notes Library', pageUnread: 'Notes to Study', pageRead: 'Studied Notes',
    pageFav: 'Favourites', pageArch: 'Archive', pageFiles: 'File Uploads', pageTrash: 'Trash',
    statActive: 'Active Notes', statUnread: 'Unread', statFav: 'Favourites',
    secAll: 'All Notes', secUnread: 'Unread', secFav: 'Favourites', secFavArch: 'Archived Favourites',
    secRead: 'Read', secArch: 'Archive',
    tagFav: '⭐ Favourite', tagRead: '✓ Read', tagUnread: '📖 Unread', tagArch: '🗄 Archived',
    emptyNotes: 'No notes here', emptySearch: 'No results', emptyTrash: 'Trash is empty',
    filesTitle: 'Upload files', filesSub: 'Files are saved securely in your cloud account.', filesSizeLimit: 'Maximum file size: 20 MB per file.', filesUpload: 'Choose files',
    filesEmpty: 'No files uploaded yet', filesDownload: 'Download', filesPreview: 'Preview', filesRename: 'Rename', filesRenameSuccess: 'File renamed', filesPreviewUnavailable: 'Preview is not available for this file type.', filesDelete: 'Delete', filesStored: 'Saved in cloud',
    filesTooLarge: 'File too large (max 20 MB):', filesSaveFailed: 'Could not save file to cloud.', filesUploadFailed: 'Upload failed. Please try again.', filesUploadSuccess: 'File uploaded', filesQuotaExceeded: 'Storage limit reached. Delete files or contact support for more space.',
    selDel: '☑ Select to Delete', cancelSel: '✕ Cancel', emptyTrashBtn: 'Empty Trash', delSelected: 'Delete Selected',
    titleBold: 'Bold', titleItalic: 'Italic', titleUnline: 'Underline', titleStrike: 'Strikethrough', titleInsertDateHeader: "Insert today's date as header",
    titleRight: 'Align Right', titleLeft: 'Align Left', titleClr: 'Clear Formatting', titleColor: 'Text Color',
    titleUnarch: 'Unarchive', titleDone: 'Mark as Read', titleUnread: 'Move to Unread', titleArch: 'Archive',
    titleDel: 'Delete', titleRestore: 'Restore', titlePermDel: 'Delete Permanently', titleFavAdd: 'Add to Favourites', titleFavRem: 'Remove from Favourites',
    tAddNote: 'Note added', tMoved: 'Moved to trash', tArched: 'Moved to archive', tRestored: 'Restored to active',
    tFavAdd: 'Added to favourites ★', tFavRem: 'Removed from favourites', tRead: 'Marked as read ✓', tUnread: 'Moved back to unread',
    tSaved: 'Changes saved', tTrashEmpty: 'Trash emptied', tDelSel: 'Deleted', tRestored2: 'Restored',
    tPermDel: 'Permanently deleted', tCantEmpty: 'Text cannot be empty', tStudied: 'Marked as read & archived ✓', tUnstudied: 'Marked as unstudied ↩',
    tUnarch: 'Restored to active notes',
    cEmptyTrash: 'Permanently delete all notes in trash?', cDelSel: 'Permanently delete selected notes?', cPermDel: 'Permanently delete? This cannot be undone.',
    dateLocale: 'en-GB', signOut: 'Sign Out',
    setPassLbl: 'Set Password', setpassTitle: 'Set Password',
    setpassSub: 'You can create a password to also sign in with email, in addition to Google sign-in.',
    setpassPassPh: 'New password', setpassPass2Ph: 'Confirm password', setpassBtn: 'Save Password', setpassCancel: 'Cancel',
    setpassErrShort: 'Password must be at least 6 characters', setpassErrMatch: 'Passwords do not match',
    setpassOk: '✓ Password created successfully', setpassErrRelogin: 'Please sign out and sign in again, then retry',
    setpassErrGeneric: 'Something went wrong, please try again',
    resetpassTitle: 'Create a new password', resetpassEyebrow: 'SECURE ACCOUNT',
    resetpassSubtitle: 'Choose a strong password that you have not used before.', resetpassFor: 'Resetting the password for',
    resetpassOk: 'Password changed successfully', resetpassSuccessTitle: 'Your password is ready',
    resetpassSuccessSub: 'You can now sign in to Taha Note using your new password.',
    resetpassErrInvalid: 'This reset link is invalid or has expired.',
    resetpassErrExpired: 'Could not reset the password. Please request a new link.',
    resetpassChecking: 'Checking your secure link...', resetpassNewLabel: 'New password',
    resetpassConfirmLabel: 'Confirm new password', resetpassHint: 'Use at least 6 characters.',
    resetpassShow: 'Show', resetpassHide: 'Hide', resetpassSaving: 'Updating password...',
    resetpassBack: 'Back to sign in', resetpassRequestNew: 'Request a new link',
    authLogin: 'Sign In', authSignup: 'Create Account', authLoginBtn: 'Sign In', authSignupBtn: 'Create Account',
    authForgot: 'Forgot password?', authEmailPh: 'Email address', authPassPh: 'Password', authPass2Ph: 'Confirm password',
    authGoogle: 'Continue with Google', authOr: 'or',
    authErrRequired: 'Please enter your email and password', authErrNotFound: 'Email is not registered',
    authErrWrongPass: 'Incorrect password', authErrInUse: 'Email is already in use',
    authErrInvalidEmail: 'Invalid email format', authErrTooMany: 'Too many attempts, try again later',
    authErrInvalidCred: 'Incorrect email or password', authErrGoogle: 'An error occurred during Google sign-in',
    authErrNeedEmail: 'Enter your email first', authResetSent: '✓ Password reset link sent',
    authErrSendFail: 'Could not send email, check the address',
    authErrEmailConfig: 'Email service is not configured. Contact support.',
    authErrRateLimited: 'Please wait a minute before requesting another email.',
    featNotesTitle: '📝 Quick Notes', featNotesSub: 'Save ideas in seconds',
    featCloudTitle: '☁️ Cloud Sync', featCloudSub: 'Access your notes everywhere',
    featSecureTitle: '🔒 Secure Storage', featSecureSub: 'Your data is protected and backed up',
    featQuizTitle: '🧠 Smart Quiz', featQuizSub: 'Turn notes into flashcards and study smarter',
    featAiTitle: '✨ AI Assistant', featAiSub: 'Generate questions and answers automatically',
    marketingTitle: 'Your notes, everywhere.', marketingDesc: 'A modern place to write, organize, and sync everything you need.',
    designedBy: '✦ Designed by Dr. Abdullah Taha ✦',
    settingsTitle: 'Settings',
    adminTitle: 'User Panel',
    settingsProfile: 'Profile',
    settingsProfileName: 'Display name',
    settingsProfileEmail: 'Email address',
    settingsProfilePhotoUpload: 'Upload profile photo',
    settingsProfilePhotoChange: 'Change photo',
    settingsProfilePhotoUploading: 'Uploading…',
    settingsProfilePhotoError: 'Could not upload photo. Try again.',
    settingsProfilePhotoInvalidType: 'Use JPG, PNG, or WebP.',
    settingsSave: 'Save',
    settingsSaved: '✓ Saved',
    settingsPassword: 'Password',
    settingsPasswordSet: 'Password is set',
    settingsNoPassword: 'No password set',
    settingsNoPasswordSub: 'Account uses Google sign-in only',
    settingsCreatePassword: 'Create a password',
    settingsChangePass: 'Send password reset email',
    settingsSetPass: 'Set a password',
    settingsPassEmailSent: '✓ Reset email sent',
    settingsStorage: 'Storage',
    settingsStorageNotes: 'Notes',
    settingsStorageQuiz: 'Quiz',
    settingsStorageChat: 'AI Chat',
    settingsStorageFiles: 'Files',
    settingsStorageTotal: 'Total used',
    settingsStorageLimit: 'Storage limit',
    settingsFolderBackup: 'Quiz folder backups',
    settingsFolderBackupEmpty: 'No backups yet. Backups are saved automatically from now on whenever folders change.',
    settingsFolderBackupLast: 'Last backup',
    settingsFolderBackupRestore: 'Restore',
    settingsFolderBackupRestored: 'Folders restored from backup',
    settingsDanger: 'Danger Zone',
    settingsDeleteAccount: 'Delete Account',
    settingsDeleteConfirmTitle: 'Delete your account?',
    settingsDeleteConfirmSub: 'This will permanently delete all your notes, quizzes, chats, and account data. This action cannot be undone.',
    settingsDeleteConfirmBtn: 'Yes, delete everything',
    settingsDeleting: 'Deleting...',
    otterSearchTitle: 'Search',
    otterSearchPlaceholder: 'Search Google…',
    otterSearchGo: 'Search',
    otterSearchToggle: 'Open Google in new tab',
    otterSearchClose: 'Close search panel',
    otterSearchExternal: 'Open in new tab',
    otterSearchPopupBlocked:
      'Your browser blocked the Google panel. Allow popups for tahanote.com, or use the button below.',
    otterSearchPopupRetry: 'Open Google',
    otterSearchPopupDocked: 'Google is open in the panel beside the site — use your normal browser session.',
    otterSearchPopupLoading: 'Opening Google…',
    settingsPlan: 'Plan',
    settingsPlanFree: 'Free',
    settingsPlanPlus: 'Taha Note Plus',
    settingsPlanFreeSub: '100 MB storage · no AI features',
    plusTitle: 'Taha Note Plus',
    plusSub: 'Upgrade to Plus for more storage and full AI access.',
    plusFeatureStorage: '✓ 1000 MB cloud storage',
    plusFeatureAi: '✓ AI Chat, AI answers, and AI quiz generation',
    plusAiLocked: 'AI features are available with Taha Note Plus. Contact the admin to upgrade.',
    verifyTitle: 'Verify your email',
    verifySub: 'We sent a verification link to',
    verifyResend: 'Resend email',
    verifyResent: '✓ Email sent',
    verifySendFail: 'Could not send email. Try again in a moment.',
    verifyDone: 'I have verified',
    verifyCheck: 'Checking...',
    verifyCancel: 'Cancel registration & delete account',
    quizQuestionLabel: 'Question',
    quizAnswerLabel: 'Answer',
    quizStudyMore: '📚 Study more',
    quizRevealAnswer: '👁️ Show',
    quizExplanationLabel: 'Explanation',
    quizMarkKnown: 'Mark as studied (known)',
    quizMarkNotKnown: 'Mark as not known (study more)',
    quizFavorite: 'Favourite',
    quizStopSpeak: 'Stop',
    quizSpeak: 'Read aloud',
    quizEdit: 'Edit',
    quizMoveToSet: 'Move to set',
    quizMoveToSetTitle: 'Move to set',
    quizNoSetsInFolder: 'No sets in this folder',
    quizSetsWord: 'sets',
    quizItemsShort: 'items',
    quizDelete: 'Delete',
    quizCreated: 'Created:',
    quizUpdated: 'Updated:',
    quizReorderHint: 'Enter a number and press Enter — swaps with that position',
    quizReorderAria: 'Swap with number',
    quizShowSidebar: 'Show list',
    quizHideSidebar: 'Hide list',
    quizTitle: 'Quiz',
    quizQuestionsFromNotes: 'Questions from Notes',
    quizQuestionOne: 'question',
    quizQuestionMany: 'questions',
    quizKnownProgress: 'known',
    quizHideAnswers: 'Hide answers',
    quizShowAnswers: 'Show answers',
    quizHideAnswersShort: 'Hide',
    quizShowAnswersShort: 'Show',
    quizSortQuestions: 'Sort questions',
    quizFlashcards: '🃏 Flashcards',
    quizDownloadPdf: '📄 Download PDF',
    quizPdfGeneratedOn: 'Generated on',
    quizTypeAnswer: '✏️ Type',
    quizAdd: 'Add',
    quizAddQuestion: 'Add Question',
    quizSetsLabel: 'Sets',
    quizSortManualShort: 'Manual',
    quizSortManual: '✋ Manual order',
    quizSortName: '🔤 Name (A–Z)',
    quizSortCount: '🔢 Question count',
    quizSortAz: 'A–Z',
    quizSortHash: '#',
    quizFolderEmpty: 'Empty',
    quizNoUngroupedSets: 'No ungrouped sets',
    quizFolder: 'Folder',
    quizAddSet: 'Add set',
    quizAddFolder: 'Add folder',
    quizRename: '✏️ Rename',
    quizColor: '🎨 Colour',
    quizMoveToFolder: '📒 Move to folder',
    quizNoFoldersYet: 'No folders yet',
    quizDeleteSet: '🗑 Delete set',
    quizDeleteFolder: '🗑 Delete folder',
    quizFavorites: 'Favourites',
    quizRestored: 'Restored',
    quizOptions: 'Options',
    quizNoFolders: 'No folders',
    quizResizeFoldersHint: 'Drag to resize width',
    quizNamelessSet: 'Nameless',
    quizNewFolder: 'New folder',
    quizEmptySetMsg: 'There are no sets here.',
    quizEmptyFolderMsg: 'Add a set to get started.',
    quizEmptySetTitle: 'There are no sets here.',
    quizEditQaBadge: '✏️ Q/A',
    quizEditMcqBadge: '☑ MCQ',
    quizAiAnswer: 'AI Answer',
    quizAiSuggestion: 'AI suggestion',
    quizKeepCurrent: 'Keep current',
    quizReplaceAnswer: 'Replace answer',
    quizMcq: 'MCQ',
    quizOptionsLabel: 'Options',
    quizAddOption: 'Add option',
    quizCorrect: 'Correct',
    quizOptionPh: 'Option',
    quizExplanationOptional: 'Explanation (optional)',
    quizExplanationPh: 'Why is this the correct answer?',
    quizColorDefault: 'Default',
    quizColorPurple: 'Purple',
    quizColorBlue: 'Blue',
    quizColorGreen: 'Green',
    quizColorYellow: 'Yellow',
    quizColorRed: 'Red',
    quizColorPink: 'Pink',
    quizColorCyan: 'Cyan',
    quizSortManualFull: '✋ Manual order',
    quizSortOldest: '🕑 Oldest → newest',
    quizSortStudy: '📚 Not studied / studied',
    quizSortDateShort: 'Date',
    quizSortStudyShort: 'Study',
    quizStudyAllDone: 'All done!',
    quizStudyRoundComplete: 'Round {n} complete',
    quizStudyPercentCorrect: '{n}% correct',
    quizStudyKnownCount: '✓ {n} known',
    quizStudyLearningCount: '✗ {n} learning',
    quizStudyMoreBtn: 'Study {n} more →',
    quizStudyClose: 'Close',
    quizStudyPrevious: 'Previous',
    quizStudyNext: 'Next',
    quizStudySkip: 'Skip',
    quizStudyNextArrow: 'Next →',
    quizStudyTapToReveal: 'Tap to reveal answer',
    quizStudyFlipCard: 'Flip card',
    quizStudyFlipBack: 'Flip back',
    quizStudyNoAnswer: 'No answer written',
    quizStudyDontKnow: "Don't know",
    quizStudyKnowIt: 'Know it',
    quizStudyTypeAnswerPh: 'Type your answer... (Enter to check)',
    quizStudyCheckAnswer: 'Check Answer',
    quizStudyYourAnswer: 'Your Answer',
    quizStudyCorrectAnswer: 'Correct Answer',
    quizStudyIncorrect: 'Incorrect',
    quizStudyCorrect: 'Correct',
    quizStudyRemaining: '{n} remaining',
    quizStudyChooseQuestions: 'Choose questions',
    quizStudyPick: 'Pick',
    quizStudyWhatToStudy: 'what to study?',
    quizStudyScopeAll: 'All questions',
    quizStudyScopeNew: 'Not studied',
    quizStudyScopeLearning: "Don't know",
    quizStudyScopeKnown: 'Known',
    quizMoveFolderTrash: 'Move folder to trash',
    quizMoveSetTrash: 'Move set to trash',
    quizMoveToTrash: 'Move to trash',
    quizDupFolderName: 'A folder with that name already exists. Try a different name.',
    quizDupSetName: 'A set with that name already exists. Try a different name.',
    quizFolderInTrash: 'Folder in trash',
    quizMissingFoldersRestored: '↩ {n} missing folders restored',
    quizNoMoreFoldersFound: 'No more folders found',
    quizSearchMissingFolders: 'Search for missing folders',
    quizMoveFolderTrashMsg: 'The folder "{name}" and its sets will be moved to trash.',
    quizMoveSetTrashMsg: 'The set "{name}" will be moved to trash and can be restored later.',
    quizSetsCount: '{n} set',
    quizRestoredSets: 'Restored Sets',
    noteCreateQuestion: '✏️ Create question',
    noteClose: '✕ Close',
    notePaste: '📋 Paste',
    noteWriteQuestionPh: 'Write your question...',
    noteWriteAnswerPh: 'Write the answer...',
    noteGenerateAnswerPh: 'Generate or write the answer...',
    noteMcqCorrectHint: 'Circle = correct answer',
    noteSaveQuestion: '💾 Save question',
    noteSavedQuiz: 'Question saved to Quiz 🧠',
    noteQuizSavedCount: '{n} questions saved to Quiz 🧠',
    noteAiQuestion: '🤖 AI Question',
    noteShowAnswer: '👁 Show answer',
    noteGenerateQuestion: 'Generate question',
    noteGenerateQuestionPh: 'Generate or write your question...',
    noteGenerateMore: 'Generate more',
    noteGenerating: 'Generating questions...',
    noteEditBtn: '✏️ Edit',
    noteDone: '✓ Done',
    noteSkip: 'Skip →',
    noteFinish: 'Finish',
    noteSaveNext: '💾 Save & Next',
    noteQuizPanel: '🧠 Quiz',
    noteWriteQuestionEditPh: 'Write the question...',
    noteCreatedLabel: 'Created',
    noteUpdatedLabel: 'Updated',
    noteLastSaved: 'Last',
  },
  sv: {
    dir: 'ltr', htmlLang: 'sv', label: 'SV',
    appName: 'Taha Note', appSubtitle: 'Skriv, organisera och synkronisera dina anteckningar överallt.',
    navHome: 'Hem', navFav: 'Favoriter', navUnread: 'Att studera', navRead: 'Studerade',
    navLibrary: 'Anteckningsbibliotek', navFiles: 'Ladda upp filer', navArchive: 'Arkiv', navTrash: 'Papperskorg',
    searchPh: 'Sök...', newNote: 'Ny Anteckning', locked: 'Låst', editing: 'Redigerar',
    mDel: 'Radera', mUnarch: 'Avarkivera', mDone: 'Markera som Studerad', mUndone: 'Markera som Ostuderad', mArchive: 'Arkivera', mSave: 'Spara', mCopy: 'Kopiera', mGenQuiz: 'Generera Quiz', mAddQ: 'Lägg till fråga', mTiPh: 'Titel (valfri)',
    archPill: 'Läst & Arkiverad', userName: 'Användare', userSub: 'Mina Personliga Anteckningar',
    draft: 'Utkast', draftTiPh: 'Titel (valfri)', draftEdPh: 'Skriv din anteckning här...', saveDraft: 'Spara Anteckning',
    cloudSaving: 'Sparar...', cloudSaved: 'Sparat', cloudSavedMain: 'Sparat i molnet',
    pageHome: 'Hem', pageLib: 'Anteckningsbibliotek', pageUnread: 'Att studera', pageRead: 'Studerade',
    pageFav: 'Favoriter', pageArch: 'Arkiv', pageFiles: 'Ladda upp filer', pageTrash: 'Papperskorg',
    statActive: 'Aktiva Anteckningar', statUnread: 'Olästa', statFav: 'Favoriter',
    secAll: 'Alla Anteckningar', secUnread: 'Olästa', secFav: 'Favoriter', secFavArch: 'Arkiverade Favoriter',
    secRead: 'Lästa', secArch: 'Arkiv',
    tagFav: '⭐ Favorit', tagRead: '✓ Läst', tagUnread: '📖 Oläst', tagArch: '🗄 Arkiverad',
    emptyNotes: 'Inga anteckningar här', emptySearch: 'Inga resultat', emptyTrash: 'Papperskorgen är tom',
    filesTitle: 'Ladda upp filer', filesSub: 'Filer sparas säkert i ditt molnkonto.', filesSizeLimit: 'Maximal filstorlek: 20 MB per fil.', filesUpload: 'Välj filer',
    filesEmpty: 'Inga filer uppladdade ännu', filesDownload: 'Ladda ner', filesPreview: 'Förhandsgranska', filesRename: 'Byt namn', filesRenameSuccess: 'Filnamn uppdaterat', filesPreviewUnavailable: 'Förhandsgranskning finns inte för den här filtypen.', filesDelete: 'Radera', filesStored: 'Sparad i molnet',
    filesTooLarge: 'Filen är för stor (max 20 MB):', filesSaveFailed: 'Kunde inte spara filen i molnet.', filesUploadFailed: 'Uppladdningen misslyckades. Försök igen.', filesUploadSuccess: 'Fil uppladdad', filesQuotaExceeded: 'Lagringsgränsen är nådd. Radera filer eller kontakta support för mer utrymme.',
    selDel: '☑ Välj för Radering', cancelSel: '✕ Avbryt', emptyTrashBtn: 'Töm Papperskorgen', delSelected: 'Radera Valda',
    titleBold: 'Fet', titleItalic: 'Kursiv', titleUnline: 'Understruken', titleStrike: 'Genomstruken', titleInsertDateHeader: 'Infoga dagens datum som rubrik',
    titleRight: 'Höger', titleLeft: 'Vänster', titleClr: 'Ta bort formatering', titleColor: 'Textfärg',
    titleUnarch: 'Avarkivera', titleDone: 'Markera som Läst', titleUnread: 'Flytta till Olästa', titleArch: 'Arkivera',
    titleDel: 'Radera', titleRestore: 'Återställ', titlePermDel: 'Radera Permanent', titleFavAdd: 'Lägg till Favoriter', titleFavRem: 'Ta bort från Favoriter',
    tAddNote: 'Anteckning tillagd', tMoved: 'Flyttad till papperskorg', tArched: 'Flyttad till arkiv', tRestored: 'Återställd till aktiva',
    tFavAdd: 'Tillagd i favoriter ★', tFavRem: 'Borttagen från favoriter', tRead: 'Markerad som läst ✓', tUnread: 'Tillbaka till olästa',
    tSaved: 'Ändringar sparade', tTrashEmpty: 'Papperskorgen tömd', tDelSel: 'Raderade', tRestored2: 'Återställd',
    tPermDel: 'Permanent raderad', tCantEmpty: 'Text kan inte vara tom', tStudied: 'Markerad som läst och arkiverad ✓', tUnstudied: 'Markerad som ostuderad ↩',
    tUnarch: 'Återställd till aktiva anteckningar',
    cEmptyTrash: 'Ta bort alla anteckningar permanent?', cDelSel: 'Ta bort valda anteckningar permanent?', cPermDel: 'Ta bort permanent? Detta kan inte ångras.',
    dateLocale: 'sv-SE', signOut: 'Logga ut',
    setPassLbl: 'Skapa lösenord', setpassTitle: 'Skapa lösenord',
    setpassSub: 'Du kan skapa ett lösenord för att även logga in med e-post, utöver Google-inloggning.',
    setpassPassPh: 'Nytt lösenord', setpassPass2Ph: 'Bekräfta lösenord', setpassBtn: 'Spara lösenord', setpassCancel: 'Avbryt',
    setpassErrShort: 'Lösenordet måste vara minst 6 tecken', setpassErrMatch: 'Lösenorden matchar inte',
    setpassOk: '✓ Lösenordet har skapats', setpassErrRelogin: 'Logga ut och in igen, och försök sedan på nytt',
    setpassErrGeneric: 'Något gick fel, försök igen',
    resetpassTitle: 'Skapa ett nytt lösenord', resetpassEyebrow: 'SÄKERT KONTO',
    resetpassSubtitle: 'Välj ett starkt lösenord som du inte har använt tidigare.', resetpassFor: 'Lösenordet återställs för',
    resetpassOk: 'Lösenordet har ändrats', resetpassSuccessTitle: 'Ditt lösenord är klart',
    resetpassSuccessSub: 'Du kan nu logga in på Taha Note med ditt nya lösenord.',
    resetpassErrInvalid: 'Återställningslänken är ogiltig eller har gått ut.',
    resetpassErrExpired: 'Kunde inte återställa lösenordet. Begär en ny länk.',
    resetpassChecking: 'Kontrollerar din säkra länk...', resetpassNewLabel: 'Nytt lösenord',
    resetpassConfirmLabel: 'Bekräfta nytt lösenord', resetpassHint: 'Använd minst 6 tecken.',
    resetpassShow: 'Visa', resetpassHide: 'Dölj', resetpassSaving: 'Uppdaterar lösenord...',
    resetpassBack: 'Tillbaka till inloggning', resetpassRequestNew: 'Begär en ny länk',
    authLogin: 'Logga in', authSignup: 'Skapa konto', authLoginBtn: 'Logga in', authSignupBtn: 'Skapa konto',
    authForgot: 'Glömt lösenordet?', authEmailPh: 'E-postadress', authPassPh: 'Lösenord', authPass2Ph: 'Bekräfta lösenord',
    authGoogle: 'Fortsätt med Google', authOr: 'eller',
    authErrRequired: 'Ange din e-post och lösenord', authErrNotFound: 'E-posten är inte registrerad',
    authErrWrongPass: 'Felaktigt lösenord', authErrInUse: 'E-posten används redan',
    authErrInvalidEmail: 'Ogiltig e-postadress', authErrTooMany: 'För många försök, försök igen senare',
    authErrInvalidCred: 'Felaktig e-post eller lösenord', authErrGoogle: 'Ett fel uppstod vid Google-inloggning',
    authErrNeedEmail: 'Ange din e-post först', authResetSent: '✓ Länk för återställning av lösenord skickad',
    authErrSendFail: 'Kunde inte skicka e-post, kontrollera adressen',
    authErrEmailConfig: 'E-posttjänsten är inte konfigurerad. Kontakta support.',
    authErrRateLimited: 'Vänta en minut innan du begär ett nytt mejl.',
    featNotesTitle: '📝 Snabba anteckningar', featNotesSub: 'Spara idéer på några sekunder',
    featCloudTitle: '☁️ Molnsynkronisering', featCloudSub: 'Kom åt dina anteckningar överallt',
    featSecureTitle: '🔒 Säker lagring', featSecureSub: 'Dina data skyddas och säkerhetskopieras',
    featQuizTitle: '🧠 Smart Quiz', featQuizSub: 'Gör om anteckningar till flashcards och plugga smartare',
    featAiTitle: '✨ AI-assistent', featAiSub: 'Generera frågor och svar automatiskt',
    marketingTitle: 'Dina anteckningar, överallt.', marketingDesc: 'En modern plats för att skriva, organisera och synkronisera allt du behöver.',
    designedBy: '✦ Designad av Dr. Abdullah Taha ✦',
    settingsTitle: 'Inställningar',
    adminTitle: 'Användarpanel',
    settingsProfile: 'Profil',
    settingsProfileName: 'Visningsnamn',
    settingsProfileEmail: 'E-postadress',
    settingsProfilePhotoUpload: 'Ladda upp profilbild',
    settingsProfilePhotoChange: 'Byt bild',
    settingsProfilePhotoUploading: 'Laddar upp…',
    settingsProfilePhotoError: 'Kunde inte ladda upp bilden. Försök igen.',
    settingsProfilePhotoInvalidType: 'Använd JPG, PNG eller WebP.',
    settingsSave: 'Spara',
    settingsSaved: '✓ Sparad',
    settingsPassword: 'Lösenord',
    settingsPasswordSet: 'Lösenord är aktiverat',
    settingsNoPassword: 'Inget lösenord inställt',
    settingsNoPasswordSub: 'Kontot använder endast Google-inloggning',
    settingsCreatePassword: 'Skapa lösenord',
    settingsChangePass: 'Skicka e-post för återställning',
    settingsSetPass: 'Skapa ett lösenord',
    settingsPassEmailSent: '✓ Återställningsmail skickat',
    settingsStorage: 'Lagring',
    settingsStorageNotes: 'Anteckningar',
    settingsStorageQuiz: 'Quiz',
    settingsStorageChat: 'AI-chatt',
    settingsStorageFiles: 'Filer',
    settingsStorageTotal: 'Totalt använt',
    settingsStorageLimit: 'Lagringsgräns',
    settingsFolderBackup: 'Säkerhetskopior av quiz-mappar',
    settingsFolderBackupEmpty: 'Inga säkerhetskopior ännu. Från och med nu sparas en kopia automatiskt varje gång mappar ändras.',
    settingsFolderBackupLast: 'Senaste säkerhetskopia',
    settingsFolderBackupRestore: 'Återställ',
    settingsFolderBackupRestored: 'Mappar återställda från backup',
    settingsDanger: 'Farlig zon',
    settingsDeleteAccount: 'Radera konto',
    settingsDeleteConfirmTitle: 'Radera ditt konto?',
    settingsDeleteConfirmSub: 'Detta raderar permanent alla dina anteckningar, quiz, chattar och kontodata. Åtgärden kan inte ångras.',
    settingsDeleteConfirmBtn: 'Ja, radera allt',
    settingsDeleting: 'Raderar...',
    otterSearchTitle: 'Sök',
    otterSearchPlaceholder: 'Sök på Google…',
    otterSearchGo: 'Sök',
    otterSearchToggle: 'Öppna Google i ny flik',
    otterSearchClose: 'Stäng sökpanelen',
    otterSearchExternal: 'Öppna i ny flik',
    otterSearchPopupBlocked:
      'Webbläsaren blockerade Google-panelen. Tillåt popup-fönster för tahanote.com, eller använd knappen nedan.',
    otterSearchPopupRetry: 'Öppna Google',
    otterSearchPopupDocked: 'Google är öppet i panelen bredvid sidan — med din vanliga webbläsarsession.',
    otterSearchPopupLoading: 'Öppnar Google…',
    settingsPlan: 'Abonnemang',
    settingsPlanFree: 'Gratis',
    settingsPlanPlus: 'Taha Note Plus',
    settingsPlanFreeSub: '100 MB lagring · inga AI-funktioner',
    plusTitle: 'Taha Note Plus',
    plusSub: 'Uppgradera till Plus för mer lagring och full AI-åtkomst.',
    plusFeatureStorage: '✓ 1000 MB molnlagring',
    plusFeatureAi: '✓ AI-chatt, AI-svar och AI-quiz',
    plusAiLocked: 'AI-funktioner ingår i Taha Note Plus. Kontakta administratören för att uppgradera.',
    verifyTitle: 'Verifiera din e-post',
    verifySub: 'Vi skickade en verifieringslänk till',
    verifyResend: 'Skicka igen',
    verifyResent: '✓ E-post skickad',
    verifySendFail: 'Kunde inte skicka e-post. Försök igen om en stund.',
    verifyDone: 'Jag har verifierat',
    verifyCheck: 'Kontrollerar...',
    verifyCancel: 'Avbryt registrering & radera konto',
    quizQuestionLabel: 'Fråga',
    quizAnswerLabel: 'Svar',
    quizStudyMore: '📚 Plugga mer',
    quizRevealAnswer: '👁️ Visa',
    quizExplanationLabel: 'Förklaring',
    quizMarkKnown: 'Markera som studerad (kan)',
    quizMarkNotKnown: 'Markera som ej klar (plugga mer)',
    quizFavorite: 'Favorit',
    quizStopSpeak: 'Stoppa',
    quizSpeak: 'Läs upp',
    quizEdit: 'Redigera',
    quizMoveToSet: 'Flytta till set',
    quizMoveToSetTitle: 'Flytta till set',
    quizNoSetsInFolder: 'Inga set i den här mappen',
    quizSetsWord: 'set',
    quizItemsShort: 'st',
    quizDelete: 'Ta bort',
    quizCreated: 'Skapad:',
    quizUpdated: 'Uppdaterad:',
    quizReorderHint: 'Skriv nummer och tryck Enter — byter plats med det numret',
    quizReorderAria: 'Byt plats med nummer',
    quizShowSidebar: 'Visa listan',
    quizHideSidebar: 'Dölj listan',
    quizTitle: 'Quiz',
    quizQuestionsFromNotes: 'Frågor från anteckningar',
    quizQuestionOne: 'fråga',
    quizQuestionMany: 'frågor',
    quizKnownProgress: 'kan',
    quizHideAnswers: 'Dölj svar',
    quizShowAnswers: 'Visa svar',
    quizHideAnswersShort: 'Dölj',
    quizShowAnswersShort: 'Visa',
    quizSortQuestions: 'Sortera frågor',
    quizFlashcards: '🃏 Flashcards',
    quizDownloadPdf: '📄 Ladda ner PDF',
    quizPdfGeneratedOn: 'Genererad',
    quizTypeAnswer: '✏️ Skriv',
    quizAdd: 'Lägg till',
    quizAddQuestion: 'Lägg till fråga',
    quizSetsLabel: 'Set',
    quizSortManualShort: 'Egen',
    quizSortManual: '✋ Egen ordning',
    quizSortName: '🔤 Namn (A–Z)',
    quizSortCount: '🔢 Antal frågor',
    quizSortAz: 'A–Z',
    quizSortHash: '#',
    quizFolderEmpty: 'Tomt',
    quizNoUngroupedSets: 'Inga lösa set',
    quizFolder: 'Mapp',
    quizAddSet: 'Lägg till set',
    quizAddFolder: 'Lägg till mapp',
    quizRename: '✏️ Byt namn',
    quizColor: '🎨 Färg',
    quizMoveToFolder: '📒 Flytta till mapp',
    quizNoFoldersYet: 'Inga mappar än',
    quizDeleteSet: '🗑 Ta bort set',
    quizDeleteFolder: '🗑 Ta bort mapp',
    quizFavorites: 'Favoriter',
    quizRestored: 'Återställda',
    quizOptions: 'Alternativ',
    quizNoFolders: 'Inga mappar',
    quizResizeFoldersHint: 'Dra för att ändra bredd',
    quizNamelessSet: 'Namnlös',
    quizNewFolder: 'Ny mapp',
    quizEmptySetMsg: 'Det finns inga set här.',
    quizEmptyFolderMsg: 'Lägg till ett set för att börja.',
    quizEmptySetTitle: 'Det finns inga set här.',
    quizEditQaBadge: '✏️ Q/A',
    quizEditMcqBadge: '☑ MCQ',
    quizAiAnswer: 'AI-svar',
    quizAiSuggestion: 'AI-förslag',
    quizKeepCurrent: 'Behåll nuvarande',
    quizReplaceAnswer: 'Ersätt svaret',
    quizMcq: 'Flerval',
    quizOptionsLabel: 'Alternativ',
    quizAddOption: 'Lägg till alternativ',
    quizCorrect: 'Rätt',
    quizOptionPh: 'Alternativ',
    quizExplanationOptional: 'Förklaring (valfri)',
    quizExplanationPh: 'Varför är detta rätt svar?',
    quizColorDefault: 'Standard',
    quizColorPurple: 'Lila',
    quizColorBlue: 'Blå',
    quizColorGreen: 'Grön',
    quizColorYellow: 'Gul',
    quizColorRed: 'Röd',
    quizColorPink: 'Rosa',
    quizColorCyan: 'Cyan',
    quizSortManualFull: '✋ Egen ordning',
    quizSortOldest: '🕑 Äldst → nyast',
    quizSortStudy: '📚 Ej studerade / studerade',
    quizSortDateShort: 'Datum',
    quizSortStudyShort: 'Studie',
    quizStudyAllDone: 'Klart!',
    quizStudyRoundComplete: 'Runda {n} klar',
    quizStudyPercentCorrect: '{n}% rätt',
    quizStudyKnownCount: '✓ {n} kan',
    quizStudyLearningCount: '✗ {n} att plugga',
    quizStudyMoreBtn: 'Plugga {n} till →',
    quizStudyClose: 'Stäng',
    quizStudyPrevious: 'Föregående',
    quizStudyNext: 'Nästa',
    quizStudySkip: 'Hoppa över',
    quizStudyNextArrow: 'Nästa →',
    quizStudyTapToReveal: 'Tryck för att se svaret',
    quizStudyFlipCard: 'Vänd kort',
    quizStudyFlipBack: 'Vänd tillbaka',
    quizStudyNoAnswer: 'Inget svar skrivet',
    quizStudyDontKnow: 'Kan inte',
    quizStudyKnowIt: 'Kan',
    quizStudyTypeAnswerPh: 'Skriv ditt svar... (Enter för att rätta)',
    quizStudyCheckAnswer: 'Rätta svar',
    quizStudyYourAnswer: 'Ditt svar',
    quizStudyCorrectAnswer: 'Rätt svar',
    quizStudyIncorrect: 'Fel',
    quizStudyCorrect: 'Rätt',
    quizStudyRemaining: '{n} kvar',
    quizStudyChooseQuestions: 'Välj frågor',
    quizStudyPick: 'Välj',
    quizStudyWhatToStudy: 'vad vill du plugga?',
    quizStudyScopeAll: 'Alla frågor',
    quizStudyScopeNew: 'Ej studerade',
    quizStudyScopeLearning: 'Kan inte (fel)',
    quizStudyScopeKnown: 'Kan (rätt)',
    quizMoveFolderTrash: 'Flytta mapp till papperskorgen',
    quizMoveSetTrash: 'Flytta set till papperskorgen',
    quizMoveToTrash: 'Flytta till papperskorgen',
    quizDupFolderName: 'Det finns redan en mapp med det namnet. Försök med ett annat namn.',
    quizDupSetName: 'Det finns redan ett set med det namnet. Försök med ett annat namn.',
    quizFolderInTrash: 'Mapp i papperskorgen',
    quizMissingFoldersRestored: '↩ {n} saknade mappar återställda',
    quizNoMoreFoldersFound: 'Inga fler mappar hittades',
    quizSearchMissingFolders: 'Sök efter saknade mappar',
    quizMoveFolderTrashMsg: 'Mappen "{name}" och dess sets flyttas till papperskorgen.',
    quizMoveSetTrashMsg: 'Setet "{name}" flyttas till papperskorgen och kan återställas senare.',
    quizSetsCount: '{n} set',
    quizRestoredSets: 'Återställda set',
    noteCreateQuestion: '✏️ Skapa fråga',
    noteClose: '✕ Stäng',
    notePaste: '📋 Klistra in',
    noteWriteQuestionPh: 'Skriv din fråga...',
    noteWriteAnswerPh: 'Skriv svaret...',
    noteGenerateAnswerPh: 'Generera eller skriv svaret...',
    noteMcqCorrectHint: 'Circle = rätt svar',
    noteSaveQuestion: '💾 Spara fråga',
    noteSavedQuiz: 'Fråga sparad i Quiz 🧠',
    noteQuizSavedCount: '{n} frågor sparade i Quiz 🧠',
    noteAiQuestion: '🤖 AI Fråga',
    noteShowAnswer: '👁 Visa svar',
    noteGenerateQuestion: 'Generera fråga',
    noteGenerateQuestionPh: 'Generera eller skriv din fråga...',
    noteGenerateMore: 'Generera fler',
    noteGenerating: 'Genererar frågor...',
    noteEditBtn: '✏️ Redigera',
    noteDone: '✓ Klar',
    noteSkip: 'Hoppa över →',
    noteFinish: 'Avsluta',
    noteSaveNext: '💾 Spara & Nästa',
    noteQuizPanel: '🧠 Quiz',
    noteWriteQuestionEditPh: 'Skriv frågan...',
    noteCreatedLabel: 'Skapad',
    noteUpdatedLabel: 'Uppdaterad',
    noteLastSaved: 'Senast',
  },
};
