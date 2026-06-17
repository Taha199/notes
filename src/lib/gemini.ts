const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

export interface QuizResult {
  question: string;
  answer: string;
}

export async function generateQuiz(noteText: string): Promise<QuizResult> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Baserat på följande anteckningsinnehåll, generera EN fråga och dess svar på svenska.

Om innehållet är för kort, oklart eller inte meningsfullt nog för att skapa en bra fråga, svara exakt med: INSUFFICIENT_CONTENT

Annars svara i exakt detta format:
QUESTION: <frågan på svenska>
ANSWER: <svaret på svenska>

Anteckningsinnehåll:
${noteText.slice(0, 3000)}`,
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
  const qMatch = text.match(/QUESTION:\s*(.+?)(?=\nANSWER:|$)/s);
  const aMatch = text.match(/ANSWER:\s*(.+)/s);
  if (!qMatch || !aMatch) throw new Error('Could not parse response');
  return { question: qMatch[1].trim(), answer: aMatch[1].trim() };
}
