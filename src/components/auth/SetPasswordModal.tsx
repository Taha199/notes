import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

export function SetPasswordModal({ onClose }: { onClose: () => void }) {
  const { setPasswordForAccount } = useAuth();
  const { t } = useLanguage();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

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
      await setPasswordForAccount(pass);
      setSuccess(true);
      setTimeout(onClose, 1200);
    } catch (err) {
      const code = (err as { code?: string }).code;
      setError(code === 'auth/requires-recent-login' ? t.setpassErrRelogin : t.setpassErrGeneric);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && onClose()} className="animate-fade-in fixed inset-0 z-[350] flex items-center justify-center bg-gray-900/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[380px] animate-slide-up rounded-3xl border border-white/80 bg-white p-9 shadow-2xl dark:border-white/10 dark:bg-gray-900">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[#8A82FF] text-white shadow-lg shadow-primary/30">
            🔑
          </div>
          <h2 className="text-lg font-bold text-app-text dark:text-white">{t.setpassTitle}</h2>
          <p className="text-[13px] text-app-text-secondary dark:text-gray-400">{t.setpassSub}</p>
        </div>
        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-medium text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            {t.setpassOk}
          </div>
        )}
        {!success && (
          <div className="mt-5 flex flex-col gap-3">
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              placeholder={t.setpassPassPh}
              autoComplete="new-password"
              className="w-full rounded-xl border border-app-border bg-app-bg/60 px-4 py-3 text-sm outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
            <input
              type="password"
              value={pass2}
              onChange={(e) => setPass2(e.target.value)}
              placeholder={t.setpassPass2Ph}
              autoComplete="new-password"
              className="w-full rounded-xl border border-app-border bg-app-bg/60 px-4 py-3 text-sm outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
            />
            <button
              onClick={submit}
              disabled={loading}
              className="mt-1 w-full rounded-xl bg-gradient-to-r from-primary to-primary-dark py-3 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all hover:-translate-y-0.5 disabled:opacity-60"
            >
              {t.setpassBtn}
            </button>
            <button onClick={onClose} className="text-center text-xs font-semibold text-primary hover:opacity-70">
              {t.setpassCancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
