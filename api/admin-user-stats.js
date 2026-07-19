import {
  ADMIN_EMAIL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
  verifyAdmin,
} from './_lib/firebaseAdmin.js';

const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const FREE_STORAGE_LIMIT_MB = 100;
const PLUS_STORAGE_LIMIT_MB = 1000;
const MIN_STORAGE_LIMIT_MB = 10;
const MAX_STORAGE_LIMIT_MB = 10_000;

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

function filesBytes(userData) {
  const meta = jsonBytes(userData?.fileFolders);
  const files = userData?.files;
  if (!files || typeof files !== 'object') return meta;
  const list = Array.isArray(files) ? files : Object.values(files);
  const sum = list.reduce((acc, file) => {
    const size = file && typeof file === 'object' ? file.size : 0;
    return acc + (typeof size === 'number' && size > 0 ? size : 0);
  }, 0);
  return meta + sum;
}

function storageBytes(userData) {
  return (
    jsonBytes(userData?.notes)
    + jsonBytes(userData?.quizzes)
    + jsonBytes(userData?.quizSets)
    + jsonBytes(userData?.quizFolders)
    + jsonBytes(userData?.chats)
    + jsonBytes(userData?.draftContents)
    + filesBytes(userData)
  );
}

function isPlus(profile, email) {
  if (email === ADMIN_EMAIL) return true;
  return profile?.isPlus === true;
}

function storageLimitMB(profile, email) {
  if (email === ADMIN_EMAIL) {
    const raw = profile?.storageLimitMB;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= MIN_STORAGE_LIMIT_MB) {
      return Math.min(raw, MAX_STORAGE_LIMIT_MB);
    }
    return MAX_STORAGE_LIMIT_MB;
  }
  return isPlus(profile, email) ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}

async function listAuthUsers(serviceAccount, accessToken) {
  const users = [];
  let nextPageToken = '';
  do {
    const url = new URL(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/accounts:batchGet`);
    url.searchParams.set('maxResults', '1000');
    if (nextPageToken) url.searchParams.set('nextPageToken', nextPageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) break;
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
  if (!isAllowedOrigin(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }
  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!idToken || !(await verifyAdmin(idToken))) {
    return response.status(403).json({ error: 'forbidden' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const [dbToken, authToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [AUTH_SCOPE]),
    ]);

    // Server-to-server read of the whole tree, but only compact numbers go to the client.
    const [users, authUsers] = await Promise.all([
      readRtdb(dbToken, '/users').catch(() => ({})),
      listAuthUsers(serviceAccount, authToken).catch(() => []),
    ]);
    const data = users && typeof users === 'object' ? users : {};

    const authByUid = new Map(
      authUsers.map((u) => [u.localId, u]),
    );
    const allUids = new Set([...Object.keys(data), ...authByUid.keys()]);

    const rows = Array.from(allUids).map((uid) => {
      const blob = (data[uid] ?? {});
      const profile = (blob.profile ?? {});
      const authUser = authByUid.get(uid);
      const email = ((profile.email) || authUser?.email || '').trim();
      const displayName = ((profile.displayName) || authUser?.displayName || '').trim();
      return {
        uid,
        email,
        displayName,
        lastSeen: Number(profile.lastSeen) || Number(authUser?.lastLoginAt) || 0,
        ip: profile.ip ?? '',
        provider: profile.provider || authUser?.providerUserInfo?.[0]?.providerId || '',
        blocked: profile.blocked === true,
        isPlus: isPlus(profile, email),
        bytes: storageBytes(blob),
        storageLimitMB: storageLimitMB(profile, email),
      };
    });
    rows.sort((a, b) => b.lastSeen - a.lastSeen);

    return response.status(200).json({ users: rows });
  } catch (error) {
    console.error('Admin user stats failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
