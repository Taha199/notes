import type { QuizItem, QuizSection } from '../types';

export type QuizListRow =
  | { type: 'section'; section: QuizSection }
  | { type: 'item'; item: QuizItem; questionNumber: number };

export function pruneQuizSections(sections: QuizSection[], itemIds: Iterable<number>): QuizSection[] {
  const live = new Set(itemIds);
  return sections.filter((section) => live.has(section.beforeItemId) && section.title.trim());
}

export function buildQuizListRows(
  orderedItems: QuizItem[],
  sections: QuizSection[] = [],
): QuizListRow[] {
  const byAnchor = new Map<number, QuizSection[]>();
  for (const section of sections) {
    if (!section.beforeItemId || !section.title.trim()) continue;
    const list = byAnchor.get(section.beforeItemId) ?? [];
    list.push(section);
    byAnchor.set(section.beforeItemId, list);
  }

  const rows: QuizListRow[] = [];
  let questionNumber = 0;
  for (const item of orderedItems) {
    const headings = byAnchor.get(item.id);
    if (headings?.length) {
      for (const section of headings) rows.push({ type: 'section', section });
    }
    questionNumber += 1;
    rows.push({ type: 'item', item, questionNumber });
  }
  return rows;
}

export function mergeQuizSections(local: QuizSection[] = [], remote: QuizSection[] = []): QuizSection[] {
  const map = new Map<string, QuizSection>();
  for (const section of [...local, ...remote]) {
    if (!section?.id || !section.title.trim()) continue;
    map.set(section.id, section);
  }
  return [...map.values()];
}
