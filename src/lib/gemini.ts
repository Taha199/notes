const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export interface QuizResult {
  question: string;
  answer: string;
}

export async function generateQuiz(noteText: string): Promise<QuizResult[]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Du är en medicinsk/vetenskaplig assistent. Analysera följande anteckningsinnehåll:

- Om innehållet redan innehåller en fråga (utan svar): besvara frågan på svenska och returnera den som ett Q&A-par.
- Om innehållet är en längre text: generera frågor och svar på svenska som täcker ALLA delar.
- Om innehållet är helt obegripligt eller tomt: svara exakt med: INSUFFICIENT_CONTENT

Svara i exakt detta format (repetera för varje fråga):
Q: <frågan på svenska>
A: <svaret på svenska>
---

Anteckningsinnehåll:
${noteText.slice(0, 6000)}`,
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Gemini API error: ' + res.status);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error('No response returned');
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

  // Second pass: verify and correct answers
  const verified = await verifyAnswers(noteText, results);
  return verified;
}

async function verifyAnswers(noteText: string, items: QuizResult[]): Promise<QuizResult[]> {
  const qa = items.map((item, i) => `${i + 1}. F: ${item.question}\n   S: ${item.answer}`).join('\n');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Du är en medicinsk/vetenskaplig granskare. Nedan finns anteckningsinnehåll och automatiskt genererade frågor (F) och svar (S) på svenska.

Granska varje svar och kontrollera att det stämmer med anteckningsinnehållet. Rätta eventuella fel. Svara i exakt samma format:

1. F: <frågan oförändrad>
   S: <det korrekta svaret på svenska>
---
(repetera för varje fråga)

Anteckningsinnehåll:
${noteText.slice(0, 4000)}

Frågor och svar att granska:
${qa}`,
        }],
      }],
    }),
  });
  if (!res.ok) return items; // fallback to original if verify fails
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) return items;

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
}
