/**
 * Quiz set / folder accent palette.
 * Laid out as 6 columns × 5 rows (hue rainbow, then deeper tones) for a tidy picker grid.
 */
export const QUIZ_SET_COLORS = [
  // Row 1 — warm → cool brights
  '#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  // Row 2 — cools → violets
  '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  // Row 3 — magentas → neutrals
  '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#64748b', '#71717a',
  // Row 4 — deeper warm → green
  '#dc2626', '#ea580c', '#ca8a04', '#65a30d', '#16a34a', '#059669',
  // Row 5 — deeper teal → rose
  '#0d9488', '#0284c7', '#4f46e5', '#7c3aed', '#c026d3', '#e11d48',
] as const;

export const QUIZ_COLOR_GRID_COLS = 6;

export type QuizSetColorOption = { name: string; value: string };

/** Picker options: clear/default + full palette (hex as tooltip label). */
export function getQuizSetColorOptions(defaultLabel: string): QuizSetColorOption[] {
  return [
    { name: defaultLabel, value: '' },
    ...QUIZ_SET_COLORS.map((value) => ({ name: value, value })),
  ];
}
