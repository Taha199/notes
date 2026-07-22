import { describe, expect, it } from 'vitest';
import {
  NOTE_YT_FRAME,
  createYouTubeEmbedElement,
  ensureYouTubeEmbedCaretSiblings,
  ensureYouTubeEmbedCaretSiblingsIn,
  insertYouTubeEmbedAtRange,
  normalizeYouTubeEmbeds,
  removeYouTubeEmbed,
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

  it('removeYouTubeEmbed deletes only the frame and keeps caret siblings', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);
    const before = document.createElement('div');
    before.textContent = 'Question text';
    const frame = createYouTubeEmbedElement('dQw4w9WgXcQ');
    const after = document.createElement('div');
    after.innerHTML = '<br>';
    root.append(before, frame, after);

    expect(removeYouTubeEmbed(frame)).toBe(true);
    expect(root.querySelector(`.${NOTE_YT_FRAME}`)).toBeNull();
    expect(root.textContent).toContain('Question text');
    expect(root.contains(before)).toBe(true);
    root.remove();
  });

  it('removeYouTubeEmbed collapses duplicate empty caret sentinels', () => {
    const root = document.createElement('div');
    root.contentEditable = 'true';
    const prev = document.createElement('div');
    prev.innerHTML = '<br>';
    const frame = createYouTubeEmbedElement('dQw4w9WgXcQ');
    const next = document.createElement('div');
    next.innerHTML = '<br>';
    root.append(prev, frame, next);

    expect(removeYouTubeEmbed(frame)).toBe(true);
    expect(root.querySelector(`.${NOTE_YT_FRAME}`)).toBeNull();
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild).toBe(prev);
  });
});
