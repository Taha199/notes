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

/** Cap getIdToken so a stuck IndexedDB/auth refresh cannot hang list/upload forever (Chrome). */
const ID_TOKEN_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function getRtdbAuthToken(forceRefresh = false): Promise<string | null> {
  const user = auth.currentUser ?? await waitForAuthUser(5000);
  if (!user) return null;
  try {
    return await withTimeout(user.getIdToken(forceRefresh), ID_TOKEN_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function rtdbUrl(path: string, forceRefresh = false): Promise<string> {
  const token = await getRtdbAuthToken(forceRefresh);
  const normalized = path.startsWith('http')
    ? path
    : `${FB_DB_URL}${path.startsWith('/') ? path : `/${path}`}`;
  // Split any query string so `.json` is inserted before it (e.g. `/users?shallow=true`).
  const qIndex = normalized.indexOf('?');
  const base = qIndex === -1 ? normalized : normalized.slice(0, qIndex);
  const query = qIndex === -1 ? '' : normalized.slice(qIndex + 1);
  const withJson = base.endsWith('.json') ? base : `${base}.json`;
  const params = new URLSearchParams(query);
  if (token) params.set('auth', token);
  const qs = params.toString();
  return qs ? `${withJson}?${qs}` : withJson;
}

/** Default network timeout so a stalled connection never leaves pages spinning forever. */
const RTDB_TIMEOUT_MS = 30000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = RTDB_TIMEOUT_MS): Promise<Response> {
  // Respect a caller-provided signal while still enforcing our own timeout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = init?.signal;
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', () => controller.abort(), { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Authenticated Firebase Realtime Database REST fetch with timeout + one 401/403 retry. */
export async function rtdbFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = await rtdbUrl(path);
  const res = await fetchWithTimeout(url, init);
  if (res.ok || (res.status !== 401 && res.status !== 403)) return res;
  const retryUrl = await rtdbUrl(path, true);
  if (retryUrl === url) return res;
  return fetchWithTimeout(retryUrl, init);
}
