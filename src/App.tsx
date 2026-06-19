import { useState } from 'react';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NotesProvider } from './contexts/NotesContext';
import { ToastProvider } from './contexts/ToastContext';
import { AuthPage } from './components/auth/AuthPage';
import { ResetPasswordPage } from './components/auth/ResetPasswordPage';
import { BootLoader } from './components/common/BootLoader';
import { ImageLightbox } from './components/common/ImageLightbox';
import { Dashboard } from './components/Dashboard';

function getResetCode(): string | null {
  const p = new URLSearchParams(window.location.search);
  return p.get('mode') === 'resetPassword' ? p.get('oobCode') : null;
}

function Root() {
  const { user, loading } = useAuth();
  const [resetCode, setResetCode] = useState<string | null>(getResetCode);

  if (resetCode) {
    return (
      <ResetPasswordPage
        oobCode={resetCode}
        onDone={() => {
          window.history.replaceState({}, '', window.location.origin);
          setResetCode(null);
        }}
      />
    );
  }

  if (loading) return <BootLoader />;

  if (!user) return <AuthPage />;

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
