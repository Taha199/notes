import { createSign } from 'node:crypto';

export const ADMIN_EMAIL = 'abdomar200@gmail.com';
export const FIREBASE_API_KEY = 'AIzaSyDvmhfrgIWtgdSCnvwPgt5u0P4-unx0HL4';
export const FB_DB_URL = 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app';
export const STORAGE_BUCKET = 'noteclaude-a5b3b.firebasestorage.app';
export const ALLOWED_ORIGINS = new Set(['https://tahanote.com', 'https://notes-woad-pi.vercel.app']);

export function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function readServiceAccount(rawValue) {
  if (!rawValue) throw new Error('missing-service-account');
  try {
    return JSON.parse(rawValue);
  } catch {
    const repaired = rawValue.replace(
      /("private_key"\s*:\s*")([\s\S]*?)(",\s*"client_email")/,
      (_, start, key, end) => `${start}${key.replace(/\r?\n/g, '\\n')}${end}`,
    );
    return JSON.parse(repaired);
  }
}

export async function getGoogleAccessToken(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: serviceAccount.token_uri,
    iat: now,
    exp: now + 3600,
  }));
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer
    .sign(serviceAccount.private_key.replace(/\\n/g, '\n'))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const response = await fetch(serviceAccount.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedToken}.${signature}`,
    }),
  });
  if (!response.ok) throw new Error('google-token-failed');
  return (await response.json()).access_token;
}

export async function verifyAdmin(idToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const user = data?.users?.[0];
  if (!user?.email || user.email.toLowerCase() !== ADMIN_EMAIL) return null;
  return user;
}

export function isAllowedOrigin(origin) {
  return !origin || ALLOWED_ORIGINS.has(origin);
}

export async function readRtdb(accessToken, path) {
  const url = `${FB_DB_URL}${path}.json?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}
