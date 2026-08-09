/** User preference for quiz AI Answer length/depth. Persisted in localStorage. */

export type AiAnswerStyle = 'short' | 'long';

const STORAGE_KEY = 'malacadhati_ai_answer_style';

export function readAiAnswerStyle(): AiAnswerStyle {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'long' || v === 'short') return v;
  } catch {
    /* ignore */
  }
  return 'short';
}

export function writeAiAnswerStyle(style: AiAnswerStyle): void {
  try {
    localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* ignore */
  }
}
