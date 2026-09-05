import { describe, expect, it } from 'vitest';
import { buildSearchSnippetHtml, extractSearchMediaHtml } from './noteSearch';

describe('search media snippets', () => {
  it('extracts note image frames and bare imgs', () => {
    const html =
      '<p>Hello</p><div class="note-img-frame"><img src="https://example.com/a.png" alt=""></div><p>More</p><img src="https://example.com/b.png">';
    const media = extractSearchMediaHtml(html);
    expect(media).toContain('note-img-frame');
    expect(media).toContain('https://example.com/a.png');
    expect(media).toContain('https://example.com/b.png');
    // Bare img inside a frame must not be duplicated.
    expect(media.match(/<img\b/gi)?.length).toBe(2);
  });

  it('keeps full HTML when images are present', () => {
    const html =
      '<p><strong>Minst sju</strong></p><div class="note-img-frame"><img src="https://example.com/x.png"></div>';
    expect(buildSearchSnippetHtml(html, 10)).toBe(html);
  });

  it('truncates plain text when there is no media', () => {
    const html = `<p>${'word '.repeat(100)}</p>`;
    const snippet = buildSearchSnippetHtml(html, 40);
    expect(snippet.startsWith('<p>')).toBe(true);
    expect(snippet).toContain('…');
    expect(snippet).not.toContain('<img');
  });
});
