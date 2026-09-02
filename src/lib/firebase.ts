import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
} from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDvmhfrgIWtgdSCnvwPgt5u0P4-unx0HL4',
  authDomain: 'noteclaude-a5b3b.firebaseapp.com',
  databaseURL: 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'noteclaude-a5b3b',
  // Friday working config — client SDK uploads use this bucket.
  storageBucket: 'noteclaude-a5b3b.firebasestorage.app',
  messagingSenderId: '198607505359',
  appId: '1:198607505359:web:c1b7c66440b9b68bba34ba',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);

/** Default bucket — new uploads go here (Friday / client SDK path). */
export const storage = getStorage(firebaseApp);

/**
 * Legacy App Engine-style bucket. Older uploads may still live here; kept for
 * download/preview resolution only — not used for new client uploads.
 */
export const storageLegacy = getStorage(firebaseApp, 'gs://noteclaude-a5b3b.appspot.com');

/** Both buckets to search when resolving existing files. Legacy first (old files). */
export const storageBuckets: FirebaseStorage[] = [storageLegacy, storage];

export const googleProvider = new GoogleAuthProvider();
export { EmailAuthProvider };

export const FB_DB_URL = 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app';

// Only this account sees the admin panel.
export const ADMIN_EMAIL = 'abdomar200@gmail.com';
/**
 * Sidebar link + /admin route for Användarpanel.
 * Flip to true to restore — AdminPanel component and APIs stay wired.
 */
export const SHOW_ADMIN_PANEL = false;
