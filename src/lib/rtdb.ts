import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth, FB_DB_URL } from './firebase';

/** Wait for Firebase auth on slow mobile Safari cold starts. */
export async function waitForAuthUser(maxMs = 8000): Promise<User | null> {
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsub();
      resolve(auth.currentUser);
    }, maxMs);
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        clearTimeout(timer);
        unsub();
        resolve(u);
      }
    });
  });
}

export async function getRtdbAuthToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser ?? await waitForAuthUser(5000);
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function rtdbUrl(path: string, forceRefresh = false): Promise<string> {
  const token = await getRtdbAuthToken(forceRefresh);
  const normalized = path.startsWith('http')
    ? path
    : `${FB_DB_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const withJson = normalized.endsWith('.json') ? normalized : `${normalized}.json`;
  if (!token) return withJson;
  return `${withJson}${withJson.includes('?') ? '&' : '?'}auth=${encodeURIComponent(token)}`;
}

/** Authenticated Firebase Realtime Database REST fetch with one 401/403 retry. */
export async function rtdbFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = await rtdbUrl(path);
  const res = await fetch(url, init);
  if (res.ok || (res.status !== 401 && res.status !== 403)) return res;
  const retryUrl = await rtdbUrl(path, true);
  if (retryUrl === url) return res;
  return fetch(retryUrl, init);
}
