/**
 * AI client (OpenAI Chat Completions).
 * File kept as gemini.ts so existing imports stay stable.
 */
const API_KEY = (import.meta.env.VITE_OPENAI_API_KEY as string | undefined)?.trim() ?? '';

let tokenSink: ((n: number) => void) | null = null;
export function setTokenSink(fn: (n: number) => void) { tokenSink = fn; }
function reportTokens(n?: number) {
  if (n && n > 0) tokenSink?.(n);
}

const MODEL = 'gpt-4o-mini';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

type OpenAIMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'user'; content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> };

type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string | null }; delta?: { content?: string | null } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string };
};

function assertApiKey() {
  if (!API_KEY) {
    throw new Error('AI API-nyckel saknas. Sätt VITE_OPENAI_API_KEY i Vercel och gör Redeploy.');
  }
}

async function chatCompletion(messages: OpenAIMessage[]): Promise<string> {
  assertApiKey();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 4096,
      temperature: 0.4,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as OpenAIResponse;
  if (!res.ok) {
    throw new Error(data?.error?.message || `OpenAI API error: ${res.status}`);
  }
  reportTokens(data.usage?.total_tokens);
  const text = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) throw new Error('No response returned');
  return text;
}

export interface QuizResult {
  question: string;
  answer: string;
}

export async function generateQuiz(noteText: string): Promise<QuizResult[]> {
  const text = await chatCompletion([
    {
      role: 'user',
      content: `Du är en medicinsk/vetenskaplig assistent. Identifiera vilket språk anteckningsinnehållet är skrivet på och använd SAMMA språk i alla frågor och svar.

Analysera följande anteckningsinnehåll:

- Om innehållet redan innehåller en fråga (utan svar): besvara frågan på samma språk och returnera den som ett Q&A-par.
- Om innehållet är en längre text: generera frågor och svar på samma språk som täcker ALLA delar.
- Om innehållet är helt obegripligt eller tomt: svara exakt med: INSUFFICIENT_CONTENT

Svara i exakt detta format (repetera för varje fråga):
Q: <frågan>
A: <svaret>
---

Anteckningsinnehåll:
${noteText.slice(0, 6000)}`,
    },
  ]);
  if (text.includes('INSUFFICIENT_CONTENT')) throw new Error('INSUFFICIENT_CONTENT');

  const blocks = text.split('---').map((b: string) => b.trim()).filter(Boolean);
  const results: QuizResult[] = [];
  for (const block of blocks) {
    const qMatch = block.match(/Q:\s*(.+?)(?=\nA:|$)/s);
    const aMatch = block.match(/A:\s*(.+)/s);
    if (qMatch && aMatch) {
      results.push({ question: qMatch[1].trim(), answer: aMatch[1].trim() });
    }
  }
  if (!results.length) throw new Error('Could not parse response');

  const verified = await verifyAnswers(noteText, results);
  return verified;
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
  assertApiKey();

  const messages: OpenAIMessage[] = history.map((h) => ({
    role: h.role === 'model' ? 'assistant' as const : 'user' as const,
    content: h.text,
  }));

  if (attachment?.mimeType.startsWith('image/') && attachment.base64) {
    const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'image_url', image_url: { url: `data:${attachment.mimeType};base64,${attachment.base64}` } },
    ];
    if (userMessage) parts.push({ type: 'text', text: userMessage });
    else parts.push({ type: 'text', text: 'Describe or help with this image.' });
    messages.push({ role: 'user', content: parts });
  } else {
    const text = userMessage
      || (attachment ? `[Attached file: ${attachment.mimeType}]` : '');
    messages.push({ role: 'user', content: text });
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 4096,
      temperature: 0.5,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as OpenAIResponse;
    throw new Error(err?.error?.message || `OpenAI API error: ${res.status}`);
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
      if (!json || json === '[DONE]') continue;
      try {
        const parsed = JSON.parse(json) as OpenAIResponse & {
          usage?: { total_tokens?: number };
        };
        if (parsed.usage?.total_tokens) reportTokens(parsed.usage.total_tokens);
        const chunk = parsed.choices?.[0]?.delta?.content ?? '';
        if (chunk) onChunk(chunk);
      } catch { /* skip malformed */ }
    }
  }
}

export async function answerQuestion(question: string): Promise<string> {
  return chatCompletion([
    {
      role: 'user',
      content: `Besvara följande fråga på samma språk som frågan är skriven på. Ge ett tydligt och korrekt svar. Returnera ENDAST svaret, utan förklaringar eller extra text.\n\nFråga: ${question.replace(/<[^>]*>/g, '').trim()}`,
    },
  ]);
}

async function verifyAnswers(noteText: string, items: QuizResult[]): Promise<QuizResult[]> {
  try {
    const qa = items.map((item, i) => `${i + 1}. F: ${item.question}\n   S: ${item.answer}`).join('\n');
    const text = await chatCompletion([
      {
        role: 'user',
        content: `Du är en medicinsk/vetenskaplig granskare. Använd samma språk som anteckningsinnehållet och frågorna är skrivna på. Nedan finns anteckningsinnehåll och automatiskt genererade frågor (F) och svar (S).

Granska varje svar och kontrollera att det stämmer med anteckningsinnehållet. Rätta eventuella fel. Svara i exakt samma format:

1. F: <frågan oförändrad>
   S: <det korrekta svaret>
---
(repetera för varje fråga)

Anteckningsinnehåll:
${noteText.slice(0, 4000)}

Frågor och svar att granska:
${qa}`,
      },
    ]);

    const blocks = text.split('---').map((b: string) => b.trim()).filter(Boolean);
    const verified: QuizResult[] = [];
    for (const block of blocks) {
      const qMatch = block.match(/F:\s*(.+?)(?=\n\s*S:|$)/s);
      const aMatch = block.match(/S:\s*(.+)/s);
      if (qMatch && aMatch) {
        verified.push({ question: qMatch[1].trim(), answer: aMatch[1].trim() });
      }
    }
    return verified.length === items.length ? verified : items;
  } catch {
    return items;
  }
}
