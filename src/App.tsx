import { useState, useEffect } from 'react';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotesProvider } from './contexts/NotesContext';
import { TodosProvider } from './contexts/TodosContext';
import { ToastProvider } from './contexts/ToastContext';
import { ArabicInputProvider } from './contexts/ArabicInputContext';
import { CountdownsProvider } from './contexts/CountdownsContext';
import { AuthPage } from './components/auth/AuthPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { VerifyEmailPage } from './components/auth/VerifyEmailPage';
import { BootLoader } from './components/common/BootLoader';
import { ImageLightbox } from './components/common/ImageLightbox';
import { FloatingOtterSearch } from './components/common/FloatingOtterSearch';
import { Dashboard } from './components/Dashboard';
import { ArabicInputHost } from './components/keyboard/ArabicInputHost';
import { hasNotesPrefetchSettled, prefetchAllNotesLocal, prefetchNotesCatalog, prefetchQuizCatalog } from './lib/itemsStore';

function getUrlAction(): { mode: string | null; oobCode: string | null } {
  const p = new URLSearchParams(window.location.search);
  return { mode: p.get('mode'), oobCode: p.get('oobCode') };
}

function returnToSignIn() {
  window.location.replace(window.location.origin);
}

function Root() {
  const { user, loading, applyVerifyCode, blocked, signOut } = useAuth();
  const [{ mode, oobCode }] = useState(getUrlAction);
  const [verifying, setVerifying] = useState(mode === 'verifyEmail' && !!oobCode);
  const [localNotesReady, setLocalNotesReady] = useState(() => hasNotesPrefetchSettled());
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    if (mode === 'verifyEmail' && oobCode) {
      applyVerifyCode(oobCode).finally(() => {
        window.history.replaceState({}, '', window.location.pathname);
        setVerifying(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (localNotesReady) return;
    void prefetchAllNotesLocal().finally(() => setLocalNotesReady(true));
  }, [localNotesReady]);

  useEffect(() => {
    if (!user) {
      setCatalogReady(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled) setCatalogReady(true);
    }, 4000);
    void Promise.all([
      prefetchNotesCatalog(user.uid),
      prefetchQuizCatalog(user.uid),
    ]).finally(() => {
      window.clearTimeout(timer);
      if (!cancelled) setCatalogReady(true);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [user?.uid]);

  if (verifying) return <BootLoader />;

  if (mode === 'resetPassword' && oobCode) {
    return (
      <ResetPasswordPage
        oobCode={oobCode}
        onDone={returnToSignIn}
      />
    );
  }

  if (loading) return <BootLoader />;

  if (!user) return <AuthPage />;

  const needsVerification =
    !user.emailVerified &&
    user.providerData.some((p) => p.providerId === 'password');

  if (needsVerification) return <VerifyEmailPage />;

  if (blocked) {
    return (
      <div dir="ltr" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-app-bg px-6 text-center">
        <div className="text-5xl">🚫</div>
        <h1 className="text-xl font-bold text-app-text dark:text-gray-100">Ditt konto har blockerats</h1>
        <p className="max-w-sm text-sm text-app-text-secondary dark:text-gray-400">
          Kontakta administratören om du tror att detta är ett misstag.
        </p>
        <button
          onClick={signOut}
          className="rounded-xl border border-app-border px-5 py-2.5 text-sm font-semibold text-app-text-secondary transition hover:bg-app-border/30 dark:border-white/10"
        >
          Logga ut
        </button>
      </div>
    );
  }

  if (!localNotesReady || !catalogReady) return <BootLoader />;

  return (
    <NotesProvider>
      <TodosProvider>
        <CountdownsProvider>
          <ArabicInputProvider>
            <Dashboard />
            <FloatingOtterSearch />
            <ArabicInputHost />
          </ArabicInputProvider>
        </CountdownsProvider>
      </TodosProvider>
    </NotesProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <AuthProvider>
            <Root />
            <ImageLightbox />
          </AuthProvider>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
