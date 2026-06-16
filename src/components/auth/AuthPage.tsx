import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { AuthBackground } from './AuthBackground';
import { AuthCard } from './AuthCard';
import { FeatureCards } from './FeatureCards';
import { FooterCredit } from './FooterCredit';
import { GoogleIcon } from './GoogleIcon';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { Logo } from '../common/Logo';

type Mode = 'login' | 'signup';

const ERROR_KEYS: Record<string, string> = {
  'auth/user-not-found': 'authErrNotFound',
  'auth/wrong-password': 'authErrWrongPass',
  'auth/email-already-in-use': 'authErrInUse',
  'auth/invalid-email': 'authErrInvalidEmail',
  'auth/too-many-requests': 'authErrTooMany',
  'auth/invalid-credential': 'authErrInvalidCred',
};

export function AuthPage() {
  const { signIn, signUp, signInGoogle, resetPassword } = useAuth();
  const { t } = useLanguage();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!email || !password) {
      setError(t.authErrRequired);
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (password !== password2) {
          setError(t.setpassErrMatch);
          setLoading(false);
          return;
        }
        if (password.length < 6) {
          setError(t.setpassErrShort);
          setLoading(false);
          return;
        }
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      const key = ERROR_KEYS[code];
      setError(key ? (t as unknown as Record<string, string>)[key] : (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    try {
      await signInGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user') setError(t.authErrGoogle);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setSuccess(null);
    if (!email) {
      setError(t.authErrNeedEmail);
      return;
    }
    try {
      await resetPassword(email);
      setSuccess(t.authResetSent);
    } catch {
      setError(t.authErrSendFail);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <AuthBackground />
      <LanguageSwitcher className="fixed top-5 right-5 z-20" />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-16 lg:px-10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-14 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          {/* Marketing column — desktop only */}
          <div className="hidden w-full max-w-[480px] flex-col lg:flex">
            <div className="animate-fade-in mb-9 flex items-center gap-3">
              <Logo size={38} rounded={11} />
              <span className="text-lg font-bold tracking-tight text-app-text dark:text-white">{t.appName}</span>
            </div>
            <h1 className="animate-fade-in text-[2.65rem] font-extrabold leading-[1.12] tracking-tight text-app-text dark:text-white" style={{ animationDelay: '0.05s' }}>
              {t.marketingTitle}
            </h1>
            <p className="animate-fade-in mt-5 max-w-[420px] text-[15px] leading-relaxed text-app-text-secondary dark:text-gray-400" style={{ animationDelay: '0.1s' }}>
              {t.marketingDesc}
            </p>
            <div className="mt-10">
              <FeatureCards align="start" />
            </div>
          </div>

          {/* Auth card column */}
          <div className="flex w-full flex-col items-center lg:w-auto">
            <AuthCard>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="rounded-2xl shadow-lg shadow-primary/30">
                  <Logo size={64} rounded={18} />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-app-text dark:text-white">{t.appName}</h1>
                <p className="max-w-[300px] text-sm text-app-text-secondary dark:text-gray-400">{t.appSubtitle}</p>
              </div>

              {/* Pill tabs */}
              <div className="relative mt-7 grid grid-cols-2 rounded-2xl bg-app-bg p-1 dark:bg-white/5">
                <div
                  className="absolute inset-y-1 w-[calc(50%-4px)] rounded-xl bg-white shadow-md transition-transform duration-300 ease-out dark:bg-gray-800"
                  style={{ transform: mode === 'login' ? 'translateX(4px)' : 'translateX(calc(100% + 4px))' }}
                />
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className={'relative z-10 rounded-xl py-2.5 text-sm font-semibold transition-colors ' + (mode === 'login' ? 'text-primary' : 'text-app-text-secondary')}
                >
                  {t.authLogin}
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className={'relative z-10 rounded-xl py-2.5 text-sm font-semibold transition-colors ' + (mode === 'signup' ? 'text-primary' : 'text-app-text-secondary')}
                >
                  {t.authSignup}
                </button>
              </div>

              {error && (
                <div className="mt-5 animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-sm font-medium text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                  {error}
                </div>
              )}
              {success && (
                <div className="mt-5 animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-center text-sm font-medium text-emerald-600 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                  {success}
                </div>
              )}

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3.5">
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-app-text-secondary/70">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z" stroke="none" /><path d="M22 6l-10 7L2 6" /><rect x="2" y="4" width="20" height="16" rx="3" /></svg>
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t.authEmailPh}
                    autoComplete="email"
                    className="w-full rounded-xl border border-app-border bg-app-bg/60 py-3 pl-11 pr-4 text-sm text-app-text outline-none transition-all duration-200 placeholder:text-gray-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:focus:bg-gray-800"
                  />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-app-text-secondary/70">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t.authPassPh}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="w-full rounded-xl border border-app-border bg-app-bg/60 py-3 pl-11 pr-4 text-sm text-app-text outline-none transition-all duration-200 placeholder:text-gray-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:focus:bg-gray-800"
                  />
                </div>
                {mode === 'signup' && (
                  <div className="relative animate-fade-in">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-app-text-secondary/70">
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    </span>
                    <input
                      type="password"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      placeholder={t.authPass2Ph}
                      autoComplete="new-password"
                      className="w-full rounded-xl border border-app-border bg-app-bg/60 py-3 pl-11 pr-4 text-sm text-app-text outline-none transition-all duration-200 placeholder:text-gray-400 focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:focus:bg-gray-800"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="mt-1.5 w-full rounded-xl bg-gradient-to-r from-primary to-primary-dark py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/30 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/50 active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white align-middle" />
                  ) : mode === 'login' ? (
                    t.authLoginBtn
                  ) : (
                    t.authSignupBtn
                  )}
                </button>

                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={handleForgot}
                    className="text-center text-xs font-semibold text-primary transition-opacity hover:opacity-70"
                  >
                    {t.authForgot}
                  </button>
                )}
              </form>

              <div className="my-6 flex items-center gap-3 text-xs font-medium text-gray-400">
                <span className="h-px flex-1 bg-app-border dark:bg-white/10" />
                {t.authOr}
                <span className="h-px flex-1 bg-app-border dark:bg-white/10" />
              </div>

              <button
                onClick={handleGoogle}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-app-border bg-white py-3.5 text-sm font-semibold text-app-text shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              >
                <GoogleIcon />
                {t.authGoogle}
              </button>
            </AuthCard>

            {/* Mobile/tablet: feature cards under the card since marketing column is hidden */}
            <div className="mt-8 w-full max-w-[460px] lg:hidden">
              <FeatureCards />
            </div>
          </div>
        </div>
      </div>

      <FooterCredit />
    </div>
  );
}
