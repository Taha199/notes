import {
  getGoogleAccessToken,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
} from './_lib/firebaseAdmin.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'method-not-allowed' });
  }

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
    const raw = await readRtdb(accessToken, '/platform/config/registrationEnabled');
    const registrationEnabled = raw !== false;
    response.setHeader('Cache-Control', 'public, max-age=30');
    return response.status(200).json({ registrationEnabled });
  } catch (error) {
    console.error('public-config failed', error);
    return response.status(200).json({ registrationEnabled: true });
  }
}
