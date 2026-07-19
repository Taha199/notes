import {
  ADMIN_EMAIL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readServiceAccount,
  RTDB_SCOPES,
  verifyAdmin,
  writeRtdb,
} from './_lib/firebaseAdmin.js';

const FREE_STORAGE_LIMIT_MB = 100;
const PLUS_STORAGE_LIMIT_MB = 1000;
const MIN_STORAGE_LIMIT_MB = 10;
const MAX_STORAGE_LIMIT_MB = 10_000;

function plusStorageLimitForToggle(isPlus) {
  return isPlus ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method-not-allowed' });
  }

  if (!isAllowedOrigin(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!idToken || !(await verifyAdmin(idToken))) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const body = typeof request.body === 'string'
    ? JSON.parse(request.body || '{}')
    : (request.body && typeof request.body === 'object' ? request.body : {});
  const action = String(body.action || '');
  const uid = String(body.uid || '').trim();
  if (!uid) {
    return response.status(400).json({ error: 'missing-uid' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);

    if (action === 'setPlus') {
      const isPlus = body.isPlus === true;
      const storageLimitMB = plusStorageLimitForToggle(isPlus);
      const ok = await writeRtdb(
        accessToken,
        `/users/${uid}/profile`,
        { isPlus, storageLimitMB },
        'PATCH',
      );
      if (!ok) return response.status(500).json({ error: 'write-failed' });
      return response.status(200).json({ ok: true, isPlus, storageLimitMB });
    }

    if (action === 'setBlocked') {
      const blocked = body.blocked === true;
      const ok = await writeRtdb(
        accessToken,
        `/users/${uid}/profile/blocked`,
        blocked,
        'PUT',
      );
      if (!ok) return response.status(500).json({ error: 'write-failed' });
      return response.status(200).json({ ok: true, blocked });
    }

    if (action === 'setStorageLimit') {
      const mb = Math.round(Number(body.storageLimitMB));
      if (!Number.isFinite(mb) || mb < MIN_STORAGE_LIMIT_MB || mb > MAX_STORAGE_LIMIT_MB) {
        return response.status(400).json({ error: 'invalid-limit' });
      }
      const ok = await writeRtdb(
        accessToken,
        `/users/${uid}/profile/storageLimitMB`,
        mb,
        'PUT',
      );
      if (!ok) return response.status(500).json({ error: 'write-failed' });
      return response.status(200).json({ ok: true, storageLimitMB: mb });
    }

    if (action === 'deleteUser') {
      // Never allow deleting the admin account via this endpoint.
      const email = String(body.email || '').trim().toLowerCase();
      if (email === ADMIN_EMAIL) {
        return response.status(403).json({ error: 'cannot-delete-admin' });
      }
      const ok = await writeRtdb(accessToken, `/users/${uid}`, null, 'DELETE');
      if (!ok) return response.status(500).json({ error: 'write-failed' });
      return response.status(200).json({ ok: true });
    }

    return response.status(400).json({ error: 'unknown-action' });
  } catch (error) {
    console.error('Admin user action failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
