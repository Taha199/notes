import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  EmailAuthProvider,
} from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyDvmhfrgIWtgdSCnvwPgt5u0P4-unx0HL4',
  authDomain: 'noteclaude-a5b3b.firebaseapp.com',
  databaseURL: 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'noteclaude-a5b3b',
  storageBucket: 'noteclaude-a5b3b.firebasestorage.app',
  messagingSenderId: '198607505359',
  appId: '1:198607505359:web:c1b7c66440b9b68bba34ba',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const storage = getStorage(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
export { EmailAuthProvider };

export const FB_DB_URL = 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app';

// Only this account sees the admin panel.
export const ADMIN_EMAIL = 'abdomar200@gmail.com';
