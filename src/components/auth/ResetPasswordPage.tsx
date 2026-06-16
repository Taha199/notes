import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { AuthBackground } from './AuthBackground';
import { AuthCard } from './AuthCard';

export function ResetPasswordPage({ oobCode, onDone }: { oobCode: string; onDone: () => void }) {
  const { verifyResetCode, confirmReset } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    verifyResetCode(oobCode)
      .then(setEmail)
      .catch(() => setInvalid(true));
  }, [oobCode, verifyResetCode]);

  const submit = async () => {
    setError(null);
    if (!pass || pass.length < 6) {
      setError(t.setpassErrShort);
      return;
    }
    if (pass !== pass2) {
      setError(t.setpassErrMatch);
      return;
    }
    setLoading(true);
    try {
      await confirmReset(oobCode, pass);
      setDone(true);
      setTimeout(onDone, 1600);
    } catch {
      setError(t.resetpassErrExpired);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <AuthBackground />
      <AuthCard>
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#8A82FF] shadow-lg shadow-primary/30">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
          </div>
          <h1 className="text-xl font-bold text-app-text dark:text-white">{t.resetpassTitle}</h1>
          {email && (
            <p className="text-sm text-app-text-secondary dark:text-gray-400">
              {t.resetpassFor} <strong className="text-app-text dark:text-gray-200">{email}</strong>
            </p>
          )}
        </div>

        {invalid && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {t.resetpassErrInvalid}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}
        {done && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-medium text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            {t.resetpassOk}
          </div>
        )}

        {!invalid && !done && email && (
          <div className="mt-6 flex flex-col gap-3.5">
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={t.setpassPassPh}
              autoComplete="new-password"
              className="w-full rounded-xl border border-app-border bg-app-bg/60 px-4 py-3 text-sm outline-none transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
            <input
              type="password"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              placeholder={t.setpassPass2Ph}
              autoComplete="new-password"
              className="w-full rounded-xl border border-app-border bg-app-bg/60 px-4 py-3 text-sm outline-none transition-all focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
            <button
              onClick={submit}
              disabled={loading}
              className="mt-1 w-full rounded-xl bg-gradient-to-r from-primary to-primary-dark py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60"
            >
              {t.setpassBtn}
            </button>
            <button onClick={onDone} className="text-center text-xs font-semibold text-primary hover:opacity-70">
              {t.setpassCancel}
            </button>
          </div>
        )}
      </AuthCard>
    </div>
  );
}
