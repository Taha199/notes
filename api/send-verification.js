import { createSign } from 'node:crypto';
import { sendEmail } from './lib/resend.js';

const APP_URL = 'https://tahanote.com';
const ALLOWED_ORIGINS = new Set([APP_URL, 'https://notes-woad-pi.vercel.app']);
const REQUEST_WINDOW_MS = 60_000;
const recentRequests = new Map();

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
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
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const signature = signer
    .sign(privateKey)
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
  const data = await response.json();
  return data.access_token;
}

function buildEmail({ verifyUrl, lang }) {
  const swedish = lang === 'sv';
  const copy = swedish
    ? {
        preheader: 'Bekrafta din e-postadress for att borja anvanda Taha Note.',
        title: 'Bekrafta din e-postadress',
        intro: 'Tack for att du registrerade dig pa Taha Note! Klicka pa knappen nedan for att bekrafta din e-postadress och aktivera ditt konto.',
        button: 'Bekrafta e-postadress',
        note: 'Knappen tar dig till Taha Note dar ditt konto aktiveras automatiskt.',
        ignore: 'Om du inte skapade ett Taha Note-konto kan du ignorera detta mejl.',
        subject: 'Bekrafta din e-postadress – Taha Note',
      }
    : {
        preheader: 'Confirm your email address to start using Taha Note.',
        title: 'Confirm your email address',
        intro: 'Thanks for signing up for Taha Note! Click the button below to confirm your email address and activate your account.',
        button: 'Confirm email address',
        note: 'The button takes you to Taha Note where your account will be activated automatically.',
        ignore: 'If you did not create a Taha Note account, you can safely ignore this email.',
        subject: 'Confirm your email address – Taha Note',
      };

  return {
    subject: copy.subject,
    html: `<!doctype html>
<html><body style="margin:0;background:#f6f4ff;font-family:Arial,sans-serif;color:#1f2937">
  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0">${copy.preheader}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;background:#f6f4ff"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e3ff;border-radius:16px;overflow:hidden">
      <tr><td style="padding:30px 34px 24px;background:#fbfaff;border-bottom:1px solid #ece9ff">
        <table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td style="width:42px;height:42px"><img src="${APP_URL}/logo.png" alt="Taha Note" width="42" height="42" style="display:block;border:0;border-radius:10px" /></td>
          <td style="padding-left:12px;font-size:22px;font-weight:800;color:#5148c9">Taha Note</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:34px">
        <p style="margin:0 0 9px;font-size:11px;font-weight:700;letter-spacing:1px;color:#6c63ff">VERIFY ACCOUNT</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.25;color:#1f2937">${copy.title}</h1>
        <p style="margin:0;color:#667085;font-size:16px;line-height:1.65">${copy.intro}</p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td style="border-radius:8px;background:#6c63ff">
          <a href="${verifyUrl}" style="display:inline-block;padding:14px 22px;border-radius:8px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">${copy.button}</a>
        </td></tr></table>
        <p style="margin:0 0 16px;color:#667085;font-size:14px;line-height:1.6">${copy.note}</p>
        <p style="margin:0;color:#667085;font-size:14px;line-height:1.6">${copy.ignore}</p>
      </td></tr>
      <tr><td style="padding:20px 34px;background:#fbfaff;border-top:1px solid #ece9ff;color:#98a2b3;font-size:12px">Taha Note · Your notes, everywhere.</td></tr>
    </table>
  </td></tr></table>
</body></html>`,
  };
}

function isRateLimited(request) {
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const previous = recentRequests.get(ip) || 0;
  recentRequests.set(ip, now);
  return now - previous < REQUEST_WINDOW_MS;
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

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'method-not-allowed' });
  }

  if (request.headers.origin && !ALLOWED_ORIGINS.has(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const email = typeof request.body?.email === 'string' ? request.body.email.trim().toLowerCase() : '';
  const lang = request.body?.lang === 'sv' ? 'sv' : 'en';
  if (!/^\S+@\S+\.\S+$/.test(email)) return response.status(400).json({ error: 'invalid-email' });
  if (isRateLimited(request)) return response.status(429).json({ error: 'rate-limited' });

  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
    const accessToken = await getGoogleAccessToken(serviceAccount);

    const linkResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/accounts:sendOobCode`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestType: 'VERIFY_EMAIL',
          email,
          continueUrl: `${APP_URL}/?lang=${lang}`,
          returnOobLink: true,
        }),
      }
    );
    const linkData = await linkResponse.json();
    if (!linkResponse.ok) {
      console.error('Firebase OOB error', linkData);
      return response.status(500).json({ error: 'reset-link-failed', detail: linkData?.error?.message || 'unknown' });
    }

    const oobCode = linkData.oobCode || (
      linkData.oobLink ? new URL(linkData.oobLink).searchParams.get('oobCode') : null
    );
    if (!oobCode) throw new Error('missing-verify-code');

    const verifyUrl = new URL('/', APP_URL);
    verifyUrl.searchParams.set('mode', 'verifyEmail');
    verifyUrl.searchParams.set('oobCode', oobCode);
    verifyUrl.searchParams.set('lang', lang);

    const emailContent = buildEmail({ verifyUrl: verifyUrl.toString(), lang });
    try {
      await sendEmail({
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
      });
    } catch (error) {
      if (error.message === 'missing-resend-api-key') {
        console.error('RESEND_API_KEY is not configured');
        return response.status(500).json({ error: 'email-config-missing' });
      }
      console.error('Resend send failed', error.detail);
      return response.status(502).json({ error: 'email-send-failed', detail: error.detail });
    }
    return response.status(200).json({ ok: true });
  } catch (error) {
    console.error('Verification email failed', error);
    return response.status(500).json({ error: 'request-failed', detail: String(error) });
  }
}
