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
  // Real GCS bucket for this project (pre-Oct-2024). The *.firebasestorage.app
  // name is only a Firebase console alias here — GCS JSON API returns 404 for it.
  storageBucket: 'noteclaude-a5b3b.appspot.com',
  messagingSenderId: '198607505359',
  appId: '1:198607505359:web:c1b7c66440b9b68bba34ba',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const database = getDatabase(firebaseApp);

/** Default bucket — new uploads go here (real appspot GCS bucket). */
export const storage = getStorage(firebaseApp);

/**
 * Firebase console alias bucket. Rarely used; kept so resolvers can still find
 * any objects that were written under the firebasestorage.app name.
 */
export const storageAlias = getStorage(firebaseApp, 'gs://noteclaude-a5b3b.firebasestorage.app');

/** @deprecated Use storageAlias — kept for older imports. */
export const storageLegacy = storageAlias;

/** Both buckets to search when resolving existing files. Real bucket first. */
export const storageBuckets: FirebaseStorage[] = [storage, storageAlias];

export const googleProvider = new GoogleAuthProvider();
export { EmailAuthProvider };

export const FB_DB_URL = 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app';

// Only this account sees the admin panel.
export const ADMIN_EMAIL = 'abdomar200@gmail.com';
