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
  filesUpload: string;
  filesEmpty: string;
  filesOpen: string;
  filesDelete: string;
  filesStored: string;
  selDel: string;
  cancelSel: string;
  emptyTrashBtn: string;
  delSelected: string;
  titleBold: string;
  titleItalic: string;
  titleUnline: string;
  titleStrike: string;
  titleRight: string;
  titleCenter: string;
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
  settingsProfile: string;
  settingsProfileName: string;
  settingsProfileEmail: string;
  settingsSave: string;
  settingsSaved: string;
  settingsPassword: string;
  settingsChangePass: string;
  settingsSetPass: string;
  settingsPassEmailSent: string;
  settingsStorage: string;
  settingsStorageNotes: string;
  settingsStorageQuiz: string;
  settingsStorageChat: string;
  settingsStorageTotal: string;
  settingsAIUsage: string;
  settingsTokensUsed: string;
  settingsResetTokens: string;
  settingsTokensReset: string;
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
    filesTitle: 'Upload files', filesSub: 'Files are saved securely in your cloud account.', filesUpload: 'Choose files',
    filesEmpty: 'No files uploaded yet', filesOpen: 'Open', filesDelete: 'Delete', filesStored: 'Saved in cloud',
    selDel: '☑ Select to Delete', cancelSel: '✕ Cancel', emptyTrashBtn: 'Empty Trash', delSelected: 'Delete Selected',
    titleBold: 'Bold', titleItalic: 'Italic', titleUnline: 'Underline', titleStrike: 'Strikethrough',
    titleRight: 'Align Right', titleCenter: 'Center', titleLeft: 'Align Left', titleClr: 'Clear Formatting', titleColor: 'Text Color',
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
    featNotesTitle: '📝 Quick Notes', featNotesSub: 'Save ideas in seconds',
    featCloudTitle: '☁️ Cloud Sync', featCloudSub: 'Access your notes everywhere',
    featSecureTitle: '🔒 Secure Storage', featSecureSub: 'Your data is protected and backed up',
    featQuizTitle: '🧠 Smart Quiz', featQuizSub: 'Turn notes into flashcards and study smarter',
    featAiTitle: '✨ AI Assistant', featAiSub: 'Generate questions and answers automatically',
    marketingTitle: 'Your notes, everywhere.', marketingDesc: 'A modern place to write, organize, and sync everything you need.',
    designedBy: '✦ Designed by Dr. Abdullah Taha ✦',
    settingsTitle: 'Settings',
    settingsProfile: 'Profile',
    settingsProfileName: 'Display name',
    settingsProfileEmail: 'Email address',
    settingsSave: 'Save',
    settingsSaved: '✓ Saved',
    settingsPassword: 'Password',
    settingsChangePass: 'Send password reset email',
    settingsSetPass: 'Set a password',
    settingsPassEmailSent: '✓ Reset email sent',
    settingsStorage: 'Storage',
    settingsStorageNotes: 'Notes',
    settingsStorageQuiz: 'Quiz',
    settingsStorageChat: 'AI Chat',
    settingsStorageTotal: 'Total used',
    settingsAIUsage: 'AI Token Usage',
    settingsTokensUsed: 'Total tokens used',
    settingsResetTokens: 'Reset counter',
    settingsTokensReset: '✓ Counter reset',
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
    filesTitle: 'Ladda upp filer', filesSub: 'Filer sparas säkert i ditt molnkonto.', filesUpload: 'Välj filer',
    filesEmpty: 'Inga filer uppladdade ännu', filesOpen: 'Öppna', filesDelete: 'Radera', filesStored: 'Sparad i molnet',
    selDel: '☑ Välj för Radering', cancelSel: '✕ Avbryt', emptyTrashBtn: 'Töm Papperskorgen', delSelected: 'Radera Valda',
    titleBold: 'Fet', titleItalic: 'Kursiv', titleUnline: 'Understruken', titleStrike: 'Genomstruken',
    titleRight: 'Höger', titleCenter: 'Centrera', titleLeft: 'Vänster', titleClr: 'Ta bort formatering', titleColor: 'Textfärg',
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
    featNotesTitle: '📝 Snabba anteckningar', featNotesSub: 'Spara idéer på några sekunder',
    featCloudTitle: '☁️ Molnsynkronisering', featCloudSub: 'Kom åt dina anteckningar överallt',
    featSecureTitle: '🔒 Säker lagring', featSecureSub: 'Dina data skyddas och säkerhetskopieras',
    featQuizTitle: '🧠 Smart Quiz', featQuizSub: 'Gör om anteckningar till flashcards och plugga smartare',
    featAiTitle: '✨ AI-assistent', featAiSub: 'Generera frågor och svar automatiskt',
    marketingTitle: 'Dina anteckningar, överallt.', marketingDesc: 'En modern plats för att skriva, organisera och synkronisera allt du behöver.',
    designedBy: '✦ Designad av Dr. Abdullah Taha ✦',
    settingsTitle: 'Inställningar',
    settingsProfile: 'Profil',
    settingsProfileName: 'Visningsnamn',
    settingsProfileEmail: 'E-postadress',
    settingsSave: 'Spara',
    settingsSaved: '✓ Sparad',
    settingsPassword: 'Lösenord',
    settingsChangePass: 'Skicka e-post för återställning',
    settingsSetPass: 'Skapa ett lösenord',
    settingsPassEmailSent: '✓ Återställningsmail skickat',
    settingsStorage: 'Lagring',
    settingsStorageNotes: 'Anteckningar',
    settingsStorageQuiz: 'Quiz',
    settingsStorageChat: 'AI-chatt',
    settingsStorageTotal: 'Totalt använt',
    settingsAIUsage: 'AI-tokenanvändning',
    settingsTokensUsed: 'Totalt använda tokens',
    settingsResetTokens: 'Nollställ räknare',
    settingsTokensReset: '✓ Räknare nollställd',
  },
};
