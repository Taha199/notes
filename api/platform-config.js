import {
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
  verifyAdmin,
  writeRtdb,
} from './_lib/firebaseAdmin.js';

/** GET: public registration flag. POST: admin update (Hobby: one function, not two). */
export default async function handler(request, response) {
  if (request.method === 'GET') {
    try {
      const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
      const accessToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
      const raw = await readRtdb(accessToken, '/platform/config/registrationEnabled');
      const registrationEnabled = raw !== false;
      response.setHeader('Cache-Control', 'public, max-age=30');
      return response.status(200).json({ registrationEnabled });
    } catch (error) {
      console.error('platform-config GET failed', error);
      return response.status(200).json({ registrationEnabled: true });
    }
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
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

  if (typeof body.registrationEnabled !== 'boolean') {
    return response.status(400).json({ error: 'invalid-payload' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
    const ok = await writeRtdb(
      accessToken,
      '/platform/config/registrationEnabled',
      body.registrationEnabled,
      'PUT',
    );
    if (!ok) return response.status(500).json({ error: 'write-failed' });
    return response.status(200).json({ ok: true, registrationEnabled: body.registrationEnabled });
  } catch (error) {
    console.error('platform-config POST failed', error);
    return response.status(500).json({ error: 'request-failed' });
  }
}
