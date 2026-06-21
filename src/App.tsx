import { useState, useEffect } from 'react';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotesProvider } from './contexts/NotesContext';
import { ToastProvider } from './contexts/ToastContext';
import { AuthPage } from './components/auth/AuthPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { VerifyEmailPage } from './components/auth/VerifyEmailPage';
import { BootLoader } from './components/common/BootLoader';
import { ImageLightbox } from './components/common/ImageLightbox';
import { Dashboard } from './components/Dashboard';

function getUrlAction(): { mode: string | null; oobCode: string | null } {
  const p = new URLSearchParams(window.location.search);
  return { mode: p.get('mode'), oobCode: p.get('oobCode') };
}

function returnToSignIn() {
  window.location.replace(window.location.origin);
}

function Root() {
  const { user, loading, applyVerifyCode } = useAuth();
  const [{ mode, oobCode }] = useState(getUrlAction);
  const [verifying, setVerifying] = useState(mode === 'verifyEmail' && !!oobCode);

  useEffect(() => {
    if (mode === 'verifyEmail' && oobCode) {
      applyVerifyCode(oobCode).finally(() => {
        window.history.replaceState({}, '', window.location.pathname);
        setVerifying(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <NotesProvider>
      <Dashboard />
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
