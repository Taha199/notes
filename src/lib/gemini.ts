/**
 * AI client — calls authenticated /api/ai proxy (Gemini key stays on the server as GEMINI_API_KEY).
 */
import type { AiAnswerStyle } from './aiAnswerStyle';
import { getRtdbAuthToken } from './rtdb';

let tokenSink: ((n: number) => void) | null = null;
export function setTokenSink(fn: (n: number) => void) { tokenSink = fn; }
function reportTokens(n?: number) {
  if (n && n > 0) tokenSink?.(n);
}

const NOTE_SLICE = 2500;
const MAX_ANSWER_TOKENS_SHORT = 500;
const MAX_ANSWER_TOKENS_LONG = 1400;
const MAX_QUIZ_TOKENS = 900;
const MAX_CHAT_TOKENS = 700;
const MAX_HISTORY_TURNS = 8;
const MAX_IMAGE_BASE64_CHARS = 350_000;

type ChatMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> };

async function callAi(body: {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
}): Promise<string> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('Du måste vara inloggad för AI.');

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({})) as {
    text?: string;
    usage?: { total_tokens?: number };
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.message || data.error || `AI error: ${res.status}`);
  }
  reportTokens(data.usage?.total_tokens);
  const text = data.text?.trim() ?? '';
  if (!text) throw new Error('No response returned');
  return text;
}

export interface QuizResult {
  question: string;
  answer: string;
}

/** One Q+A pair in a single cheap request (preferred for AI mode). */
export async function generateOneQa(noteText: string): Promise<QuizResult> {
  const text = await callAi({
    max_tokens: MAX_ANSWER_TOKENS_SHORT,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: `Skapa EXAKT EN studiefråga med svar från anteckningen. Samma språk som anteckningen.
Svara i exakt format:
Q: <frågan>
A: <svaret>

Anteckning:
${noteText.slice(0, NOTE_SLICE)}`,
    }],
  });

  const qMatch = text.match(/Q:\s*(.+?)(?=\nA:|$)/s);
  const aMatch = text.match(/A:\s*(.+)/s);
  if (!qMatch || !aMatch) throw new Error('Could not parse response');
  return { question: qMatch[1].trim(), answer: aMatch[1].trim() };
}

export async function generateQuiz(noteText: string): Promise<QuizResult[]> {
  // Single pass only (no verify round-trip). Cap to a few Q&As.
  const text = await callAi({
    max_tokens: MAX_QUIZ_TOKENS,
    temperature: 0.3,
    messages: [{
      role: 'user',
      content: `Du är en studieassistent. Skapa högst 4 frågor med svar från anteckningen. Samma språk som anteckningen.
Om innehållet är tomt/obegripligt: svara exakt INSUFFICIENT_CONTENT

Format (repetera max 4 gånger):
Q: <frågan>
A: <kort svar>
---

Anteckning:
${noteText.slice(0, NOTE_SLICE)}`,
    }],
  });

  if (text.includes('INSUFFICIENT_CONTENT')) throw new Error('INSUFFICIENT_CONTENT');

  const blocks = text.split('---').map((b) => b.trim()).filter(Boolean);
  const results: QuizResult[] = [];
  for (const block of blocks.slice(0, 4)) {
    const qMatch = block.match(/Q:\s*(.+?)(?=\nA:|$)/s);
    const aMatch = block.match(/A:\s*(.+)/s);
    if (qMatch && aMatch) {
      results.push({ question: qMatch[1].trim(), answer: aMatch[1].trim() });
    }
  }
  if (!results.length) throw new Error('Could not parse response');
  return results;
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface FilePart {
  mimeType: string;
  base64: string;
}

export async function sendChatMessageStream(
  history: ChatTurn[],
  userMessage: string,
  onChunk: (chunk: string) => void,
  attachment?: FilePart,
): Promise<void> {
  const token = await getRtdbAuthToken();
  if (!token) throw new Error('Du måste vara inloggad för AI.');

  const messages: ChatMessage[] = history
    .slice(-MAX_HISTORY_TURNS)
    .map((h) => ({
      role: h.role === 'model' ? 'assistant' as const : 'user' as const,
      content: h.text.slice(0, 2000),
    }));

  if (attachment?.mimeType.startsWith('image/') && attachment.base64) {
    if (attachment.base64.length > MAX_IMAGE_BASE64_CHARS) {
      throw new Error('Bilden är för stor för AI (max ~250 KB).');
    }
    const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` } },
    ];
    parts.push({ type: 'text', text: (userMessage || 'Beskriv bilden kort.').slice(0, 1000) });
    messages.push({ role: 'user', content: parts });
  } else {
    messages.push({
      role: 'user',
      content: (userMessage || (attachment ? `[Fil: ${attachment.mimeType}]` : '')).slice(0, 2000),
    });
  }

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messages,
      max_tokens: MAX_CHAT_TOKENS,
      temperature: 0.4,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string; error?: string };
    throw new Error(err.message || err.error || `AI error: ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6).trim();
      if (!json) continue;
      try {
        const parsed = JSON.parse(json) as {
          delta?: string;
          done?: boolean;
          usage?: { total_tokens?: number };
        };
        if (parsed.delta) onChunk(parsed.delta);
        if (parsed.done) reportTokens(parsed.usage?.total_tokens);
      } catch { /* skip */ }
    }
  }
}

export async function answerQuestion(
  question: string,
  style: AiAnswerStyle = 'short',
): Promise<string> {
  const q = question.replace(/<[^>]*>/g, '').trim().slice(0, 1500);
  const long = style === 'long';
  const instruction = long
    ? 'Besvara långt och avancerat på samma språk som frågan. Ge ett utförligt, djupgående svar med relevanta detaljer, nyanser och förklaringar där det behövs. Endast svaret.'
    : 'Besvara kort och koncist på samma språk som frågan. Håll dig till det väsentliga utan onödig utfyllnad. Endast svaret.';
  return callAi({
    max_tokens: long ? MAX_ANSWER_TOKENS_LONG : MAX_ANSWER_TOKENS_SHORT,
    temperature: long ? 0.35 : 0.2,
    messages: [{
      role: 'user',
      content: `${instruction}\n\nFråga: ${q}`,
    }],
  });
}
