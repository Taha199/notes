/** Quiz set / folder accent palette — at least 30 distinct hues for manual pick + auto-assign. */
export const QUIZ_SET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c',
  '#64748b', '#71717a', '#dc2626', '#ea580c', '#ca8a04', '#65a30d',
  '#16a34a', '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb',
  '#4f46e5', '#7c3aed', '#9333ea', '#c026d3', '#db2777', '#e11d48',
] as const;

export type QuizSetColorOption = { name: string; value: string };

/** Picker options: clear/default + full palette (hex as tooltip label). */
export function getQuizSetColorOptions(defaultLabel: string): QuizSetColorOption[] {
  return [
    { name: defaultLabel, value: '' },
    ...QUIZ_SET_COLORS.map((value) => ({ name: value, value })),
  ];
}
