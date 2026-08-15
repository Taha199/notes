/** Convert quiz/AI markdown (+ light math) to HTML the rich text editor understands. */

const SUPER: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
};

const SUB: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', n: 'ₙ', i: 'ᵢ',
};

function mapChars(input: string, table: Record<string, string>): string {
  return [...input].map((ch) => table[ch] ?? ch).join('');
}

/** Turn common LaTeX-ish / markdown math into readable Unicode. */
export function convertSimpleMath(text: string): string {
  let s = text;
  // $_{10}$ / _{10} → ₁₀
  s = s.replace(/\$?_\{([^}]+)\}\$?/g, (_, body: string) => mapChars(body, SUB));
  // $^{+}$ → ⁺
  s = s.replace(/\$?\^\{([^}]+)\}\$?/g, (_, body: string) => mapChars(body, SUPER));
  // $^+$ / $^-$ (common AI glitch: H$^+$)
  s = s.replace(/\$\^([+\-−0-9]+)\$/g, (_, body: string) => mapChars(body, SUPER));
  s = s.replace(/\$([+\-−])\$/g, (_, body: string) => mapChars(body, SUPER));
  // Bare H^+ / OH^- after letters or ]
  s = s.replace(/(?<=[\p{L}\]\d])\^([+\-−0-9]+)/gu, (_, body: string) => mapChars(body, SUPER));
  // Bare _10 after log etc.
  s = s.replace(/(?<=[\p{L}\]])_(\d+)/gu, (_, body: string) => mapChars(body, SUB));
  // Strip leftover $ that look like math delimiters (keep currency-like "$5")
  s = s.replace(/\$(?=[\^_{]|[+\-−A-Za-z])/g, '');
  s = s.replace(/(?<=[A-Za-z0-9+\-−}])\$/g, '');
  return s;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Bold / italic; bullet markers are handled at block level. */
function formatInline(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
}

function looksLikeHtml(content: string): boolean {
  return /<\/?(?:div|p|br|ul|ol|li|strong|em|b|i|h[1-6]|span|table|thead|tbody|tr|td|th|img|a|blockquote|pre|code)(?:\s[^>]*)?>/i.test(content);
}

/**
 * Convert markdown-ish AI answers to editor HTML.
 * Passes through content that already contains real HTML tags.
 */
export function mdToHtml(content: string | null | undefined): string {
  if (content == null || content === '') return '';
  // Firebase / shell rows sometimes store non-strings — never call .replace on them.
  const raw = typeof content === 'string' ? content : String(content);
  if (!raw) return '';
  if (looksLikeHtml(raw)) return raw;

  const text = convertSimpleMath(raw.replace(/\r\n/g, '\n').trim());
  if (!text) return '';

  const lines = text.split('\n');
  const blocks: string[] = [];
  let listTag: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = () => {
    if (!listTag || listItems.length === 0) {
      listTag = null;
      listItems = [];
      return;
    }
    blocks.push(
      `<${listTag} dir="auto">${listItems.map((item) => `<li dir="auto">${item}</li>`).join('')}</${listTag}>`,
    );
    listTag = null;
    listItems = [];
  };

  const inline = (raw: string) => formatInline(escapeHtml(raw.trim()));

  for (const line of lines) {
    if (!line.trim()) {
      flushList();
      if (blocks.length > 0 && blocks[blocks.length - 1] !== '__gap__') {
        blocks.push('__gap__');
      }
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(`<div dir="auto"><strong>${inline(heading[2])}</strong></div>`);
      continue;
    }

    const bullet = line.match(/^\s*([-*•]|\u2022)\s+(.+)$/);
    if (bullet) {
      if (listTag !== 'ul') {
        flushList();
        listTag = 'ul';
      }
      listItems.push(inline(bullet[2]));
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (numbered) {
      if (listTag !== 'ol') {
        flushList();
        listTag = 'ol';
      }
      listItems.push(inline(numbered[1]));
      continue;
    }

    flushList();
    blocks.push(`<div dir="auto">${inline(line)}</div>`);
  }
  flushList();

  return blocks
    .map((b) => (b === '__gap__' ? '<div dir="auto"><br></div>' : b))
    .join('');
}
