import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import type { Lang } from '../../types';
import { Logo } from '../common/Logo';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { AuthBackground } from './AuthBackground';
import { AuthCard } from './AuthCard';

export function ResetPasswordPage({ oobCode, onDone }: { oobCode: string; onDone: () => void }) {
  const { verifyResetCode, confirmReset } = useAuth();
  const { t, setLang } = useLanguage();
  const [email, setEmail] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const requestedLang = new URLSearchParams(window.location.search).get('lang');
    if (requestedLang === 'en' || requestedLang === 'sv') setLang(requestedLang as Lang);
  }, [setLang]);

  useEffect(() => {
    let active = true;
    verifyResetCode(oobCode)
      .then((accountEmail) => {
        if (active) setEmail(accountEmail);
      })
      .catch(() => {
        if (active) setInvalid(true);
      });
    return () => {
      active = false;
    };
  }, [oobCode, verifyResetCode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
    } catch {
      setError(t.resetpassErrExpired);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full border-0 bg-transparent px-4 pb-3 pt-1 text-[15px] font-medium text-app-text outline-none placeholder:text-gray-400 dark:text-white';

  return (
    <main dir="ltr" className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
      <AuthBackground />
      <LanguageSwitcher className="fixed left-5 top-5 z-20" />

      <AuthCard className="max-w-[500px] p-6 sm:p-10">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Logo size={48} />
          <span className="brand-wordmark text-[1.7rem]">{t.appName}</span>
        </div>

        {!done && (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary shadow-[0_12px_35px_rgba(108,99,255,0.18)] dark:border-primary/30 dark:bg-primary/15">
              <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <rect x="4" y="10" width="16" height="11" rx="3" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
              </svg>
            </div>
            <p className="mb-2 text-[11px] font-extrabold text-primary">{t.resetpassEyebrow}</p>
            <h1 className="text-[1.75rem] font-extrabold leading-tight text-app-text dark:text-white">{t.resetpassTitle}</h1>
            <p className="mx-auto mt-3 max-w-[360px] text-sm leading-6 text-app-text-secondary dark:text-gray-400">{t.resetpassSubtitle}</p>
          </div>
        )}

        {!email && !invalid && !done && (
          <div className="mt-8 flex items-center justify-center gap-3 border-t border-app-border pt-6 text-sm font-medium text-app-text-secondary dark:border-white/10 dark:text-gray-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            {t.resetpassChecking}
          </div>
        )}

        {invalid && (
          <div className="mt-8 text-center">
            <div className="border-y border-red-200 bg-red-50/70 px-4 py-5 dark:border-red-500/20 dark:bg-red-500/5">
              <p className="text-sm font-semibold leading-6 text-red-600 dark:text-red-400">{t.resetpassErrInvalid}</p>
            </div>
            <button type="button" onClick={onDone} className="mt-5 w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary-dark">
              {t.resetpassRequestNew}
            </button>
          </div>
        )}

        {!invalid && !done && email && (
          <form onSubmit={submit} className="mt-7">
            <div className="mb-5 flex items-center justify-center gap-2 rounded-xl bg-app-bg/70 px-3 py-2 text-center text-xs text-app-text-secondary dark:bg-white/5 dark:text-gray-400">
              <span>{t.resetpassFor}</span>
              <strong className="max-w-[240px] truncate text-app-text dark:text-gray-200">{email}</strong>
            </div>

            <div className="space-y-3.5">
              <label className="block rounded-xl border border-app-border bg-white/60 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/10 dark:bg-white/5">
                <span className="block px-4 pt-3 text-[11px] font-bold text-app-text-secondary dark:text-gray-400">{t.resetpassNewLabel}</span>
                <span className="flex items-center">
                  <input
                    autoFocus
                    type={showPass ? 'text' : 'password'}
                    value={pass}
                    onChange={(event) => setPass(event.target.value)}
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <button type="button" onClick={() => setShowPass((value) => !value)} className="mr-3 shrink-0 px-1 py-2 text-xs font-bold text-primary hover:text-primary-dark">
                    {showPass ? t.resetpassHide : t.resetpassShow}
                  </button>
                </span>
              </label>

              <label className="block rounded-xl border border-app-border bg-white/60 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 dark:border-white/10 dark:bg-white/5">
                <span className="block px-4 pt-3 text-[11px] font-bold text-app-text-secondary dark:text-gray-400">{t.resetpassConfirmLabel}</span>
                <span className="flex items-center">
                  <input
                    type={showPass2 ? 'text' : 'password'}
                    value={pass2}
                    onChange={(event) => setPass2(event.target.value)}
                    autoComplete="new-password"
                    className={inputClass}
                  />
                  <button type="button" onClick={() => setShowPass2((value) => !value)} className="mr-3 shrink-0 px-1 py-2 text-xs font-bold text-primary hover:text-primary-dark">
                    {showPass2 ? t.resetpassHide : t.resetpassShow}
                  </button>
                </span>
              </label>
            </div>

            <div className="mt-2 flex min-h-6 items-center px-1">
              <p className={'text-xs font-medium ' + (error ? 'text-red-600 dark:text-red-400' : 'text-app-text-secondary dark:text-gray-500')}>
                {error || t.resetpassHint}
              </p>
            </div>

            <button type="submit" disabled={loading} className="mt-2 flex w-full items-center justify-center rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition hover:-translate-y-0.5 hover:bg-primary-dark disabled:translate-y-0 disabled:cursor-wait disabled:opacity-65">
              {loading ? t.resetpassSaving : t.setpassBtn}
            </button>
            <button type="button" onClick={onDone} className="mt-4 w-full py-1 text-center text-xs font-bold text-app-text-secondary transition hover:text-primary dark:text-gray-400">
              {t.resetpassBack}
            </button>
          </form>
        )}

        {done && (
          <div className="py-4 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            </div>
            <p className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{t.resetpassOk}</p>
            <h1 className="mt-2 text-2xl font-extrabold text-app-text dark:text-white">{t.resetpassSuccessTitle}</h1>
            <p className="mx-auto mt-3 max-w-[350px] text-sm leading-6 text-app-text-secondary dark:text-gray-400">{t.resetpassSuccessSub}</p>
            <button type="button" onClick={onDone} className="mt-7 w-full rounded-xl bg-primary py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary-dark">
              {t.resetpassBack}
            </button>
          </div>
        )}
      </AuthCard>
    </main>
  );
}
