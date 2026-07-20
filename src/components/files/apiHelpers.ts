import { auth } from '../../lib/firebase';

/** Parse API response; never silently treat HTML as JSON. */
export async function readApiResponse<T = unknown>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  const text = await res.text();
  throw new Error(
    `API returned ${res.status} ${res.statusText}. `
      + `Content-Type: ${contentType || '(none)'}. `
      + `Response: ${text.slice(0, 500)}`,
  );
}

/** Require a signed-in user and a fresh Firebase ID token. Throws with a clear message. */
export async function requireIdToken(forceRefresh = false): Promise<{ uid: string; token: string }> {
  const user = auth.currentUser;
  if (!user?.uid) {
    throw new Error('You must be signed in. (no auth.currentUser)');
  }
  try {
    const token = await user.getIdToken(forceRefresh);
    if (!token) throw new Error('getIdToken returned empty');
    return { uid: user.uid, token };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not get Firebase ID token: ${msg}`);
  }
}
