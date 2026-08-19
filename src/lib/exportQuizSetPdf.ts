import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { QuizItem } from '../types';
import { mdToHtml } from './quizHtml';

function sanitizeFilename(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'quiz').slice(0, 100);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Helvetica/WinAnsi cannot draw emoji; strip them so they do not become Ø>ÞÁ. */
function pdfSafeText(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cellPlain(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return pdfSafeText(clone.textContent || '');
}

type PdfTable = {
  header: string[] | null;
  body: string[][];
  weights: number[];
};

type PdfBlock =
  | { type: 'text'; text: string }
  | { type: 'table'; table: PdfTable }
  | { type: 'image'; url: string };

function colWeights(table: HTMLTableElement, colCount: number): number[] {
  const cols = Array.from(table.querySelectorAll(':scope > colgroup > col'));
  if (cols.length === colCount) {
    const widths = cols.map((col) => {
      const raw = (col as HTMLElement).style.width || col.getAttribute('width') || '';
      const num = parseFloat(raw);
      return Number.isFinite(num) && num > 0 ? num : 0;
    });
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > 0) return widths.map((w) => w / sum);
  }
  return Array.from({ length: colCount }, () => 1 / colCount);
}

function parseHtmlTable(table: HTMLTableElement): PdfTable {
  const raw = Array.from(table.rows).map((tr) => Array.from(tr.cells).map((cell) => cellPlain(cell)));
  const colCount = Math.max(1, ...raw.map((row) => row.length));
  const padded = raw.map((row) => {
    const next = row.slice();
    while (next.length < colCount) next.push('');
    return next;
  }).filter((row) => row.some((cell) => cell.length > 0));
  if (padded.length === 0) {
    return { header: null, body: [], weights: [1] };
  }
  const firstCells = Array.from(table.rows[0]?.cells ?? []);
  const headerIsTh = firstCells.length > 0 && firstCells.every((cell) => cell.tagName === 'TH');
  return {
    header: headerIsTh ? padded[0] : null,
    body: headerIsTh ? padded.slice(1) : padded,
    weights: colWeights(table, colCount),
  };
}

function parseBlocks(html: string): PdfBlock[] {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const out: PdfBlock[] = [];

  const pushText = (value: string) => {
    const text = pdfSafeText(value);
    if (text) out.push({ type: 'text', text });
  };

  const walk = (node: Node) => {
    if (node instanceof HTMLTableElement) {
      const table = parseHtmlTable(node);
      if (table.header || table.body.length > 0) out.push({ type: 'table', table });
      return;
    }
    if (node instanceof HTMLImageElement) {
      const src = node.currentSrc || node.src || '';
      if (src.startsWith('data:image')) out.push({ type: 'image', url: src });
      return;
    }
    if (!(node instanceof HTMLElement)) {
      if (node.nodeType === Node.TEXT_NODE) pushText(node.textContent || '');
      return;
    }
    if (node.classList.contains('note-table-wrap') || node.classList.contains('note-table-body')) {
      Array.from(node.childNodes).forEach(walk);
      return;
    }
    if (node.querySelector('table, img')) {
      Array.from(node.childNodes).forEach(walk);
      return;
    }
    if (node.tagName === 'LI') {
      pushText(`• ${node.textContent || ''}`);
      return;
    }
    if (node.tagName === 'BR') {
      return;
    }
    pushText(node.innerText || node.textContent || '');
  };

  Array.from(wrap.childNodes).forEach(walk);
  if (out.length === 0) pushText(wrap.innerText || '');
  return out;
}

function htmlToPlain(content: string): string {
  return parseBlocks(prepareContentHtml(content))
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'table') {
        const rows = [...(block.table.header ? [block.table.header] : []), ...block.table.body];
        return rows.map((row) => row.filter(Boolean).join('  |  ')).join('\n');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

function contentHasTable(item: QuizItem): boolean {
  return /<table/i.test(`${item.question}\n${item.answer}\n${item.explanation ?? ''}`);
}

async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not image');
      img.src = await blobToDataUrl(blob);
      img.removeAttribute('srcset');
      img.crossOrigin = 'anonymous';
    } catch {
      img.remove();
    }
  }));
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      window.setTimeout(done, 4000);
    });
  })).then(() => undefined);
}

const PDF_TABLE_CSS = `
.note-content table, .note-content table.note-table {
  width: 100% !important;
  border-collapse: collapse !important;
  table-layout: auto !important;
  font-size: 12px !important;
}
.note-content th, .note-content td,
.note-content table.note-table th, .note-content table.note-table td {
  border: 1px solid #d1d5db !important;
  padding: 6px 8px !important;
  vertical-align: top !important;
  text-align: left !important;
  overflow-wrap: anywhere !important;
  word-break: break-word !important;
  hyphens: manual !important;
  background: #fff !important;
}
.note-content th, .note-content table.note-table th {
  background: #e8eef5 !important;
  font-weight: 700 !important;
}
.note-content .note-table-wrap {
  display: block !important;
  overflow: visible !important;
  max-width: 100% !important;
  margin: 8px 0 !important;
  border: 1px solid #d1d5db !important;
  border-radius: 8px !important;
  background: #fff !important;
}
`;

function styleTablesInline(root: HTMLElement) {
  root.querySelectorAll('table').forEach((table) => {
    const el = table as HTMLTableElement;
    el.style.width = '100%';
    el.style.borderCollapse = 'collapse';
    el.style.tableLayout = 'auto';
    el.style.fontSize = '12px';
    el.querySelectorAll('th, td').forEach((cell) => {
      const td = cell as HTMLElement;
      td.style.border = '1px solid #d1d5db';
      td.style.padding = '6px 8px';
      td.style.verticalAlign = 'top';
      td.style.textAlign = 'left';
      td.style.overflowWrap = 'anywhere';
      td.style.wordBreak = 'break-word';
      td.style.background = td.tagName === 'TH' ? '#e8eef5' : '#fff';
      if (td.tagName === 'TH') td.style.fontWeight = '700';
    });
  });
  root.querySelectorAll('.note-table-wrap').forEach((wrap) => {
    const el = wrap as HTMLElement;
    el.style.overflow = 'visible';
    el.style.maxWidth = '100%';
    el.style.border = '1px solid #d1d5db';
    el.style.borderRadius = '8px';
    el.style.background = '#fff';
  });
}

function prepareContentHtml(raw: string): string {
  const wrap = document.createElement('div');
  wrap.innerHTML = mdToHtml(raw);
  wrap.querySelectorAll(
    '.note-yt-frame, iframe, .note-table-toolbar-host, .note-img-frame__toolbar-host, .note-img-frame__toolbar, .note-yt-remove',
  ).forEach((node) => node.remove());
  wrap.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'));
  wrap.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('srcset');
    img.loading = 'eager';
    img.crossOrigin = 'anonymous';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
  });
  styleTablesInline(wrap);
  return wrap.innerHTML;
}

const BRAND = {
  primary: [108, 99, 255] as const,
  primaryDark: [90, 82, 224] as const,
  bg: [246, 244, 255] as const,
  text: [31, 41, 55] as const,
  textSecondary: [107, 114, 128] as const,
  border: [229, 231, 235] as const,
  headerBg: [232, 238, 245] as const,
  white: [255, 255, 255] as const,
};

const MARGIN = 12;
const HEADER_HEIGHT = 32;
const FOOTER_HEIGHT = 14;
const CARD_GAP = 6;
const CARD_PAD = 5;
const NUM_COL_W = 11;
const BODY_LINE = 4.4;
const LABEL_LINE = 3.2;
const CAPTURE_WIDTH = 860;
const PT_TO_MM = 0.352778;

type Rgb = readonly [number, number, number];

function buildCardElement(
  index: number,
  item: QuizItem,
  labels: { question: string; answer: string; explanation: string },
): HTMLElement {
  const stacked = contentHasTable(item);
  const card = document.createElement('div');
  card.style.cssText = [
    `width:${CAPTURE_WIDTH}px`,
    'overflow:visible',
    'border:1px solid #e5e7eb',
    'border-radius:14px',
    'background:#fff',
    'font-family:Inter,ui-sans-serif,system-ui,sans-serif',
    'color:#1f2937',
    'box-shadow:inset 4px 0 0 0 #6c63ff',
  ].join(';');

  const questionHtml = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;background:#f0efff;color:#6c63ff;font-size:12px;font-weight:800">${index + 1}</span>
      <span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af">${labels.question}</span>
    </div>
    <div style="border:1px solid #c7c2ff;border-radius:12px;background:#f6f4ff;padding:12px 14px;box-shadow:inset 3px 0 0 0 #6c63ff">
      <div class="note-content" dir="auto" style="font-size:14px;font-weight:600;line-height:1.65">${prepareContentHtml(item.question)}</div>
    </div>
  `;
  let answerHtml = `
    <div style="margin-bottom:8px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6c63ff">${labels.answer}</div>
    <div class="note-content" dir="auto" style="font-size:13px;line-height:1.55">${prepareContentHtml(item.answer)}</div>
  `;
  if (item.explanation?.trim()) {
    answerHtml += `
      <div style="margin-top:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:10px 12px">
        <div style="margin-bottom:4px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#b45309">${labels.explanation}</div>
        <div class="note-content" dir="auto" style="font-size:13px;line-height:1.6;color:#78350f">${prepareContentHtml(item.explanation)}</div>
      </div>
    `;
  }

  if (stacked) {
    const col = document.createElement('div');
    col.style.cssText = 'min-width:0;padding:16px 18px;background:#fff';
    col.innerHTML = `${questionHtml}<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e7eb">${answerHtml}</div>`;
    card.appendChild(col);
    return card;
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr);align-items:stretch';
  const questionCol = document.createElement('div');
  questionCol.style.cssText = 'min-width:0;padding:16px 18px;background:#fff';
  questionCol.innerHTML = questionHtml;
  const answerCol = document.createElement('div');
  answerCol.style.cssText = 'min-width:0;padding:16px 20px 16px 18px;background:#f8fafc;border-left:1px solid #e5e7eb';
  answerCol.innerHTML = answerHtml;
  grid.append(questionCol, answerCol);
  card.appendChild(grid);
  return card;
}

export async function exportQuizSetToPdf(
  title: string,
  items: QuizItem[],
  labels: {
    question: string;
    answer: string;
    explanation: string;
    generatedOn: string;
    brandName: string;
    website: string;
    questionCount: string;
  },
): Promise<void> {
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
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    doc.text(doc.splitTextToSize(title, contentWidth - 8).slice(0, 2), MARGIN, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`${items.length} ${labels.questionCount}`, MARGIN, 24);
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

  const newPage = () => {
    drawFooter();
    doc.addPage();
    pageNum += 1;
    y = MARGIN + 4;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > contentBottom) newPage();
  };

  const addCanvas = (canvas: HTMLCanvasElement) => {
    if (canvas.width < 8 || canvas.height < 8) throw new Error('empty snapshot');
    const imgW = contentWidth;
    const pxPerMm = canvas.width / imgW;
    let srcY = 0;
    while (srcY < canvas.height - 1) {
      let availMm = contentBottom - y;
      if (availMm < 18) {
        newPage();
        availMm = contentBottom - y;
      }
      const slicePx = Math.max(1, Math.min(canvas.height - srcY, Math.floor(availMm * pxPerMm)));
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = slicePx;
      const ctx = slice.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
      const sliceMm = slicePx / pxPerMm;
      try {
        doc.addImage(slice.toDataURL('image/jpeg', 0.82), 'JPEG', MARGIN, y, imgW, sliceMm);
      } catch {
        doc.addImage(slice.toDataURL('image/png'), 'PNG', MARGIN, y, imgW, sliceMm);
      }
      srcY += slicePx;
      y += sliceMm;
      if (srcY < canvas.height - 1) newPage();
    }
    y += CARD_GAP;
  };

  const colWidths = () => {
    const inner = contentWidth - CARD_PAD * 2 - NUM_COL_W - 2;
    const qW = inner * 0.42;
    return { qW, aW: inner - qW - 2 };
  };

  const drawPdfTable = (table: PdfTable, x: number, width: number) => {
    const colCount = table.weights.length;
    if (colCount === 0) return;
    const fontSize = colCount >= 4 ? 7.5 : colCount === 3 ? 8 : 9;
    const lineH = fontSize * PT_TO_MM * 1.28;
    const pad = 1.4;
    const widths = table.weights.map((w) => w * width);

    const wrappedRow = (cells: string[]) => cells.map((cell, i) => {
      doc.setFontSize(fontSize);
      return doc.splitTextToSize(cell || ' ', Math.max(8, widths[i] - pad * 2)) as string[];
    });

    const rowHeight = (lines: string[][]) => {
      const maxLines = Math.max(1, ...lines.map((cell) => cell.length));
      return maxLines * lineH + pad * 2;
    };

    const paintRow = (cells: string[], header: boolean) => {
      const lines = wrappedRow(cells);
      let h = rowHeight(lines);
      if (y + h > contentBottom && y > MARGIN + 6) {
        newPage();
        if (!header && table.header) {
          paintRow(table.header, true);
        }
      }
      h = rowHeight(lines);
      let cx = x;
      lines.forEach((cellLines, i) => {
        const w = widths[i];
        if (header) {
          setFill(BRAND.headerBg);
          doc.rect(cx, y, w, h, 'F');
        } else {
          setFill(BRAND.white);
          doc.rect(cx, y, w, h, 'F');
        }
        setDraw(BRAND.border);
        doc.setLineWidth(0.2);
        doc.rect(cx, y, w, h, 'S');
        doc.setFont('helvetica', header ? 'bold' : 'normal');
        doc.setFontSize(fontSize);
        setColor(BRAND.text);
        const textY = y + pad + fontSize * PT_TO_MM * 0.85;
        doc.text(cellLines, cx + pad, textY);
        cx += w;
      });
      y += h;
    };

    if (table.header) paintRow(table.header, true);
    table.body.forEach((row) => paintRow(row, false));
  };

  const drawImages = (urls: string[]) => {
    for (const url of urls) {
      try {
        const imgW = Math.min(contentWidth, 80);
        const imgH = 48;
        ensureSpace(imgH + 4);
        doc.addImage(url, url.includes('png') ? 'PNG' : 'JPEG', MARGIN, y, imgW, imgH);
        y += imgH + 4;
      } catch {
        /* skip broken image */
      }
    }
  };

  const drawBlocks = (blocks: PdfBlock[], x: number, width: number, fontSize: number) => {
    for (const block of blocks) {
      if (block.type === 'text') {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fontSize);
        setColor(BRAND.text);
        const lines = doc.splitTextToSize(block.text || ' ', width) as string[];
        const h = Math.max(BODY_LINE, lines.length * BODY_LINE);
        ensureSpace(h + 1);
        lines.forEach((line: string, i: number) => doc.text(line, x, y + 3.2 + i * BODY_LINE));
        y += h + 1;
      } else if (block.type === 'table') {
        ensureSpace(16);
        drawPdfTable(block.table, x, width);
        y += 2;
      } else {
        drawImages([block.url]);
      }
    }
  };

  const estimateBlocksHeight = (blocks: PdfBlock[], width: number, fontSize: number) => {
    let total = 0;
    for (const block of blocks) {
      if (block.type === 'text') {
        doc.setFontSize(fontSize);
        const lines = doc.splitTextToSize(block.text || ' ', width) as string[];
        total += Math.max(BODY_LINE, lines.length * BODY_LINE) + 1;
      } else if (block.type === 'table') {
        total += 16;
      }
    }
    return Math.max(total, 8);
  };

  const drawFramedQuestion = (index: number, blocks: PdfBlock[]) => {
    const framePad = 4.5;
    const innerX = MARGIN + framePad + 1.5;
    const innerW = contentWidth - framePad * 2 - 1.5;
    const fontSize = 10.5;
    const qBlocks = blocks.filter((b) => b.type !== 'image');

    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setColor(BRAND.primary);
    doc.text(String(index + 1), MARGIN, y + 4);
    doc.setFontSize(6.5);
    setColor(BRAND.textSecondary);
    doc.text(labels.question.toUpperCase(), MARGIN + 8, y + 4);
    y += 7;

    const innerH = estimateBlocksHeight(qBlocks, innerW, fontSize);
    ensureSpace(innerH + framePad * 2 + 6);
    const frameY = y;
    const frameH = innerH + framePad * 2;

    setFill(BRAND.bg);
    setDraw(BRAND.primary);
    doc.setLineWidth(0.45);
    doc.roundedRect(MARGIN, frameY, contentWidth, frameH, 3, 3, 'FD');
    setFill(BRAND.primary);
    doc.roundedRect(MARGIN, frameY, 1.2, frameH, 3, 3, 'F');

    y = frameY + framePad;
    drawBlocks(qBlocks, innerX, innerW, fontSize);
    y = Math.max(y, frameY + frameH) + 5;
  };

  const drawNativeItem = (index: number, item: QuizItem, extraImages: string[]) => {
    const qBlocks = parseBlocks(prepareContentHtml(item.question));
    const aBlocks = parseBlocks(prepareContentHtml(item.answer));
    const eBlocks = item.explanation?.trim()
      ? parseBlocks(prepareContentHtml(item.explanation))
      : [];
    const stacked = qBlocks.some((b) => b.type === 'table')
      || aBlocks.some((b) => b.type === 'table')
      || eBlocks.some((b) => b.type === 'table');

    if (stacked) {
      drawFramedQuestion(index, qBlocks);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      setColor(BRAND.primary);
      ensureSpace(8);
      doc.text(labels.answer.toUpperCase(), MARGIN, y + 3);
      y += 6;
      drawBlocks(aBlocks, MARGIN, contentWidth, 9);
      if (eBlocks.length > 0) {
        y += 2;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        setColor([180, 83, 9]);
        ensureSpace(8);
        doc.text(labels.explanation.toUpperCase(), MARGIN, y + 3);
        y += 6;
        drawBlocks(eBlocks, MARGIN, contentWidth, 8);
      }
      drawImages(extraImages);
      y += CARD_GAP;
      return;
    }

    const { qW, aW } = colWidths();
    doc.setFontSize(8.5);
    const qLines = doc.splitTextToSize(htmlToPlain(item.question) || ' ', qW);
    doc.setFontSize(9);
    const aLines = doc.splitTextToSize(htmlToPlain(item.answer) || ' ', aW);
    const bodyH = Math.max(qLines.length, aLines.length) * BODY_LINE;
    const cardH = CARD_PAD * 2 + LABEL_LINE + 2 + bodyH;
    ensureSpace(cardH + CARD_GAP);

    const cardX = MARGIN;
    const cardY = y;
    setFill(BRAND.white);
    setDraw(BRAND.border);
    doc.setLineWidth(0.35);
    doc.roundedRect(cardX, cardY, contentWidth, cardH, 3, 3, 'FD');
    setFill(BRAND.primary);
    doc.roundedRect(cardX, cardY, 1.2, cardH, 3, 3, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setColor(BRAND.primary);
    doc.text(String(index + 1), cardX + CARD_PAD + 4, cardY + CARD_PAD + 5);

    const qX = cardX + CARD_PAD + NUM_COL_W;
    const aX = qX + qW + 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setColor(BRAND.textSecondary);
    doc.text(labels.question.toUpperCase(), qX, cardY + CARD_PAD + 3);
    setColor(BRAND.primary);
    doc.text(labels.answer.toUpperCase(), aX, cardY + CARD_PAD + 3);

    const textY = cardY + CARD_PAD + LABEL_LINE + 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setColor(BRAND.text);
    qLines.forEach((line: string, i: number) => doc.text(line, qX, textY + i * BODY_LINE));
    doc.setFontSize(9);
    aLines.forEach((line: string, i: number) => doc.text(line, aX, textY + i * BODY_LINE));
    y += cardH + CARD_GAP;
    drawImages(extraImages);
  };

  const host = document.createElement('div');
  host.setAttribute('data-quiz-pdf-host', '1');
  host.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    `width:${CAPTURE_WIDTH}px`,
    'background:#fff',
    'color:#1f2937',
    'z-index:0',
    'pointer-events:none',
  ].join(';');
  const hostStyle = document.createElement('style');
  hostStyle.textContent = PDF_TABLE_CSS;
  host.appendChild(hostStyle);
  document.body.appendChild(host);

  const snapshotCard = async (card: HTMLElement) => {
    const opts = {
      backgroundColor: '#ffffff',
      scale: 1.6,
      useCORS: true,
      allowTaint: false,
      logging: false,
      width: CAPTURE_WIDTH,
      windowWidth: CAPTURE_WIDTH,
      scrollX: 0,
      scrollY: 0,
      onclone: (cloned: Document) => {
        cloned.documentElement.classList.remove('dark');
        cloned.body.classList.remove('dark');
        const style = cloned.createElement('style');
        style.textContent = PDF_TABLE_CSS;
        cloned.head.appendChild(style);
        const clonedCard = cloned.querySelector('[data-quiz-pdf-host]') ?? cloned.body;
        if (clonedCard instanceof HTMLElement) styleTablesInline(clonedCard);
      },
    } as const;
    return html2canvas(card, opts);
  };

  drawHeader();

  try {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const card = buildCardElement(i, item, labels);
      host.replaceChildren(hostStyle, card);
      await inlineImages(host);
      await waitForImages(host);
      styleTablesInline(card);
      const imageUrls = Array.from(host.querySelectorAll('img'))
        .map((img) => img.src)
        .filter((src) => src.startsWith('data:image'));
      if (contentHasTable(item)) {
        // Tables must be drawn as a real grid. html2canvas often flattens them
        // into a text blob and Helvetica turns emoji into garbage (Ø>ÞÁ).
        drawNativeItem(i, item, imageUrls);
        continue;
      }
      try {
        const canvas = await snapshotCard(card);
        addCanvas(canvas);
      } catch (err) {
        console.warn('[quiz pdf] snapshot failed, using native fallback', err);
        drawNativeItem(i, item, imageUrls);
      }
    }
  } finally {
    host.remove();
  }

  drawFooter();
  doc.save(`${sanitizeFilename(title)}.pdf`);
}
