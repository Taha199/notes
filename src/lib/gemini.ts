const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string;
const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

export async function generateQuizQuestion(noteText: string): Promise<string> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Based on the following note content, generate ONE clear and concise quiz question to test understanding. Return ONLY the question, no explanations or extra text.\n\nNote content:\n${noteText.slice(0, 3000)}`,
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error('Gemini API error: ' + res.status);
  const data = await res.json();
  const question = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!question) throw new Error('No question returned');
  return question;
}
