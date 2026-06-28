import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useNotes } from '../../contexts/NotesContext';
import { useToast } from '../../contexts/ToastContext';
import { SetPasswordModal } from '../auth/SetPasswordModal';
import { FB_DB_URL } from '../../lib/firebase';
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
  const { user, hasPassword, isPlus, hasAi, updateDisplayName, resetPassword, deleteAccount } = useAuth();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { notes, quizzes, quizSets, quizFolders, chats, tokenUsage, resetTokens, listQuizFolderBackups, restoreQuizFolderBackup } = useNotes();
  const [folderBackups, setFolderBackups] = useState<{ key: string; label: string; folderCount: number }[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);
  const [storageLimitMB, setStorageLimitMB] = useState(100);
  const [filesBytes, setFilesBytes] = useState(0);

  // Profile
  const [nameInput, setNameInput] = useState(user?.displayName || '');
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);

  // Password
  const [passEmailSent, setPassEmailSent] = useState(false);
  const [showSetPass, setShowSetPass] = useState(false);

  // Tokens reset
  const [tokensReset, setTokensReset] = useState(false);

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

  const handleResetTokens = () => {
    resetTokens();
    setTokensReset(true);
    setTimeout(() => setTokensReset(false), 2500);
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

  const avatar = (user?.displayName || user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6 sm:px-6">
      <h1 className="text-lg font-bold text-app-text dark:text-gray-100">{t.settingsTitle}</h1>

      {/* Profile */}
      <SectionCard title={t.settingsProfile}>
        <div className="flex items-center gap-4 mb-5">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#8A82FF] text-xl font-bold text-white shadow-lg shadow-primary/30">
            {avatar}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-app-text dark:text-gray-100">
              {user?.displayName || user?.email?.split('@')[0]}
            </p>
            <p className="truncate text-xs text-app-text-secondary dark:text-gray-400">{user?.email}</p>
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
                {lang === 'sv' ? 'Lösenord är aktiverat' : 'Password is set'}
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
                {lang === 'sv' ? 'Inget lösenord inställt' : 'No password set'}
              </p>
              <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
                {lang === 'sv'
                  ? 'Kontot använder endast Google-inloggning'
                  : 'Account uses Google sign-in only'}
              </p>
            </div>
            <button
              onClick={() => setShowSetPass(true)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90"
            >
              {t.settingsSetPass}
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
              { label: t.settingsStorageChat, bytes: storage.chatBytes, icon: '💬' },
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

      <SectionCard title={t.settingsFolderBackup}>
        {loadingBackups ? (
          <p className="text-sm text-app-text-secondary dark:text-gray-400">…</p>
        ) : folderBackups.length === 0 ? (
          <p className="text-sm text-app-text-secondary dark:text-gray-400">{t.settingsFolderBackupEmpty}</p>
        ) : (
          <div className="space-y-2">
            {folderBackups.map((backup) => (
              <div key={backup.key} className="flex items-center justify-between gap-3 rounded-xl border border-app-border px-3 py-2 dark:border-white/10">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-app-text dark:text-gray-100">{backup.label}</p>
                  <p className="text-[11px] text-app-text-secondary dark:text-gray-400">{backup.folderCount} {lang === 'sv' ? 'mappar' : 'folders'}</p>
                </div>
                <button
                  onClick={() => {
                    void restoreQuizFolderBackup(backup.key).then((count) => {
                      show(count > 0 ? `${t.settingsFolderBackupRestored} (${count})` : t.settingsFolderBackupRestored);
                    });
                  }}
                  className="flex-shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                >
                  {t.settingsFolderBackupRestore}
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* AI Token Usage */}
      <SectionCard title={t.settingsAIUsage}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] text-app-text-secondary dark:text-gray-400">{t.settingsTokensUsed}</p>
            <p className="mt-0.5 text-2xl font-bold text-app-text dark:text-gray-100">
              {tokenUsage.toLocaleString()}
            </p>
          </div>
          <button
            onClick={handleResetTokens}
            className="rounded-xl border border-app-border px-4 py-2 text-sm font-medium text-app-text-secondary transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-white/10 dark:text-gray-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            {tokensReset ? t.settingsTokensReset : t.settingsResetTokens}
          </button>
        </div>
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
