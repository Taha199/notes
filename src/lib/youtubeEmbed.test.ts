import { describe, expect, it } from 'vitest';
import {
  NOTE_YT_FRAME,
  createYouTubeEmbedElement,
  ensureYouTubeEmbedCaretSiblings,
  ensureYouTubeEmbedCaretSiblingsIn,
  insertYouTubeEmbedAtRange,
  normalizeYouTubeEmbeds,
} from './youtubeEmbed';

describe('youtubeEmbed caret siblings', () => {
  it('insertYouTubeEmbedAtRange adds editable blocks before and after', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(true);

    insertYouTubeEmbedAtRange(range, 'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const frame = root.querySelector(`.${NOTE_YT_FRAME}`);
    expect(frame).toBeTruthy();
    expect(frame?.previousSibling).toBeInstanceOf(HTMLElement);
    expect(frame?.nextSibling).toBeInstanceOf(HTMLElement);
    expect((frame?.previousSibling as HTMLElement).innerHTML).toBe('<br>');
    expect((frame?.nextSibling as HTMLElement).innerHTML).toBe('<br>');
    root.remove();
  });

  it('ensureYouTubeEmbedCaretSiblings fills missing anchors around existing embeds', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    const frame = createYouTubeEmbedElement('dQw4w9WgXcQ');
    root.appendChild(frame);

    expect(ensureYouTubeEmbedCaretSiblings(frame)).toBe(true);
    expect(frame.previousSibling).toBeInstanceOf(HTMLElement);
    expect(frame.nextSibling).toBeInstanceOf(HTMLElement);
    // Idempotent when anchors already exist.
    expect(ensureYouTubeEmbedCaretSiblings(frame)).toBe(false);
  });

  it('normalizeYouTubeEmbeds adds caret siblings only in editable roots', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.appendChild(createYouTubeEmbedElement('dQw4w9WgXcQ'));
    expect(normalizeYouTubeEmbeds(editable)).toBe(true);
    expect(editable.querySelector(`.${NOTE_YT_FRAME}`)?.previousSibling).toBeInstanceOf(HTMLElement);

    const readonly = document.createElement('div');
    readonly.appendChild(createYouTubeEmbedElement('dQw4w9WgXcQ'));
    normalizeYouTubeEmbeds(readonly);
    expect(readonly.querySelector(`.${NOTE_YT_FRAME}`)?.previousSibling).toBeNull();
    expect(readonly.querySelector(`.${NOTE_YT_FRAME}`)?.nextSibling).toBeNull();
  });

  it('ensureYouTubeEmbedCaretSiblingsIn updates every embed', () => {
    const root = document.createElement('div');
    root.appendChild(createYouTubeEmbedElement('aaaaaaaaaaa'));
    root.appendChild(document.createElement('div')).innerHTML = '<br>';
    root.appendChild(createYouTubeEmbedElement('bbbbbbbbbbb'));

    expect(ensureYouTubeEmbedCaretSiblingsIn(root)).toBe(true);
    const frames = root.querySelectorAll(`.${NOTE_YT_FRAME}`);
    expect(frames).toHaveLength(2);
    frames.forEach((frame) => {
      expect(frame.previousSibling).toBeTruthy();
      expect(frame.nextSibling).toBeTruthy();
    });
  });
});
