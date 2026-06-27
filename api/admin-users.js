import { createSign } from 'node:crypto';

const ADMIN_EMAIL = 'abdomar200@gmail.com';
const FIREBASE_API_KEY = 'AIzaSyDvmhfrgIWtgdSCnvwPgt5u0P4-unx0HL4';
const ALLOWED_ORIGINS = new Set(['https://tahanote.com', 'https://notes-woad-pi.vercel.app']);

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function readServiceAccount(rawValue) {
  try {
    return JSON.parse(rawValue);
  } catch {
    const repaired = rawValue.replace(
      /("private_key"\s*:\s*")([\s\S]*?)(",\s*"client_email")/,
      (_, start, key, end) => `${start}${key.replace(/\r?\n/g, '\\n')}${end}`
    );
    return JSON.parse(repaired);
  }
}

async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
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

async function verifyAdmin(idToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data?.users?.[0]?.email?.toLowerCase() === ADMIN_EMAIL;
}

async function listAuthUsers(serviceAccount, accessToken) {
  const users = [];
  let nextPageToken = '';
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/accounts:batchGet`);
    url.searchParams.set('maxResults', '1000');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error('auth-users-list-failed');
    const data = await response.json();
    users.push(...(data.users ?? []));
    nextPageToken = data.nextPageToken ?? '';
  } while (nextPageToken);
  return users;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method-not-allowed' });
  }

  if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!idToken || !(await verifyAdmin(idToken))) {
    return response.status(403).json({ error: 'forbidden' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getGoogleAccessToken(serviceAccount);
    const authUsers = await listAuthUsers(serviceAccount, accessToken);
    return response.status(200).json({
      users: authUsers.map((authUser) => ({
        uid: authUser.localId,
        email: authUser.email ?? '',
        displayName: authUser.displayName ?? '',
        lastLoginAt: Number(authUser.lastLoginAt ?? 0),
        createdAt: Number(authUser.createdAt ?? 0),
        provider: authUser.providerUserInfo?.[0]?.providerId ?? '',
        emailVerified: authUser.emailVerified === true,
      })),
    });
  } catch (error) {
    console.error('Admin users failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
