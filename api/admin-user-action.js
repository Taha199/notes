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
const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';

function plusStorageLimitForToggle(isPlus) {
  return isPlus ? PLUS_STORAGE_LIMIT_MB : FREE_STORAGE_LIMIT_MB;
}

/** Delete Firebase Auth account so the user disappears from the admin list. */
async function deleteAuthAccount(serviceAccount, accessToken, uid) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/accounts:delete`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ localId: uid }),
  });
  if (response.ok) return true;
  const data = await response.json().catch(() => ({}));
  const message = String(data?.error?.message || '');
  // Already gone — treat as success so RTDB cleanup still completes.
  if (message.includes('USER_NOT_FOUND') || response.status === 404) return true;
  console.error('deleteAuthAccount failed', response.status, message);
  return false;
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
      const authToken = await getGoogleAccessToken(serviceAccount, [AUTH_SCOPE]);
      const authOk = await deleteAuthAccount(serviceAccount, authToken, uid);
      if (!authOk) return response.status(500).json({ error: 'auth-delete-failed' });

      // PUT null is the most reliable RTDB wipe (DELETE can no-op on some setups).
      const dataOk = await writeRtdb(accessToken, `/users/${uid}`, null, 'PUT');
      if (!dataOk) {
        // Fallback DELETE if PUT null is rejected.
        const deleted = await writeRtdb(accessToken, `/users/${uid}`, null, 'DELETE');
        if (!deleted) return response.status(500).json({ error: 'write-failed' });
      }
      // Best-effort presence cleanup — ignore failures.
      await writeRtdb(accessToken, `/presence/${uid}`, null, 'PUT').catch(() => false);

      return response.status(200).json({ ok: true });
    }

    return response.status(400).json({ error: 'unknown-action' });
  } catch (error) {
    console.error('Admin user action failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
