import { jsPDF } from 'jspdf';
import type { QuizItem } from '../types';

function mdToHtml(content: string): string {
  if (/<[a-z][\s\S]*>/i.test(content)) return content;
  return content
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

function htmlToPlain(content: string): string {
  const html = mdToHtml(content);
  const div = document.createElement('div');
  div.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n');
  const text = div.textContent ?? div.innerText ?? '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'quiz').slice(0, 100);
}

const LINE_HEIGHT = 5;
const SECTION_GAP = 4;
const ITEM_GAP = 6;

export function exportQuizSetToPdf(
  title: string,
  items: QuizItem[],
  labels: { question: string; answer: string; explanation: string; generatedOn: string },
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeLines = (lines: string[], fontSize: number, bold = false) => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    for (const line of lines) {
      ensureSpace(LINE_HEIGHT);
      doc.text(line, margin, y);
      y += LINE_HEIGHT;
    }
  };

  writeLines(doc.splitTextToSize(title, contentWidth), 16, true);
  y += 2;

  const generated = `${labels.generatedOn}: ${new Date().toLocaleDateString()}`;
  writeLines(doc.splitTextToSize(generated, contentWidth), 9);
  y += SECTION_GAP;

  items.forEach((item, index) => {
    ensureSpace(20);

    writeLines(doc.splitTextToSize(`${index + 1}. ${labels.question}`, contentWidth), 11, true);
    writeLines(doc.splitTextToSize(htmlToPlain(item.question), contentWidth), 10);
    y += 2;

    writeLines(doc.splitTextToSize(labels.answer, contentWidth), 10, true);
    writeLines(doc.splitTextToSize(htmlToPlain(item.answer), contentWidth), 10);
    y += 2;

    if (item.explanation?.trim()) {
      writeLines(doc.splitTextToSize(labels.explanation, contentWidth), 10, true);
      writeLines(doc.splitTextToSize(htmlToPlain(item.explanation), contentWidth), 10);
      y += 2;
    }

    y += ITEM_GAP;
  });

  doc.save(`${sanitizeFilename(title)}.pdf`);
}
