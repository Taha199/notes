import { createSign } from 'node:crypto';

const ADMIN_EMAIL = 'abdomar200@gmail.com';
const FIREBASE_API_KEY = 'AIzaSyDvmhfrgIWtgdSCnvwPgt5u0P4-unx0HL4';
const FB_DB_URL = 'https://noteclaude-a5b3b-default-rtdb.europe-west1.firebasedatabase.app';
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

async function getDatabaseAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database',
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
  if (!response.ok) return null;
  const data = await response.json();
  const user = data?.users?.[0];
  if (!user?.email || user.email.toLowerCase() !== ADMIN_EMAIL) return null;
  return user;
}

function countArrayLike(value) {
  if (!value) return 0;
  if (Array.isArray(value)) return value.filter(Boolean).length;
  if (typeof value === 'object') return Object.keys(value).length;
  return 0;
}

async function readJson(accessToken, path) {
  const url = `${FB_DB_URL}${path}.json?access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
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
  const adminUser = idToken ? await verifyAdmin(idToken) : null;
  if (!adminUser) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const uid = String(request.query.uid || adminUser.localId || '');

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getDatabaseAccessToken(serviceAccount);
    const userNode = await readJson(accessToken, `/users/${uid}`);
    const shallow = await fetch(`${FB_DB_URL}/users/${uid}.json?shallow=true&access_token=${encodeURIComponent(accessToken)}`).then((r) => r.json());
    const dataHistoryKeys = Object.keys((await readJson(accessToken, `/users/${uid}/dataHistory`)) || {}).sort().reverse();
    const folderHistoryKeys = Object.keys((await readJson(accessToken, `/users/${uid}/quizFoldersHistory`)) || {}).sort().reverse();
    const latestDataHistory = dataHistoryKeys[0]
      ? await readJson(accessToken, `/users/${uid}/dataHistory/${dataHistoryKeys[0]}`)
      : null;
    const draftContents = userNode?.draftContents;
    const draftCount = draftContents && typeof draftContents === 'object' ? Object.keys(draftContents).length : 0;

    return response.status(200).json({
      uid,
      topLevelKeys: Object.keys(shallow || {}),
      counts: {
        notes: countArrayLike(userNode?.notes),
        quizzes: countArrayLike(userNode?.quizzes),
        quizSets: countArrayLike(userNode?.quizSets),
        quizFolders: countArrayLike(userNode?.quizFolders),
        chats: countArrayLike(userNode?.chats),
        files: countArrayLike(userNode?.files),
        drafts: countArrayLike(userNode?.drafts),
        draftContents,
      },
      history: {
        dataHistory: dataHistoryKeys.length,
        dataHistoryLatest: latestDataHistory ? {
          key: dataHistoryKeys[0],
          notes: countArrayLike(latestDataHistory.notes),
          quizzes: countArrayLike(latestDataHistory.quizzes),
          quizSets: countArrayLike(latestDataHistory.quizSets),
          quizFolders: countArrayLike(latestDataHistory.quizFolders),
        } : null,
        quizFoldersHistory: folderHistoryKeys.length,
        quizFoldersHistoryLatestKey: folderHistoryKeys[0] ?? null,
      },
      draftContentsCount: draftCount,
    });
  } catch (error) {
    console.error('Admin user data failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
