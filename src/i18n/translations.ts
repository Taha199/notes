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
  navArchive: string;
  navTrash: string;
  searchPh: string;
  newNote: string;
  locked: string;
  editing: string;
  mDel: string;
  mUnarch: string;
  mDone: string;
  mSave: string;
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
  resetpassFor: string;
  resetpassOk: string;
  resetpassErrInvalid: string;
  resetpassErrExpired: string;
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
}

export const LANGS: Record<Lang, Translation> = {
  ar: {
    dir: 'rtl', htmlLang: 'ar', label: 'AR',
    appName: 'ملاحظاتي', appSubtitle: 'اكتب، نظّم، وزامن ملاحظاتك في كل مكان.',
    navHome: 'الصفحة الرئيسية', navFav: 'المفضلة', navUnread: 'غير مدروسة', navRead: 'مدروسة',
    navLibrary: 'مكتبة الملاحظات', navArchive: 'الأرشيف', navTrash: 'سلة المهملات',
    searchPh: 'بحث...', newNote: 'ملاحظة جديدة', locked: 'مقفل', editing: 'قيد التعديل',
    mDel: 'حذف', mUnarch: 'إلغاء الأرشفة', mDone: 'درستها', mSave: 'حفظ', mTiPh: 'العنوان (اختياري)',
    archPill: 'مدروسة ومؤرشفة', userName: 'مستخدم', userSub: 'ملاحظاتي الشخصية',
    draft: 'مسودة', draftTiPh: 'عنوان (اختياري)', draftEdPh: 'اكتب ملاحظتك هنا...', saveDraft: 'حفظ الملاحظة',
    cloudSaving: 'جاري الحفظ...', cloudSaved: 'تم الحفظ', cloudSavedMain: 'تم الحفظ سحابياً',
    pageHome: 'الصفحة الرئيسية', pageLib: 'مكتبة الملاحظات', pageUnread: 'غير مدروسة', pageRead: 'مدروسة',
    pageFav: 'المفضلة', pageArch: 'الأرشيف', pageTrash: 'سلة المهملات',
    statActive: 'ملاحظات نشطة', statUnread: 'غير مدروسة', statFav: 'المفضلة',
    secAll: 'جميع الملاحظات', secUnread: 'غير مدروسة', secFav: 'المفضلة', secFavArch: 'مفضلة مؤرشفة',
    secRead: 'مدروسة', secArch: 'الأرشيف',
    tagFav: '⭐ مفضلة', tagRead: '✓ مدروسة', tagUnread: '📖 غير مدروسة', tagArch: '🗄 مؤرشفة',
    emptyNotes: 'لا توجد ملاحظات هنا', emptySearch: 'لا نتائج', emptyTrash: 'السلة فارغة',
    selDel: '☑ تحديد للحذف', cancelSel: '✕ إلغاء التحديد', emptyTrashBtn: 'إفراغ السلة', delSelected: 'حذف المحدد',
    titleBold: 'تفخيم', titleItalic: 'مائل', titleUnline: 'تسطير', titleStrike: 'شطب',
    titleRight: 'يمين', titleCenter: 'توسيط', titleLeft: 'يسار', titleClr: 'إزالة التنسيق', titleColor: 'لون الخط',
    titleUnarch: 'إلغاء الأرشفة', titleDone: 'درستها', titleUnread: 'إعادة لغير مدروسة', titleArch: 'أرشفة',
    titleDel: 'حذف', titleRestore: 'استعادة', titlePermDel: 'حذف نهائي', titleFavAdd: 'إضافة للمفضلة', titleFavRem: 'إزالة من المفضلة',
    tAddNote: 'تمت إضافة الملاحظة', tMoved: 'نُقلت للسلة', tArched: 'تم نقلها للأرشيف', tRestored: 'أُعيدت للملاحظات النشطة',
    tFavAdd: 'أُضيفت للمفضلة ★', tFavRem: 'أُزيلت من المفضلة', tRead: 'تم تعليمها كمدروسة ✓', tUnread: 'أُعيدت لغير مدروسة',
    tSaved: 'تم حفظ التعديل', tTrashEmpty: 'تم إفراغ السلة', tDelSel: 'تم الحذف', tRestored2: 'تمت الاستعادة',
    tPermDel: 'تم الحذف النهائي', tCantEmpty: 'النص لا يمكن أن يكون فارغاً', tStudied: 'تم تعليمها كمدروسة ونقلها للأرشيف ✓',
    tUnarch: 'أُعيدت للملاحظات النشطة',
    cEmptyTrash: 'حذف كل الملاحظات في السلة نهائياً؟', cDelSel: 'حذف الملاحظات المحددة نهائياً؟', cPermDel: 'حذف نهائي لا يمكن التراجع عنه؟',
    dateLocale: 'ar-SA', signOut: 'تسجيل الخروج',
    setPassLbl: 'إنشاء كلمة سر', setpassTitle: 'إنشاء كلمة سر',
    setpassSub: 'يمكنك إنشاء كلمة سر لتسجيل الدخول بالبريد الإلكتروني أيضاً، بالإضافة إلى تسجيل الدخول عبر Google.',
    setpassPassPh: 'كلمة المرور الجديدة', setpassPass2Ph: 'تأكيد كلمة المرور', setpassBtn: 'حفظ كلمة المرور', setpassCancel: 'إلغاء',
    setpassErrShort: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل', setpassErrMatch: 'كلمتا المرور غير متطابقتين',
    setpassOk: '✓ تم إنشاء كلمة المرور بنجاح', setpassErrRelogin: 'يرجى تسجيل الخروج والدخول مجدداً ثم إعادة المحاولة',
    setpassErrGeneric: 'حدث خطأ، حاول مرة أخرى',
    resetpassTitle: 'إعادة تعيين كلمة المرور', resetpassFor: 'لحساب',
    resetpassOk: '✓ تم تغيير كلمة المرور بنجاح، جارٍ تحويلك...', resetpassErrInvalid: 'الرابط غير صالح أو منتهي الصلاحية',
    resetpassErrExpired: 'تعذر تغيير كلمة المرور، الرابط منتهي الصلاحية',
    authLogin: 'تسجيل الدخول', authSignup: 'إنشاء حساب', authLoginBtn: 'دخول', authSignupBtn: 'إنشاء حساب',
    authForgot: 'نسيت كلمة المرور؟', authEmailPh: 'البريد الإلكتروني', authPassPh: 'كلمة المرور', authPass2Ph: 'تأكيد كلمة المرور',
    authGoogle: 'المتابعة عبر Google', authOr: 'أو',
    authErrRequired: 'يرجى إدخال البريد الإلكتروني وكلمة المرور', authErrNotFound: 'البريد الإلكتروني غير مسجل',
    authErrWrongPass: 'كلمة المرور غير صحيحة', authErrInUse: 'البريد الإلكتروني مستخدم مسبقاً',
    authErrInvalidEmail: 'صيغة البريد الإلكتروني غير صحيحة', authErrTooMany: 'محاولات كثيرة، حاول لاحقاً',
    authErrInvalidCred: 'البريد أو كلمة المرور غير صحيحة', authErrGoogle: 'حدث خطأ أثناء تسجيل الدخول عبر Google',
    authErrNeedEmail: 'أدخل بريدك الإلكتروني أولاً', authResetSent: '✓ تم إرسال رابط إعادة تعيين كلمة المرور',
    authErrSendFail: 'تعذر إرسال البريد، تحقق من العنوان',
    featNotesTitle: '📝 ملاحظات سريعة', featNotesSub: 'احفظ أفكارك في ثوانٍ',
    featCloudTitle: '☁️ مزامنة سحابية', featCloudSub: 'الوصول لملاحظاتك من كل مكان',
    featSecureTitle: '🔒 تخزين آمن', featSecureSub: 'بياناتك محمية ومحفوظة',
  },
  en: {
    dir: 'ltr', htmlLang: 'en', label: 'EN',
    appName: 'My Notes', appSubtitle: 'Write, organize, and sync your notes everywhere.',
    navHome: 'Home', navFav: 'Favourites', navUnread: 'Unread', navRead: 'Read',
    navLibrary: 'Notes Library', navArchive: 'Archive', navTrash: 'Trash',
    searchPh: 'Search...', newNote: 'New Note', locked: 'Locked', editing: 'Editing',
    mDel: 'Delete', mUnarch: 'Unarchive', mDone: 'Mark as Read', mSave: 'Save', mTiPh: 'Title (optional)',
    archPill: 'Read & Archived', userName: 'User', userSub: 'My Personal Notes',
    draft: 'Draft', draftTiPh: 'Title (optional)', draftEdPh: 'Write your note here...', saveDraft: 'Save Note',
    cloudSaving: 'Saving...', cloudSaved: 'Saved', cloudSavedMain: 'Saved to cloud',
    pageHome: 'Home', pageLib: 'Notes Library', pageUnread: 'Unread', pageRead: 'Read',
    pageFav: 'Favourites', pageArch: 'Archive', pageTrash: 'Trash',
    statActive: 'Active Notes', statUnread: 'Unread', statFav: 'Favourites',
    secAll: 'All Notes', secUnread: 'Unread', secFav: 'Favourites', secFavArch: 'Archived Favourites',
    secRead: 'Read', secArch: 'Archive',
    tagFav: '⭐ Favourite', tagRead: '✓ Read', tagUnread: '📖 Unread', tagArch: '🗄 Archived',
    emptyNotes: 'No notes here', emptySearch: 'No results', emptyTrash: 'Trash is empty',
    selDel: '☑ Select to Delete', cancelSel: '✕ Cancel', emptyTrashBtn: 'Empty Trash', delSelected: 'Delete Selected',
    titleBold: 'Bold', titleItalic: 'Italic', titleUnline: 'Underline', titleStrike: 'Strikethrough',
    titleRight: 'Align Right', titleCenter: 'Center', titleLeft: 'Align Left', titleClr: 'Clear Formatting', titleColor: 'Text Color',
    titleUnarch: 'Unarchive', titleDone: 'Mark as Read', titleUnread: 'Move to Unread', titleArch: 'Archive',
    titleDel: 'Delete', titleRestore: 'Restore', titlePermDel: 'Delete Permanently', titleFavAdd: 'Add to Favourites', titleFavRem: 'Remove from Favourites',
    tAddNote: 'Note added', tMoved: 'Moved to trash', tArched: 'Moved to archive', tRestored: 'Restored to active',
    tFavAdd: 'Added to favourites ★', tFavRem: 'Removed from favourites', tRead: 'Marked as read ✓', tUnread: 'Moved back to unread',
    tSaved: 'Changes saved', tTrashEmpty: 'Trash emptied', tDelSel: 'Deleted', tRestored2: 'Restored',
    tPermDel: 'Permanently deleted', tCantEmpty: 'Text cannot be empty', tStudied: 'Marked as read & archived ✓',
    tUnarch: 'Restored to active notes',
    cEmptyTrash: 'Permanently delete all notes in trash?', cDelSel: 'Permanently delete selected notes?', cPermDel: 'Permanently delete? This cannot be undone.',
    dateLocale: 'en-GB', signOut: 'Sign Out',
    setPassLbl: 'Set Password', setpassTitle: 'Set Password',
    setpassSub: 'You can create a password to also sign in with email, in addition to Google sign-in.',
    setpassPassPh: 'New password', setpassPass2Ph: 'Confirm password', setpassBtn: 'Save Password', setpassCancel: 'Cancel',
    setpassErrShort: 'Password must be at least 6 characters', setpassErrMatch: 'Passwords do not match',
    setpassOk: '✓ Password created successfully', setpassErrRelogin: 'Please sign out and sign in again, then retry',
    setpassErrGeneric: 'Something went wrong, please try again',
    resetpassTitle: 'Reset Password', resetpassFor: 'for account',
    resetpassOk: '✓ Password changed successfully, redirecting...', resetpassErrInvalid: 'This link is invalid or has expired',
    resetpassErrExpired: 'Could not reset password, the link has expired',
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
  },
  sv: {
    dir: 'ltr', htmlLang: 'sv', label: 'SV',
    appName: 'Mina Anteckningar', appSubtitle: 'Skriv, organisera och synkronisera dina anteckningar överallt.',
    navHome: 'Hem', navFav: 'Favoriter', navUnread: 'Olästa', navRead: 'Lästa',
    navLibrary: 'Anteckningsbibliotek', navArchive: 'Arkiv', navTrash: 'Papperskorg',
    searchPh: 'Sök...', newNote: 'Ny Anteckning', locked: 'Låst', editing: 'Redigerar',
    mDel: 'Radera', mUnarch: 'Avarkivera', mDone: 'Markera som Läst', mSave: 'Spara', mTiPh: 'Titel (valfri)',
    archPill: 'Läst & Arkiverad', userName: 'Användare', userSub: 'Mina Personliga Anteckningar',
    draft: 'Utkast', draftTiPh: 'Titel (valfri)', draftEdPh: 'Skriv din anteckning här...', saveDraft: 'Spara Anteckning',
    cloudSaving: 'Sparar...', cloudSaved: 'Sparat', cloudSavedMain: 'Sparat i molnet',
    pageHome: 'Hem', pageLib: 'Anteckningsbibliotek', pageUnread: 'Olästa', pageRead: 'Lästa',
    pageFav: 'Favoriter', pageArch: 'Arkiv', pageTrash: 'Papperskorg',
    statActive: 'Aktiva Anteckningar', statUnread: 'Olästa', statFav: 'Favoriter',
    secAll: 'Alla Anteckningar', secUnread: 'Olästa', secFav: 'Favoriter', secFavArch: 'Arkiverade Favoriter',
    secRead: 'Lästa', secArch: 'Arkiv',
    tagFav: '⭐ Favorit', tagRead: '✓ Läst', tagUnread: '📖 Oläst', tagArch: '🗄 Arkiverad',
    emptyNotes: 'Inga anteckningar här', emptySearch: 'Inga resultat', emptyTrash: 'Papperskorgen är tom',
    selDel: '☑ Välj för Radering', cancelSel: '✕ Avbryt', emptyTrashBtn: 'Töm Papperskorgen', delSelected: 'Radera Valda',
    titleBold: 'Fet', titleItalic: 'Kursiv', titleUnline: 'Understruken', titleStrike: 'Genomstruken',
    titleRight: 'Höger', titleCenter: 'Centrera', titleLeft: 'Vänster', titleClr: 'Ta bort formatering', titleColor: 'Textfärg',
    titleUnarch: 'Avarkivera', titleDone: 'Markera som Läst', titleUnread: 'Flytta till Olästa', titleArch: 'Arkivera',
    titleDel: 'Radera', titleRestore: 'Återställ', titlePermDel: 'Radera Permanent', titleFavAdd: 'Lägg till Favoriter', titleFavRem: 'Ta bort från Favoriter',
    tAddNote: 'Anteckning tillagd', tMoved: 'Flyttad till papperskorg', tArched: 'Flyttad till arkiv', tRestored: 'Återställd till aktiva',
    tFavAdd: 'Tillagd i favoriter ★', tFavRem: 'Borttagen från favoriter', tRead: 'Markerad som läst ✓', tUnread: 'Tillbaka till olästa',
    tSaved: 'Ändringar sparade', tTrashEmpty: 'Papperskorgen tömd', tDelSel: 'Raderade', tRestored2: 'Återställd',
    tPermDel: 'Permanent raderad', tCantEmpty: 'Text kan inte vara tom', tStudied: 'Markerad som läst och arkiverad ✓',
    tUnarch: 'Återställd till aktiva anteckningar',
    cEmptyTrash: 'Ta bort alla anteckningar permanent?', cDelSel: 'Ta bort valda anteckningar permanent?', cPermDel: 'Ta bort permanent? Detta kan inte ångras.',
    dateLocale: 'sv-SE', signOut: 'Logga ut',
    setPassLbl: 'Skapa lösenord', setpassTitle: 'Skapa lösenord',
    setpassSub: 'Du kan skapa ett lösenord för att även logga in med e-post, utöver Google-inloggning.',
    setpassPassPh: 'Nytt lösenord', setpassPass2Ph: 'Bekräfta lösenord', setpassBtn: 'Spara lösenord', setpassCancel: 'Avbryt',
    setpassErrShort: 'Lösenordet måste vara minst 6 tecken', setpassErrMatch: 'Lösenorden matchar inte',
    setpassOk: '✓ Lösenordet har skapats', setpassErrRelogin: 'Logga ut och in igen, och försök sedan på nytt',
    setpassErrGeneric: 'Något gick fel, försök igen',
    resetpassTitle: 'Återställ lösenord', resetpassFor: 'för kontot',
    resetpassOk: '✓ Lösenordet har ändrats, omdirigerar...', resetpassErrInvalid: 'Länken är ogiltig eller har gått ut',
    resetpassErrExpired: 'Kunde inte återställa lösenordet, länken har gått ut',
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
  },
};
