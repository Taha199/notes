import { useState, useMemo, useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes, type RecoverableCloudSummary } from '../../contexts/NotesContext';
import { useToast } from '../../contexts/ToastContext';
import { SetPasswordModal } from '../auth/SetPasswordModal';
import { FB_DB_URL, ADMIN_EMAIL } from '../../lib/firebase';
import { getStorageLimitMB, mbToBytes } from '../../lib/storageQuota';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}


function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
      <div className="border-b border-app-border px-5 py-3.5 dark:border-white/10">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-app-text-secondary/70 dark:text-gray-400">
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { user, hasPassword, isPlus, hasAi, profilePhotoURL, updateDisplayName, updateProfilePhoto, resetPassword, deleteAccount } = useAuth();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { notes, quizzes, quizSets, quizFolders, chats, loaded, listQuizFolderBackups, restoreQuizFolderBackup, listDataBackups, restoreDataBackup, scanRecoverableCloud, emergencyRecoverFromCloud, getLocalBackupSummary, restoreFromLocalBackup } = useNotes();
  const [folderBackups, setFolderBackups] = useState<{ key: string; label: string; folderCount: number }[]>([]);
  const [dataBackups, setDataBackups] = useState<{ key: string; label: string; notes: number; quizzes: number; sets: number; folders: number; chats: number }[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [loadingDataBackups, setLoadingDataBackups] = useState(true);
  const [localBackup, setLocalBackup] = useState(() => getLocalBackupSummary());
  const [restoringLocal, setRestoringLocal] = useState(false);
  const [restoringCloudKey, setRestoringCloudKey] = useState<string | null>(null);
  const [recoverScan, setRecoverScan] = useState<RecoverableCloudSummary | null>(null);
  const [scanningRecover, setScanningRecover] = useState(false);
  const [recoveringEmergency, setRecoveringEmergency] = useState(false);
  const [storageLimitMB, setStorageLimitMB] = useState(100);
  const [filesBytes, setFilesBytes] = useState(0);

  // Profile
  const [nameInput, setNameInput] = useState(user?.displayName || '');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);

  // Profile photo
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Password
  const [passEmailSent, setPassEmailSent] = useState(false);
  const [showSetPass, setShowSetPass] = useState(false);

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || nameSaving) return;
    setNameSaving(true);
    try {
      await updateDisplayName(trimmed);
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    } finally {
      setNameSaving(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || photoUploading) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      show(t.settingsProfilePhotoInvalidType);
      return;
    }
    const preview = URL.createObjectURL(file);
    setPhotoPreview(preview);
    setPhotoUploading(true);
    try {
      await updateProfilePhoto(file);
      show(t.settingsSaved);
    } catch {
      setPhotoPreview(null);
      show(t.settingsProfilePhotoError);
    } finally {
      URL.revokeObjectURL(preview);
      setPhotoPreview(null);
      setPhotoUploading(false);
    }
  };

  const handleChangePassword = async () => {
    if (!user?.email) return;
    await resetPassword(user.email);
    setPassEmailSent(true);
    setTimeout(() => setPassEmailSent(false), 3000);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      // Delete all user data from Firebase first
      await fetch(`${FB_DB_URL}/users/${user.uid}.json`, { method: 'DELETE' });
      await deleteAccount();
    } catch {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Storage estimate
  const storage = useMemo(() => {
    const notesBytes = new TextEncoder().encode(JSON.stringify(notes)).length;
    const quizBytes = new TextEncoder().encode(JSON.stringify([...quizzes, ...quizSets, ...quizFolders])).length;
    const chatBytes = new TextEncoder().encode(JSON.stringify(chats)).length;
    const total = notesBytes + quizBytes + chatBytes + filesBytes;
    return { notesBytes, quizBytes, chatBytes, filesBytes, total };
  }, [notes, quizzes, quizSets, quizFolders, chats, filesBytes]);

  const storageCapBytes = mbToBytes(storageLimitMB);
  const pct = Math.min(100, (storage.total / storageCapBytes) * 100);
  const barColor = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-primary';

  useEffect(() => {
    let cancelled = false;
    if (!user?.uid) return;
    (async () => {
      try {
        const res = await fetch(`${FB_DB_URL}/users/${user.uid}.json`);
        const data = (await res.json()) ?? {};
        const profile = (data.profile ?? {}) as Record<string, unknown>;
        const filesData = data.files;
        let filePayload = 0;
        if (filesData) filePayload = new TextEncoder().encode(JSON.stringify(filesData)).length;
        if (!cancelled) {
          setStorageLimitMB(getStorageLimitMB(profile, user.email));
          setFilesBytes(filePayload);
        }
      } catch {
        if (!cancelled) {
          setStorageLimitMB(100);
          setFilesBytes(0);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid, user?.email]);

  useEffect(() => {
    let cancelled = false;
    setLoadingBackups(true);
    void listQuizFolderBackups()
      .then((items) => { if (!cancelled) setFolderBackups(items); })
      .finally(() => { if (!cancelled) setLoadingBackups(false); });
    return () => { cancelled = true; };
  }, [listQuizFolderBackups]);

  useEffect(() => {
    let cancelled = false;
    setLoadingDataBackups(true);
    void listDataBackups()
      .then((items) => { if (!cancelled) setDataBackups(items); })
      .finally(() => { if (!cancelled) setLoadingDataBackups(false); });
    return () => { cancelled = true; };
  }, [listDataBackups]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setScanningRecover(true);
    void scanRecoverableCloud()
      .then((summary) => { if (!cancelled) setRecoverScan(summary); })
      .finally(() => { if (!cancelled) setScanningRecover(false); });
    return () => { cancelled = true; };
  }, [loaded, scanRecoverableCloud, notes.length, quizzes.length]);

  useEffect(() => {
    setLocalBackup(getLocalBackupSummary());
  }, [notes, quizzes, quizSets, quizFolders, chats]); // eslint-disable-line react-hooks/exhaustive-deps

  const avatar = (user?.displayName || user?.email || '?').charAt(0).toUpperCase();
  const photoUrl = photoPreview || profilePhotoURL;
  const isAdmin = user?.email === ADMIN_EMAIL;
  const showPlusProfile = isPlus || isAdmin;
  const recoverTotal = recoverScan
    ? recoverScan.totalRecoverable.notes
      + recoverScan.totalRecoverable.quizzes
      + recoverScan.totalRecoverable.sets
      + recoverScan.totalRecoverable.folders
      + recoverScan.totalRecoverable.chats
    : 0;

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6 sm:px-6">
      <h1 className="text-lg font-bold text-app-text dark:text-gray-100">{t.settingsTitle}</h1>

      <SectionCard title={t.settingsEmergencyRecovery}>
        <p className="mb-3 text-sm text-app-text-secondary dark:text-gray-400">{t.settingsEmergencyRecoverySub}</p>
        {scanningRecover ? (
          <p className="text-sm text-app-text-secondary dark:text-gray-400">…</p>
        ) : recoverScan ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 text-xs text-app-text-secondary dark:border-white/10 dark:bg-white/5 dark:text-gray-400">
              <p>{lang === 'sv' ? 'Molnet' : 'Cloud'}: {recoverScan.sources.cloud.notes} notes · {recoverScan.sources.cloud.quizzes} quiz · {recoverScan.sources.cloud.sets} sets</p>
              <p>{lang === 'sv' ? 'Backup' : 'Backup'}: {recoverScan.sources.dataHistoryBest.notes} notes · {recoverScan.sources.dataHistoryBest.sets} sets</p>
              <p>{lang === 'sv' ? 'Utkast' : 'Drafts'}: {recoverScan.sources.drafts} · {lang === 'sv' ? 'AI-chatt' : 'AI chat'}: {recoverScan.sources.chatUserMessages} msgs · {lang === 'sv' ? 'Mapp-backups' : 'Folder backups'}: {recoverScan.sources.folderHistoryKeys}</p>
              <p className="mt-1 font-medium text-app-text dark:text-gray-200">
                {t.settingsCloudBackupCounts
                  .replace('{notes}', String(recoverScan.totalRecoverable.notes))
                  .replace('{quizzes}', String(recoverScan.totalRecoverable.quizzes))
                  .replace('{folders}', String(recoverScan.totalRecoverable.folders))
                  .replace('{sets}', String(recoverScan.totalRecoverable.sets))
                  .replace('{chats}', String(recoverScan.totalRecoverable.chats))}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={scanningRecover}
                onClick={() => {
                  setScanningRecover(true);
                  void scanRecoverableCloud()
                    .then(setRecoverScan)
                    .finally(() => setScanningRecover(false));
                }}
                className="rounded-lg border border-app-border px-3 py-1.5 text-xs font-semibold text-app-text-secondary hover:bg-app-bg dark:border-white/15 dark:text-gray-300"
              >
                {t.settingsEmergencyRecoveryScan}
              </button>
              <button
                type="button"
                disabled={recoveringEmergency || recoverTotal === 0}
                onClick={() => {
                  setRecoveringEmergency(true);
                  void emergencyRecoverFromCloud()
                    .then((counts) => {
                      const total = counts.notes + counts.quizzes + counts.folders + counts.sets + counts.chats;
                      show(total > 0 ? t.settingsEmergencyRecoveryRestored : t.settingsEmergencyRecoveryEmpty);
                      return scanRecoverableCloud();
                    })
                    .then(setRecoverScan)
                    .finally(() => setRecoveringEmergency(false));
                }}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {recoveringEmergency ? '…' : t.settingsEmergencyRecoveryRestore}
              </button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      {/* Profile */}
      <SectionCard title={t.settingsProfile}>
        <div className={'mb-5 flex items-center gap-4 rounded-2xl p-3 ' + (showPlusProfile ? 'bg-gradient-to-r from-violet-50 to-amber-50/60 dark:from-violet-500/10 dark:to-amber-500/5' : '')}>
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={photoUploading}
              title={photoUrl ? t.settingsProfilePhotoChange : t.settingsProfilePhotoUpload}
              aria-label={photoUrl ? t.settingsProfilePhotoChange : t.settingsProfilePhotoUpload}
              className={
                'group relative flex h-14 w-14 items-center justify-center overflow-hidden rounded-full text-xl font-bold text-white shadow-lg transition hover:ring-2 hover:ring-primary/40 disabled:opacity-70 ' +
                (showPlusProfile ? 'bg-gradient-to-br from-violet-500 via-primary to-amber-400 shadow-violet-400/30' : 'bg-gradient-to-br from-primary to-[#8A82FF] shadow-primary/30')
              }
            >
              {photoUrl ? (
                <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                avatar
              )}
              {photoUploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-semibold">
                  …
                </span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-primary opacity-0 shadow-sm transition group-hover:opacity-100">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </span>
              </span>
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(e) => { void handlePhotoSelect(e); }}
            />
            {showPlusProfile && (
              <span className="pointer-events-none absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-amber-400 text-[10px] dark:border-gray-900">✦</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-semibold text-app-text dark:text-gray-100">
                {user?.displayName || user?.email?.split('@')[0]}
              </p>
              {isAdmin && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">ADMIN</span>
              )}
              {showPlusProfile && (
                <span className="rounded-full bg-gradient-to-r from-violet-600 to-primary px-2 py-0.5 text-[9px] font-bold text-white">PLUS</span>
              )}
            </div>
            <p className="truncate text-xs text-app-text-secondary dark:text-gray-400">{user?.email}</p>
            {showPlusProfile && (
              <p className="mt-0.5 text-[11px] font-medium text-violet-600 dark:text-violet-300">{t.settingsPlanPlus}</p>
            )}
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-app-text-secondary dark:text-gray-400">
              {t.settingsProfileName}
            </label>
            <div className="flex gap-2">
              <input
                value={nameInput}
                onChange={(e) => { setNameInput(e.target.value); setNameSaved(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
                placeholder={user?.displayName || user?.email?.split('@')[0] || ''}
                className="flex-1 rounded-xl border border-app-border bg-app-bg px-3.5 py-2 text-sm text-app-text outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />
              <button
                onClick={handleSaveName}
                disabled={nameSaving || !nameInput.trim()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-40"
              >
                {nameSaved ? t.settingsSaved : nameSaving ? '...' : t.settingsSave}
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-app-text-secondary dark:text-gray-400">
              {t.settingsProfileEmail}
            </label>
            <input
              value={user?.email || ''}
              readOnly
              className="w-full rounded-xl border border-app-border bg-gray-50 px-3.5 py-2 text-sm text-app-text-secondary outline-none dark:border-white/10 dark:bg-white/5 dark:text-gray-400"
            />
          </div>
        </div>
      </SectionCard>

      {/* Password */}
      <SectionCard title={t.settingsPassword}>
        {hasPassword ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-app-text dark:text-gray-100">••••••••</p>
              <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                {t.settingsPasswordSet}
              </p>
            </div>
            <button
              onClick={handleChangePassword}
              className="rounded-xl border border-app-border px-4 py-2 text-sm font-medium text-app-text transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-200"
            >
              {passEmailSent ? t.settingsPassEmailSent : t.settingsChangePass}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-app-text dark:text-gray-100">
                {t.settingsNoPassword}
              </p>
              <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                {t.settingsNoPasswordSub}
              </p>
            </div>
            <button
              onClick={() => setShowSetPass(true)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              {t.settingsCreatePassword}
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t.settingsPlan}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-app-text dark:text-gray-100">
              {isPlus ? t.settingsPlanPlus : t.settingsPlanFree}
            </p>
            <p className="mt-1 text-[13px] text-app-text-secondary dark:text-gray-400">
              {isPlus ? t.plusFeatureAi : t.settingsPlanFreeSub}
            </p>
          </div>
          {isPlus && (
            <span className="rounded-full bg-violet-100 px-3 py-1 text-[11px] font-bold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">PLUS</span>
          )}
        </div>
        {!hasAi && (
          <p className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300">
            {t.plusAiLocked}
          </p>
        )}
      </SectionCard>

      {/* Storage */}
      <SectionCard title={t.settingsStorage}>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-app-text-secondary dark:text-gray-400">{t.settingsStorageTotal}</span>
            <span className="font-semibold text-app-text dark:text-gray-100">
              {formatBytes(storage.total)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
            <div
              className={'h-full rounded-full transition-all ' + barColor}
              style={{ width: pct.toFixed(1) + '%' }}
            />
          </div>
          <p className="text-right text-[11px] text-app-text-secondary/60 dark:text-gray-500">
            {formatBytes(storage.total)} / {storageLimitMB} MB
          </p>
          <div className="mt-1 space-y-2 border-t border-app-border pt-3 dark:border-white/10">
            {[
              { label: t.settingsStorageNotes, bytes: storage.notesBytes, icon: '📝' },
              { label: t.settingsStorageQuiz, bytes: storage.quizBytes, icon: '🧠' },
              { label: t.settingsStorageFiles, bytes: storage.filesBytes, icon: '📎' },
            ].map(({ label, bytes, icon }) => (
              <div key={label} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-2 text-app-text-secondary dark:text-gray-400">
                  <span>{icon}</span>
                  <span>{label}</span>
                </span>
                <span className="font-medium text-app-text dark:text-gray-200">{formatBytes(bytes)}</span>
              </div>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard title={t.settingsCloudBackup}>
        {loadingDataBackups ? (
          <p className="text-sm text-app-text-secondary dark:text-gray-400">…</p>
        ) : dataBackups.length === 0 ? (
          <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.settingsCloudBackupEmpty}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dataBackups.slice(0, 8).map((backup) => (
              <div key={backup.key} className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 dark:border-primary/30 dark:bg-primary/10">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-app-text dark:text-gray-100">{backup.label}</p>
                  <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                    {t.settingsCloudBackupCounts
                      .replace('{notes}', String(backup.notes))
                      .replace('{quizzes}', String(backup.quizzes))
                      .replace('{folders}', String(backup.folders))
                      .replace('{sets}', String(backup.sets))
                      .replace('{chats}', String(backup.chats))}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={restoringCloudKey === backup.key}
                  onClick={() => {
                    setRestoringCloudKey(backup.key);
                    void restoreDataBackup(backup.key)
                      .then((counts) => {
                        const total = counts.notes + counts.quizzes + counts.folders + counts.sets + counts.chats;
                        show(total > 0 ? t.settingsCloudBackupRestored : t.settingsCloudBackupEmpty);
                      })
                      .finally(() => setRestoringCloudKey(null));
                  }}
                  className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
                >
                  {restoringCloudKey === backup.key ? '…' : t.settingsCloudBackupRestore}
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title={t.settingsFolderBackup}>
        {loadingBackups ? (
          <p className="text-sm text-app-text-secondary dark:text-gray-400">…</p>
        ) : folderBackups.length === 0 ? (
          <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-app-text-secondary dark:text-gray-400">
              {t.settingsFolderBackupLast}
            </p>
            <p className="mt-0.5 text-sm text-app-text-secondary dark:text-gray-400">{t.settingsFolderBackupEmpty}</p>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-app-text-secondary dark:text-gray-400">
                {t.settingsFolderBackupLast}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-app-text dark:text-gray-100">
                {new Date(Number(folderBackups[0].key)).toLocaleString(t.dateLocale)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void restoreQuizFolderBackup(folderBackups[0].key).then((count) => {
                  show(count > 0 ? `${t.settingsFolderBackupRestored} (${count})` : t.settingsFolderBackupRestored);
                });
              }}
              className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
            >
              {t.settingsFolderBackupRestore}
            </button>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t.settingsLocalBackup}>
        {localBackup.hasData ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="min-w-0">
              <p className="text-sm font-medium text-app-text dark:text-gray-100">
                {t.settingsLocalBackupCounts
                  .replace('{notes}', String(localBackup.notes))
                  .replace('{quizzes}', String(localBackup.quizzes))
                  .replace('{folders}', String(localBackup.folders))
                  .replace('{sets}', String(localBackup.sets))
                  .replace('{chats}', String(localBackup.chats))}
              </p>
              <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                {lang === 'sv'
                  ? 'Hittat i den här webbläsarens lagring — kan återställas till molnet.'
                  : 'Found in this browser’s storage — can be pushed back to the cloud.'}
              </p>
            </div>
            <button
              type="button"
              disabled={restoringLocal}
              onClick={() => {
                setRestoringLocal(true);
                void restoreFromLocalBackup()
                  .then((counts) => {
                    setLocalBackup(getLocalBackupSummary());
                    const total = counts.notes + counts.quizzes + counts.folders + counts.sets + counts.chats;
                    show(total > 0 ? t.settingsLocalBackupRestored : t.settingsLocalBackupEmpty);
                  })
                  .finally(() => setRestoringLocal(false));
              }}
              className="flex-shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {restoringLocal ? '…' : t.settingsLocalBackupRestore}
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-app-border bg-app-bg/50 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.settingsLocalBackupEmpty}</p>
          </div>
        )}
      </SectionCard>

      {/* Danger Zone */}
      <div className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm dark:border-red-500/20 dark:bg-gray-900">
        <div className="border-b border-red-200 px-5 py-3.5 dark:border-red-500/20">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-red-500">
            {t.settingsDanger}
          </h2>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-app-text dark:text-gray-100">{t.settingsDeleteAccount}</p>
              <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                {lang === 'sv' ? 'Raderar kontot och all data permanent' : 'Permanently deletes account and all data'}
              </p>
            </div>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-500 transition hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
            >
              {t.settingsDeleteAccount}
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 text-2xl dark:bg-red-500/10">
              🗑️
            </div>
            <h2 className="mb-2 text-lg font-bold text-app-text dark:text-gray-100">
              {t.settingsDeleteConfirmTitle}
            </h2>
            <p className="mb-6 text-sm text-app-text-secondary dark:text-gray-400">
              {t.settingsDeleteConfirmSub}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="w-full rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:opacity-60"
              >
                {deleting ? t.settingsDeleting : t.settingsDeleteConfirmBtn}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="w-full rounded-xl border border-app-border py-3 text-sm font-semibold text-app-text transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                {lang === 'sv' ? 'Avbryt' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSetPass && <SetPasswordModal onClose={() => setShowSetPass(false)} />}
    </div>
  );
}
