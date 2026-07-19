import {
  ADMIN_EMAIL,
  getGoogleAccessToken,
  isAllowedOrigin,
  readRtdb,
  readServiceAccount,
  RTDB_SCOPES,
  verifyUser,
  writeRtdb,
} from './lib/firebaseAdmin.js';

const MODEL = 'gemini-2.5-flash';

/** Hard caps to keep spend predictable. */
const HARD_MAX_TOKENS = 1200;
const DEFAULT_MAX_TOKENS = 600;
const DAILY_TOKEN_LIMIT = 200_000;
const ADMIN_DAILY_TOKEN_LIMIT = 1_000_000;
const MAX_REQUESTS_PER_HOUR = 40;
const MAX_MESSAGE_CHARS = 12_000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

function isPlusProfile(profile, email) {
  if (email === ADMIN_EMAIL) return true;
  return profile?.isPlus === true;
}

function clampMaxTokens(raw) {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_MAX_TOKENS;
  return Math.min(HARD_MAX_TOKENS, Math.max(64, n));
}

function parseDataUrl(url) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(url || '');
  if (!m) return null;
  return { mimeType: m[1], data: m[2] };
}

/** Convert OpenAI-style chat messages → Gemini contents (+ optional systemInstruction). */
function toGeminiPayload(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'invalid-messages' };
  }

  let systemInstruction = '';
  const contents = [];
  let totalChars = 0;

  for (const msg of messages.slice(-16)) {
    if (!msg) continue;
    if (msg.role === 'system' && typeof msg.content === 'string') {
      systemInstruction += (systemInstruction ? '\n' : '') + msg.content.slice(0, 2000);
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = [];

    if (typeof msg.content === 'string') {
      const text = msg.content.slice(0, 8000);
      totalChars += text.length;
      if (totalChars > MAX_MESSAGE_CHARS) break;
      parts.push({ text });
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          const text = part.text.slice(0, 4000);
          totalChars += text.length;
          parts.push({ text });
        } else if (part?.type === 'image_url' && part.image_url?.url) {
          const url = String(part.image_url.url);
          if (url.length > 350_000) {
            return { ok: false, error: 'image-too-large' };
          }
          const parsed = parseDataUrl(url);
          if (!parsed) return { ok: false, error: 'invalid-image' };
          parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
          totalChars += 2000;
        }
      }
    }

    if (parts.length) contents.push({ role, parts });
    if (totalChars > MAX_MESSAGE_CHARS) break;
  }

  if (!contents.length) return { ok: false, error: 'invalid-messages' };
  return { ok: true, contents, systemInstruction };
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const visible = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => String(p.text).trim())
    .filter(Boolean);
  if (visible.length) return visible.join('\n').trim();
  return parts.map((p) => (p.text ? String(p.text).trim() : '')).filter(Boolean).join('\n').trim();
}

async function loadQuota(accessToken, uid) {
  const data = (await readRtdb(accessToken, `/users/${uid}/aiQuota`)) || {};
  return {
    day: typeof data.day === 'string' ? data.day : '',
    tokens: typeof data.tokens === 'number' ? data.tokens : 0,
    hour: typeof data.hour === 'string' ? data.hour : '',
    requests: typeof data.requests === 'number' ? data.requests : 0,
  };
}

async function saveQuota(accessToken, uid, quota) {
  await writeRtdb(accessToken, `/users/${uid}/aiQuota`, quota, 'PUT');
}

export default async function handler(request, response) {
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST, OPTIONS');
    return response.status(405).json({ error: 'method-not-allowed' });
  }
  const origin = request.headers.origin || '';
  const localDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!isAllowedOrigin(origin) && !localDev) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    return response.status(503).json({
      error: 'ai-not-configured',
      message: 'GEMINI_API_KEY saknas på servern. Lägg till den i Vercel och gör Redeploy.',
    });
  }

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const account = idToken ? await verifyUser(idToken) : null;
  if (!account) return response.status(403).json({ error: 'forbidden' });

  let accessToken;
  try {
    const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    accessToken = await getGoogleAccessToken(serviceAccount, RTDB_SCOPES);
  } catch {
    return response.status(500).json({ error: 'server-misconfigured' });
  }

  const profile = (await readRtdb(accessToken, `/users/${account.uid}/profile`)) || {};
  if (!isPlusProfile(profile, account.email)) {
    return response.status(403).json({ error: 'ai-locked', message: 'AI kräver Taha Note Plus.' });
  }

  const body = typeof request.body === 'string'
    ? JSON.parse(request.body || '{}')
    : (request.body || {});

  const converted = toGeminiPayload(body.messages);
  if (!converted.ok) {
    if (converted.error === 'image-too-large') {
      return response.status(400).json({ error: 'image-too-large', message: 'Bilden är för stor för AI (max ~250 KB).' });
    }
    return response.status(400).json({ error: converted.error || 'invalid-messages' });
  }

  const maxTokens = clampMaxTokens(body.max_tokens);
  const stream = body.stream === true;
  const day = todayKey();
  const hour = hourKey();
  const dailyLimit = account.email === ADMIN_EMAIL ? ADMIN_DAILY_TOKEN_LIMIT : DAILY_TOKEN_LIMIT;

  const quota = await loadQuota(accessToken, account.uid);
  const tokensToday = quota.day === day ? quota.tokens : 0;
  const requestsHour = quota.hour === hour ? quota.requests : 0;

  if (tokensToday >= dailyLimit) {
    return response.status(429).json({
      error: 'daily-limit',
      message: 'Daglig AI-gräns nådd. Försök igen imorgon.',
      tokensToday,
      dailyLimit,
    });
  }
  if (requestsHour >= MAX_REQUESTS_PER_HOUR) {
    return response.status(429).json({
      error: 'rate-limit',
      message: 'För många AI-anrop. Vänta en stund.',
    });
  }

  const geminiBody = {
    contents: converted.contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: typeof body.temperature === 'number' ? Math.min(1, Math.max(0, body.temperature)) : 0.3,
      // Avoid empty answers when thinking eats the budget.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (converted.systemInstruction) {
    geminiBody.systemInstruction = { parts: [{ text: converted.systemInstruction }] };
  }

  const endpoint = stream
    ? `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const geminiRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiBody),
  });

  if (!geminiRes.ok) {
    const err = await geminiRes.json().catch(() => ({}));
    const message = err?.error?.message || `Gemini error ${geminiRes.status}`;
    return response.status(geminiRes.status === 429 ? 429 : 502).json({ error: 'gemini-error', message });
  }

  const nextQuotaBase = {
    day,
    tokens: tokensToday,
    hour,
    requests: requestsHour + 1,
  };
  await saveQuota(accessToken, account.uid, nextQuotaBase);

  if (!stream) {
    const data = await geminiRes.json();
    const text = extractText(data);
    const used = data?.usageMetadata?.totalTokenCount ?? 0;
    if (used > 0) {
      await saveQuota(accessToken, account.uid, {
        ...nextQuotaBase,
        tokens: tokensToday + used,
      });
    }
    if (!text) return response.status(502).json({ error: 'empty-response' });
    return response.status(200).json({ text, usage: { total_tokens: used } });
  }

  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');

  const reader = geminiRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usageTokens = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6).trim();
        if (!json || json === '[DONE]') continue;
        let parsed;
        try { parsed = JSON.parse(json); } catch { continue; }
        if (parsed?.usageMetadata?.totalTokenCount) {
          usageTokens = parsed.usageMetadata.totalTokenCount;
        }
        const delta = extractText(parsed);
        if (delta) {
          response.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    }
  } finally {
    if (usageTokens > 0) {
      await saveQuota(accessToken, account.uid, {
        ...nextQuotaBase,
        tokens: tokensToday + usageTokens,
      });
    }
    response.write(`data: ${JSON.stringify({ done: true, usage: { total_tokens: usageTokens } })}\n\n`);
    response.end();
  }
}
