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

async function inlineImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.currentSrc || img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'include' });
      if (!res.ok) return;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) return;
      img.src = await blobToDataUrl(blob);
      img.removeAttribute('srcset');
    } catch {
      /* keep original src; html2canvas may still capture it */
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
      window.setTimeout(done, 5000);
    });
  })).then(() => undefined);
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
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
  });
  return wrap.innerHTML;
}

const BRAND = {
  primary: [108, 99, 255] as const,
  primaryDark: [90, 82, 224] as const,
  textSecondary: [107, 114, 128] as const,
  border: [229, 231, 235] as const,
};

const MARGIN = 12;
const HEADER_HEIGHT = 32;
const FOOTER_HEIGHT = 14;
const CARD_GAP = 6;
const CAPTURE_WIDTH = 900;

type Rgb = readonly [number, number, number];

function buildCardElement(
  index: number,
  item: QuizItem,
  labels: { question: string; answer: string; explanation: string },
): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = [
    'overflow:hidden',
    'border:1px solid #e5e7eb',
    'border-radius:14px',
    'background:#fff',
    'font-family:Inter,ui-sans-serif,system-ui,sans-serif',
    'color:#1f2937',
    'box-shadow:inset 4px 0 0 0 #6c63ff',
  ].join(';');

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:minmax(0,0.8fr) minmax(0,1.2fr);align-items:stretch';

  const questionCol = document.createElement('div');
  questionCol.style.cssText = 'min-width:0;padding:16px 18px;background:#fff';
  questionCol.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span style="display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;background:#f0efff;color:#6c63ff;font-size:12px;font-weight:800">${index + 1}</span>
      <span style="font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af">${labels.question}</span>
    </div>
    <div class="note-content" dir="auto" style="font-size:14px;font-weight:600;line-height:1.65">${prepareContentHtml(item.question)}</div>
  `;

  const answerCol = document.createElement('div');
  answerCol.style.cssText = 'min-width:0;padding:16px 20px 16px 18px;background:#f8fafc;border-left:1px solid #e5e7eb';
  let answerHtml = `
    <div style="margin-bottom:8px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#6c63ff">${labels.answer}</div>
    <div class="note-content" dir="auto" style="font-size:14px;line-height:1.7">${prepareContentHtml(item.answer)}</div>
  `;
  if (item.explanation?.trim()) {
    answerHtml += `
      <div style="margin-top:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:10px 12px">
        <div style="margin-bottom:4px;font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#b45309">${labels.explanation}</div>
        <div class="note-content" dir="auto" style="font-size:13px;line-height:1.6;color:#78350f">${prepareContentHtml(item.explanation)}</div>
      </div>
    `;
  }
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

  const drawHeader = (firstPage: boolean) => {
    if (!firstPage) return;
    setFill(BRAND.primary);
    doc.rect(0, 0, pageWidth, HEADER_HEIGHT, 'F');
    setFill(BRAND.primaryDark);
    doc.rect(pageWidth * 0.55, 0, pageWidth * 0.45, HEADER_HEIGHT, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(255, 255, 255);
    const titleLines = doc.splitTextToSize(title, contentWidth - 8);
    doc.text(titleLines.slice(0, 2), MARGIN, 14);

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

  const addCanvas = (canvas: HTMLCanvasElement) => {
    const imgW = contentWidth;
    const pxPerMm = canvas.width / imgW;
    let srcY = 0;
    while (srcY < canvas.height - 1) {
      let availMm = contentBottom - y;
      if (availMm < 18) {
        newPage();
        availMm = contentBottom - y;
      }
      const slicePx = Math.min(canvas.height - srcY, Math.floor(availMm * pxPerMm));
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.max(1, slicePx);
      const ctx = slice.getContext('2d');
      if (!ctx) break;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, slice.width, slice.height);
      ctx.drawImage(canvas, 0, srcY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);
      const sliceMm = slicePx / pxPerMm;
      doc.addImage(slice.toDataURL('image/jpeg', 0.82), 'JPEG', MARGIN, y, imgW, sliceMm);
      srcY += slicePx;
      y += sliceMm;
      if (srcY < canvas.height - 1) newPage();
    }
    y += CARD_GAP;
  };

  const host = document.createElement('div');
  host.setAttribute('data-quiz-pdf-host', '1');
  host.style.cssText = `position:fixed;left:-14000px;top:0;width:${CAPTURE_WIDTH}px;background:#fff;color:#1f2937;z-index:-1;pointer-events:none;`;
  document.body.appendChild(host);

  drawHeader(true);

  try {
    for (let i = 0; i < items.length; i += 1) {
      host.replaceChildren(buildCardElement(i, items[i], labels));
      await inlineImages(host);
      await waitForImages(host);
      const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
        width: CAPTURE_WIDTH,
        windowWidth: CAPTURE_WIDTH,
        onclone: (cloned) => {
          cloned.documentElement.classList.remove('dark');
          cloned.body.classList.remove('dark');
        },
      });
      addCanvas(canvas);
    }
  } finally {
    host.remove();
  }

  drawFooter();
  doc.save(`${sanitizeFilename(title)}.pdf`);
}
