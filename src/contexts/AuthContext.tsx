import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  sendPasswordResetEmail,
  confirmPasswordReset as fbConfirmPasswordReset,
  verifyPasswordResetCode as fbVerifyPasswordResetCode,
  linkWithCredential,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, EmailAuthProvider } from '../lib/firebase';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  hasPassword: boolean;
  signIn: (email: string, pass: string) => Promise<void>;
  signUp: (email: string, pass: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  verifyResetCode: (code: string) => Promise<string>;
  confirmReset: (code: string, newPass: string) => Promise<void>;
  setPasswordForAccount: (pass: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setHasPassword(!!u?.providerData.some((p) => p.providerId === 'password'));
      setLoading(false);
    });
    return unsub;
  }, []);

  const value: AuthCtx = {
    user,
    loading,
    hasPassword,
    signIn: async (email, pass) => {
      await signInWithEmailAndPassword(auth, email, pass);
    },
    signUp: async (email, pass) => {
      await createUserWithEmailAndPassword(auth, email, pass);
    },
    signInGoogle: async () => {
      await signInWithPopup(auth, googleProvider);
    },
    signOut: async () => {
      await fbSignOut(auth);
    },
    resetPassword: async (email) => {
      const language = document.documentElement.lang === 'en' ? 'en' : 'sv';
      auth.languageCode = language;
      const continueUrl = new URL('/', window.location.origin);
      continueUrl.searchParams.set('lang', language);
      await sendPasswordResetEmail(auth, email, {
        url: continueUrl.toString(),
        handleCodeInApp: true,
      });
    },
    verifyResetCode: async (code) => fbVerifyPasswordResetCode(auth, code),
    confirmReset: async (code, newPass) => {
      await fbConfirmPasswordReset(auth, code, newPass);
    },
    setPasswordForAccount: async (pass) => {
      if (!auth.currentUser?.email) throw new Error('no-email');
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
      await linkWithCredential(auth.currentUser, cred);
      setHasPassword(true);
    },
    updateDisplayName: async (name) => {
      if (!auth.currentUser) throw new Error('no-user');
      await updateProfile(auth.currentUser, { displayName: name });
      setUser({ ...auth.currentUser });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
