import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as fbSignOut,
  confirmPasswordReset as fbConfirmPasswordReset,
  verifyPasswordResetCode as fbVerifyPasswordResetCode,
  applyActionCode,
  deleteUser,
  linkWithCredential,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, EmailAuthProvider } from '../lib/firebase';

async function sendVerificationEmailDirect(email: string): Promise<void> {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'sv';
  const res = await fetch('/api/send-verification', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, lang }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Verification email failed', err);
  }
}

async function sendResetEmailDirect(email: string): Promise<void> {
  const lang = document.documentElement.lang === 'en' ? 'en' : 'sv';
  const res = await fetch('/api/request-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, lang }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'send-failed');
  }
}

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
  applyVerifyCode: (code: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
  setPasswordForAccount: (pass: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  sendVerification: () => Promise<void>;
  reloadUser: () => Promise<void>;
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
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      // Unverified accounts are treated as "not registered" — resend a fresh
      // verification email on every sign-in attempt until they verify.
      if (!cred.user.emailVerified) {
        await sendVerificationEmailDirect(email);
      }
    },
    signUp: async (email, pass) => {
      try {
        await createUserWithEmailAndPassword(auth, email, pass);
        await sendVerificationEmailDirect(email);
      } catch (e) {
        // Email belongs to an existing (likely unverified) account. If the
        // password matches, sign in and resend verification so the user can
        // retry — the account stays gated until verified.
        const code = (e as { code?: string })?.code;
        if (code === 'auth/email-already-in-use') {
          const cred = await signInWithEmailAndPassword(auth, email, pass);
          if (!cred.user.emailVerified) {
            await sendVerificationEmailDirect(email);
          }
          return;
        }
        throw e;
      }
    },
    signInGoogle: async () => {
      await signInWithPopup(auth, googleProvider);
    },
    signOut: async () => {
      await fbSignOut(auth);
    },
    resetPassword: async (email) => {
      await sendResetEmailDirect(email);
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
    sendVerification: async () => {
      if (!auth.currentUser?.email) throw new Error('no-user');
      await sendVerificationEmailDirect(auth.currentUser.email);
    },
    applyVerifyCode: async (code) => {
      await applyActionCode(auth, code);
      if (auth.currentUser) {
        await auth.currentUser.reload();
        setUser({ ...auth.currentUser });
      }
    },
    deleteAccount: async () => {
      if (!auth.currentUser) throw new Error('no-user');
      await deleteUser(auth.currentUser);
    },
    reloadUser: async () => {
      if (!auth.currentUser) return;
      await auth.currentUser.reload();
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
