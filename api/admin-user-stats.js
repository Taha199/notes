import {
  ADMIN_EMAIL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readRtdbShallow,
  readServiceAccount,
  RTDB_SCOPES,
  verifyAdmin,
} from './_lib/firebaseAdmin.js';

/** Allow enough time for per-user light reads (Hobby may still cap lower). */
export const config = { maxDuration: 60 };

const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const FREE_STORAGE_LIMIT_MB = 100;
const PLUS_STORAGE_LIMIT_MB = 1000;
const MIN_STORAGE_LIMIT_MB = 10;
const MAX_STORAGE_LIMIT_MB = 10_000;

/** Only the fields used for admin storage — never pull ById / history mirrors. */
const STORAGE_KEYS = [
  'notes',
  'quizzes',
  'quizSets',
  'quizFolders',
  'chats',
  'draftContents',
  'files',
  'fileFolders',
];

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

function cachedStorageBytes(profile) {
  const raw = profile?.storageBytes;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
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

async function mapPool(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Profile only — used for instant admin table paint. */
async function readUserProfile(accessToken, uid) {
  const profile = await readRtdb(accessToken, `/users/${uid}/profile`).catch(() => null);
  return { profile: profile && typeof profile === 'object' ? profile : {} };
}

/**
 * Profile + storage fields. Skips multi-MB downloads when profile.storageBytes
 * was written by the client on save.
 */
async function readUserLight(accessToken, uid) {
  const profile = await readRtdb(accessToken, `/users/${uid}/profile`).catch(() => null);
  const safeProfile = profile && typeof profile === 'object' ? profile : {};
  const cached = cachedStorageBytes(safeProfile);
  if (cached != null) {
    return { profile: safeProfile, storageBytes: cached };
  }
  const storageParts = await Promise.all(
    STORAGE_KEYS.map((key) => readRtdb(accessToken, `/users/${uid}/${key}`).catch(() => null)),
  );
  const blob = { profile: safeProfile };
  STORAGE_KEYS.forEach((key, i) => {
    blob[key] = storageParts[i];
  });
  return { ...blob, storageBytes: storageBytes(blob) };
}

function buildRow(uid, blob, authByUid, presenceByUid) {
  const profile = blob.profile ?? {};
  const authUser = authByUid.get(uid);
  const live = presenceByUid[uid] ?? {};
  const email = ((profile.email) || authUser?.email || live.email || '').trim();
  const displayName = ((profile.displayName) || authUser?.displayName || live.displayName || '').trim();
  const profileSeen = Number(profile.lastSeen) || 0;
  const authSeen = Number(authUser?.lastLoginAt) || 0;
  const presenceSeen = Number(live.lastSeen) || 0;
  const lastSeen = Math.max(presenceSeen, profileSeen, authSeen);
  const ip = (typeof live.ip === 'string' && live.ip) || profile.ip || '';
  const bytes = typeof blob.storageBytes === 'number'
    ? blob.storageBytes
    : (cachedStorageBytes(profile) ?? storageBytes(blob));
  return {
    uid,
    email,
    displayName,
    lastSeen,
    ip,
    provider: profile.provider || authUser?.providerUserInfo?.[0]?.providerId || '',
    blocked: profile.blocked === true,
    isPlus: isPlus(profile, email),
    bytes,
    storageLimitMB: storageLimitMB(profile, email),
  };
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

  const url = new URL(request.url, 'http://localhost');
  const listOnly = url.searchParams.get('mode') === 'list';

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const [dbToken, authToken] = await Promise.all([
      getGoogleAccessToken(serviceAccount, RTDB_SCOPES),
      getGoogleAccessToken(serviceAccount, [AUTH_SCOPE]),
    ]);

    // Shallow UID list + Auth + presence — never download the full /users tree
    // (ById mirrors made that hang the admin panel).
    const [usersShallow, authUsers, presence] = await Promise.all([
      readRtdbShallow(dbToken, '/users').catch(() => ({})),
      listAuthUsers(serviceAccount, authToken).catch(() => []),
      readRtdb(dbToken, '/presence').catch(() => ({})),
    ]);
    const presenceByUid = presence && typeof presence === 'object' ? presence : {};
    const authByUid = new Map(authUsers.map((u) => [u.localId, u]));
    const rtdbUids = usersShallow && typeof usersShallow === 'object'
      ? Object.keys(usersShallow)
      : [];
    const allUids = [...new Set([...rtdbUids, ...authByUid.keys()])];

    // Fast path: profiles only so the admin table paints in ~1–2s.
    const blobs = await mapPool(allUids, listOnly ? 10 : 6, async (uid) => {
      try {
        return listOnly
          ? await readUserProfile(dbToken, uid)
          : await readUserLight(dbToken, uid);
      } catch {
        return { profile: {}, storageBytes: 0 };
      }
    });

    const rows = allUids.map((uid, index) => (
      buildRow(uid, blobs[index] ?? { profile: {} }, authByUid, presenceByUid)
    ));
    rows.sort((a, b) => b.lastSeen - a.lastSeen);

    response.setHeader('Cache-Control', listOnly ? 'no-store' : 'private, max-age=15');
    return response.status(200).json({ users: rows, mode: listOnly ? 'list' : 'full' });
  } catch (error) {
    console.error('Admin user stats failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
