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

const BRAND = {
  primary: [108, 99, 255] as const,
  primaryDark: [90, 82, 224] as const,
  bg: [246, 244, 255] as const,
  text: [31, 41, 55] as const,
  textSecondary: [107, 114, 128] as const,
  border: [229, 231, 235] as const,
  white: [255, 255, 255] as const,
  amber: [180, 83, 9] as const,
  amberBg: [255, 251, 235] as const,
  amberBorder: [253, 230, 138] as const,
};

const MARGIN = 14;
const HEADER_HEIGHT = 32;
const FOOTER_HEIGHT = 14;
const CARD_RADIUS = 3;
const CARD_GAP = 7;
const CARD_PAD = 5;
const NUM_COL_W = 11;
const BODY_LINE = 4.4;
const LABEL_LINE = 3.2;

type Rgb = readonly [number, number, number];

export function exportQuizSetToPdf(
  title: string,
  items: QuizItem[],
  labels: {
    question: string;
    answer: string;
    explanation: string;
    generatedOn: string;
    brandName: string;
    website: string;
  },
): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const contentTop = MARGIN + HEADER_HEIGHT + 4;
  const contentBottom = pageHeight - MARGIN - FOOTER_HEIGHT;
  const generatedDate = new Date().toLocaleDateString();
  let y = contentTop;
  let pageNum = 1;

  const setColor = (c: Rgb) => doc.setTextColor(c[0], c[1], c[2]);
  const setFill = (c: Rgb) => doc.setFillColor(c[0], c[1], c[2]);
  const setDraw = (c: Rgb) => doc.setDrawColor(c[0], c[1], c[2]);

  const drawHeader = () => {
    setFill(BRAND.primary);
    doc.rect(0, 0, pageWidth, HEADER_HEIGHT, 'F');
    setFill(BRAND.primaryDark);
    doc.rect(pageWidth * 0.55, 0, pageWidth * 0.45, HEADER_HEIGHT, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    setColor(BRAND.white);
    const titleLines = doc.splitTextToSize(title, contentWidth - 8);
    doc.text(titleLines.slice(0, 2), MARGIN, 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(`${items.length} ${labels.question.toLowerCase()}${items.length === 1 ? '' : 's'}`, MARGIN, 24);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${labels.generatedOn}: ${generatedDate}`, pageWidth - MARGIN, 24, { align: 'right' });
  };

  const drawFooter = () => {
    const footerY = pageHeight - MARGIN;
    setDraw(BRAND.border);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, footerY - 5, pageWidth - MARGIN, footerY - 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setColor(BRAND.primary);
    doc.text(labels.brandName, MARGIN, footerY);

    doc.setFont('helvetica', 'normal');
    setColor(BRAND.textSecondary);
    doc.text(labels.website, MARGIN + doc.getTextWidth(labels.brandName) + 2, footerY);

    doc.text(String(pageNum), pageWidth - MARGIN, footerY, { align: 'right' });
  };

  const finishPage = () => drawFooter();

  const newPage = () => {
    finishPage();
    doc.addPage();
    pageNum += 1;
    y = MARGIN + 4;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > contentBottom) newPage();
  };

  const colWidths = () => {
    const inner = contentWidth - CARD_PAD * 2 - NUM_COL_W - 2;
    const qW = inner * 0.42;
    const aW = inner - qW - 2;
    return { qW, aW };
  };

  const measureCard = (item: QuizItem) => {
    const { qW, aW } = colWidths();
    doc.setFontSize(8);
    const qLines = doc.splitTextToSize(htmlToPlain(item.question), qW);
    doc.setFontSize(9);
    const aLines = doc.splitTextToSize(htmlToPlain(item.answer), aW);

    let explanationH = 0;
    if (item.explanation?.trim()) {
      doc.setFontSize(8);
      const expLines = doc.splitTextToSize(htmlToPlain(item.explanation), contentWidth - CARD_PAD * 4);
      explanationH = LABEL_LINE + 2 + expLines.length * BODY_LINE + CARD_PAD;
    }

    const labelH = LABEL_LINE + 1;
    const bodyH = Math.max(qLines.length, aLines.length) * BODY_LINE;
    const cardH = CARD_PAD * 2 + labelH + bodyH + explanationH;
    return { qLines, aLines, cardH, explanationH, expLines: item.explanation?.trim()
      ? doc.splitTextToSize(htmlToPlain(item.explanation), contentWidth - CARD_PAD * 4)
      : [] };
  };

  const drawCard = (index: number, item: QuizItem) => {
    const { qW, aW } = colWidths();
    const measured = measureCard(item);
    ensureSpace(measured.cardH + CARD_GAP);

    const cardX = MARGIN;
    const cardY = y;
    const cardW = contentWidth;
    const cardH = measured.cardH;

    setFill(BRAND.white);
    setDraw(BRAND.border);
    doc.setLineWidth(0.35);
    doc.roundedRect(cardX, cardY, cardW, cardH, CARD_RADIUS, CARD_RADIUS, 'FD');

    setFill(BRAND.primary);
    doc.roundedRect(cardX, cardY, 1.2, cardH, CARD_RADIUS, CARD_RADIUS, 'F');

    const numX = cardX + CARD_PAD + 1.5;
    const numY = cardY + CARD_PAD + 2;
    setFill([240, 239, 255]);
    doc.roundedRect(numX - 1, numY - 2.5, NUM_COL_W - 1, 7, 1.5, 1.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setColor(BRAND.primary);
    doc.text(String(index + 1), numX + (NUM_COL_W - 2) / 2, numY + 2, { align: 'center' });

    const qX = cardX + CARD_PAD + NUM_COL_W + 1;
    const aX = qX + qW + 2;
    const dividerX = qX + qW + 1;
    let colTop = cardY + CARD_PAD;

    setDraw(BRAND.border);
    doc.setLineWidth(0.2);
    doc.line(dividerX, colTop, dividerX, cardY + cardH - CARD_PAD - (measured.explanationH || 0));

    setFill(BRAND.bg);
    const answerBgH = cardH - CARD_PAD * 2 - (measured.explanationH || 0);
    doc.roundedRect(aX - 1, colTop - 1, aW + 2, answerBgH + 1, 0, CARD_RADIUS, 'F');
    setDraw(BRAND.border);
    doc.roundedRect(aX - 1, colTop - 1, aW + 2, answerBgH + 1, 0, CARD_RADIUS, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setColor(BRAND.textSecondary);
    doc.text(labels.question.toUpperCase(), qX, colTop);
    doc.setFontSize(6.5);
    setColor(BRAND.primary);
    doc.text(`● ${labels.answer.toUpperCase()}`, aX, colTop);

    const textY = colTop + LABEL_LINE + 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setColor(BRAND.text);
    let qY = textY;
    for (const line of measured.qLines) {
      doc.text(line, qX, qY);
      qY += BODY_LINE;
    }

    doc.setFontSize(9);
    setColor(BRAND.text);
    let aY = textY;
    for (const line of measured.aLines) {
      doc.text(line, aX, aY);
      aY += BODY_LINE;
    }

    if (measured.expLines.length > 0) {
      const expX = cardX + CARD_PAD + 1;
      const expW = cardW - CARD_PAD * 2 - 2;
      const expLines = measured.expLines;
      const expBoxH = LABEL_LINE + 2 + expLines.length * BODY_LINE + 3;
      const expY = cardY + cardH - CARD_PAD - expBoxH;

      setFill(BRAND.amberBg);
      setDraw(BRAND.amberBorder);
      doc.setLineWidth(0.25);
      doc.roundedRect(expX, expY, expW, expBoxH, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6);
      setColor(BRAND.amber);
      doc.text(labels.explanation.toUpperCase(), expX + 3, expY + 4);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setColor(BRAND.text);
      let eY = expY + LABEL_LINE + 5;
      for (const line of expLines) {
        doc.text(line, expX + 3, eY);
        eY += BODY_LINE;
      }
    }

    y += cardH + CARD_GAP;
  };

  drawHeader();

  items.forEach((item, index) => drawCard(index, item));

  finishPage();
  doc.save(`${sanitizeFilename(title)}.pdf`);
}
