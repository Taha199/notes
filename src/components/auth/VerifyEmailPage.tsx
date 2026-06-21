import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { AuthBackground } from './AuthBackground';
import { AuthCard } from './AuthCard';
import { Logo } from '../common/Logo';

export function VerifyEmailPage() {
  const { user, signOut, sendVerification, reloadUser, deleteAccount } = useAuth();
  const { t } = useLanguage();
  const [resent, setResent] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleResend = async () => {
    try {
      await sendVerification();
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch { /* ignore */ }
  };

  const handleCheck = async () => {
    setChecking(true);
    try {
      await reloadUser();
    } finally {
      setChecking(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await deleteAccount();
    } catch {
      await signOut();
    }
  };

  return (
    <div dir="ltr" className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <AuthBackground />
      <AuthCard>
        <div className="flex flex-col items-center gap-4 text-center">
          <Logo size={56} rounded={14} />
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-3xl">
            ✉️
          </div>
          <h1 className="text-xl font-bold text-app-text dark:text-white">{t.verifyTitle}</h1>
          <p className="text-sm text-app-text-secondary dark:text-gray-400">
            {t.verifySub}{' '}
            <strong className="text-app-text dark:text-gray-200">{user?.email}</strong>
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-3">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-dark py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60"
          >
            {checking ? t.verifyCheck : t.verifyDone}
          </button>
          <button
            onClick={handleResend}
            className="w-full rounded-xl border border-app-border py-3 text-sm font-semibold text-app-text transition hover:border-primary/40 hover:bg-primary/5 hover:text-primary dark:border-white/10 dark:text-gray-200"
          >
            {resent ? t.verifyResent : t.verifyResend}
          </button>
          <button
            onClick={signOut}
            className="text-center text-xs font-medium text-app-text-secondary/60 transition hover:text-app-text dark:text-gray-500"
          >
            {t.signOut}
          </button>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-center text-xs font-medium text-red-400/70 transition hover:text-red-500 disabled:opacity-50 dark:text-red-400/50"
          >
            {cancelling ? '...' : t.verifyCancel}
          </button>
        </div>
      </AuthCard>
    </div>
  );
}
