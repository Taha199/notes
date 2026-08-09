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
  fetchSignInMethodsForEmail,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { onDisconnect, ref as dbRef, set } from 'firebase/database';
import { auth, database, googleProvider, EmailAuthProvider, FB_DB_URL, storage } from '../lib/firebase';
import { rtdbFetch } from '../lib/rtdb';
import { hasAiAccess, isPlusUser } from '../lib/userPlan';

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
    throw new Error(typeof err?.error === 'string' ? err.error : 'send-failed');
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
    console.error('Password reset email failed', err);
    throw new Error(typeof err?.error === 'string' ? err.error : 'send-failed');
  }
}

function authError(code: string): Error & { code: string } {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Best-effort provider list (may be empty when email enumeration protection is on). */
async function signInMethodsForEmail(email: string): Promise<string[]> {
  try {
    return await fetchSignInMethodsForEmail(auth, email);
  } catch {
    return [];
  }
}

const PASSWORD_SIGNIN_FAIL = new Set([
  'auth/user-not-found',
  'auth/wrong-password',
  'auth/invalid-credential',
  'auth/invalid-login-credentials',
]);

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
  blocked: boolean;
  isPlus: boolean;
  hasAi: boolean;
  profileLoading: boolean;
  setPasswordForAccount: (pass: string) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  updateProfilePhoto: (file: File) => Promise<void>;
  profilePhotoURL: string | null;
  sendVerification: () => Promise<void>;
  reloadUser: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPassword, setHasPassword] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setHasPassword(!!u?.providerData.some((p) => p.providerId === 'password'));
      setLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setBlocked(false);
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);

    const presenceRef = dbRef(database, `presence/${user.uid}`);
    let cachedIp = '';

    const writePresence = async (includeIp: boolean) => {
      if (!user?.uid || cancelled) return;
      const lastSeen = Date.now();
      if (includeIp || !cachedIp) {
        try {
          const ipRes = await fetch('https://api.ipify.org?format=json');
          cachedIp = (await ipRes.json())?.ip ?? cachedIp;
        } catch { /* ignore */ }
      }
      const patch: Record<string, unknown> = {
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        lastSeen,
        provider: user.providerData[0]?.providerId ?? '',
      };
      if (cachedIp) patch.ip = cachedIp;

      // Live admin board reads /presence via realtime listener.
      try {
        await set(presenceRef, {
          lastSeen,
          ip: cachedIp || null,
          email: user.email ?? '',
          displayName: user.displayName ?? '',
        });
        void onDisconnect(presenceRef).update({ lastSeen: Date.now() });
      } catch { /* ignore */ }

      // Keep profile.lastSeen for /api/admin-user-stats fallback.
      try {
        await rtdbFetch(`/users/${user.uid}/profile`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
      } catch { /* ignore */ }
    };

    (async () => {
      try {
        const r = await rtdbFetch(`/users/${user.uid}/profile`);
        const profileData = ((await r.json()) ?? {}) as Record<string, unknown>;
        if (!cancelled) {
          setProfile(profileData);
          setBlocked(profileData.blocked === true);
        }
      } catch {
        if (!cancelled) {
          setProfile({});
          setBlocked(false);
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
      await writePresence(true);
    })();

    // Near-live presence while the tab is open.
    const HEARTBEAT_MS = 15 * 1000;
    const heartbeat = () => {
      if (document.visibilityState === 'hidden') return;
      void writePresence(false);
    };
    const timer = window.setInterval(heartbeat, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void writePresence(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      void onDisconnect(presenceRef).cancel().catch(() => {});
    };
  }, [user?.uid, user?.email, user?.displayName]);

  const profilePhotoURL =
    user?.photoURL ||
    (typeof profile?.photoURL === 'string' ? profile.photoURL : null) ||
    null;

  const value: AuthCtx = {
    user,
    loading,
    hasPassword,
    blocked,
    isPlus: isPlusUser(profile, user?.email),
    hasAi: hasAiAccess(profile, user?.email),
    profileLoading,
    profilePhotoURL,
    signIn: async (email, pass) => {
      const normalized = normalizeAuthEmail(email);
      try {
        const cred = await signInWithEmailAndPassword(auth, normalized, pass);
        // Unverified accounts are treated as "not registered" — resend a fresh
        // verification email on every sign-in attempt until they verify.
        if (!cred.user.emailVerified) {
          await sendVerificationEmailDirect(normalized);
        }
      } catch (e) {
        const code = (e as { code?: string })?.code ?? '';
        if (PASSWORD_SIGNIN_FAIL.has(code)) {
          const methods = await signInMethodsForEmail(normalized);
          if (methods.includes('google.com') && !methods.includes('password')) {
            // Same email already lives on a Google account — never invent a second one.
            throw authError('auth/use-google-sign-in');
          }
        }
        throw e;
      }
    },
    signUp: async (email, pass) => {
      const normalized = normalizeAuthEmail(email);
      const methods = await signInMethodsForEmail(normalized);

      // Existing password account → sign in on this same UID (never create another).
      if (methods.includes('password')) {
        const cred = await signInWithEmailAndPassword(auth, normalized, pass);
        if (!cred.user.emailVerified) {
          await sendVerificationEmailDirect(normalized);
        }
        return;
      }

      // Email already registered via Google (or another provider) → refuse createUser.
      // User must open that same account (Google), then link a password in Settings.
      if (methods.some((m) => m && m !== 'password')) {
        throw authError('auth/use-google-then-set-password');
      }

      try {
        await createUserWithEmailAndPassword(auth, normalized, pass);
        await sendVerificationEmailDirect(normalized);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'auth/email-already-in-use') {
          // Critical: do NOT create a second Auth user. Try password on the
          // existing UID; if that fails, the email belongs to Google-only.
          try {
            const cred = await signInWithEmailAndPassword(auth, normalized, pass);
            if (!cred.user.emailVerified) {
              await sendVerificationEmailDirect(normalized);
            }
            return;
          } catch {
            throw authError('auth/use-google-then-set-password');
          }
        }
        throw e;
      }
    },
    signInGoogle: async () => {
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        // Password account already owns this email — sign in with email/password
        // on that same UID (then optional Google link later). Never spawn a twin.
        if (code === 'auth/account-exists-with-different-credential') {
          throw authError('auth/account-exists-use-password');
        }
        throw e;
      }
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
      // Link password onto the *currently signed-in* UID (e.g. Google → also password).
      // Never creates a new Auth user or touches another UID's RTDB data.
      if (!auth.currentUser?.email) throw new Error('no-email');
      const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
      try {
        await linkWithCredential(auth.currentUser, cred);
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'auth/provider-already-linked') {
          // This UID already has password — treat as success after reload.
        } else if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
          // Password/email is tied to a *different* UID — do not merge or overwrite.
          throw authError('auth/password-belongs-other-account');
        } else {
          throw e;
        }
      }
      await auth.currentUser.reload();
      setUser({ ...auth.currentUser });
      setHasPassword(auth.currentUser.providerData.some((p) => p.providerId === 'password'));
    },
    updateDisplayName: async (name) => {
      if (!auth.currentUser) throw new Error('no-user');
      await updateProfile(auth.currentUser, { displayName: name });
      setUser({ ...auth.currentUser });
    },
    updateProfilePhoto: async (file) => {
      if (!auth.currentUser) throw new Error('no-user');
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) throw new Error('invalid-type');
      const uid = auth.currentUser.uid;
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const storagePath = `users/${uid}/profile/avatar.${ext}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const photoURL = await getDownloadURL(storageRef);
      await updateProfile(auth.currentUser, { photoURL });
      try {
        await fetch(`${FB_DB_URL}/users/${uid}/profile.json`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoURL }),
        });
      } catch { /* ignore */ }
      await auth.currentUser.reload();
      setUser({ ...auth.currentUser });
      setProfile((prev) => ({ ...(prev ?? {}), photoURL }));
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
