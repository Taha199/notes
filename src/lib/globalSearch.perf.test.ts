import { describe, expect, it } from 'vitest';
import { countSearchMatchesInText, MAX_SEARCH_HIT_COUNT } from './noteSearch';
import { buildGlobalSearchResults, MIN_GLOBAL_SEARCH_CHARS, MAX_GLOBAL_SEARCH_RESULTS } from './globalSearch';
import type { Note } from '../types';
import type { Translation } from '../i18n/translations';

describe('countSearchMatchesInText', () => {
  it('caps match counting instead of allocating every hit', () => {
    const text = 'a'.repeat(5000);
    expect(countSearchMatchesInText(text, 'a')).toBe(MAX_SEARCH_HIT_COUNT);
  });
});

describe('buildGlobalSearchResults', () => {
  const t = {
    searchCategoryTrash: 'Trash',
    searchCategoryFavorites: 'Fav',
    searchCategoryArchive: 'Arch',
    searchCategoryRead: 'Read',
    searchCategoryUnread: 'Unread',
    searchCategoryLibrary: 'Lib',
    searchCategoryQuiz: 'Quiz',
    searchCategoryQuizFavorites: 'QuizFav',
    searchCategoryQuizSet: 'Set {name}',
  } as Translation;

  it('ignores queries shorter than the minimum', () => {
    const notes: Note[] = [{
      id: 1, title: 'sepsis', html: '<p>sepsis</p>', text: 'sepsis',
      fav: false, read: false, archived: false, date: '2026-01-01',
    }];
    expect(MIN_GLOBAL_SEARCH_CHARS).toBeGreaterThan(1);
    expect(buildGlobalSearchResults(notes, [], [], [], 's', t, new Set())).toEqual([]);
  });

  it('caps the number of results', () => {
    const notes: Note[] = Array.from({ length: 120 }, (_, i) => ({
      id: i + 1,
      title: `sepsis note ${i}`,
      html: `<p>sepsis ${i}</p>`,
      text: `sepsis ${i}`,
      fav: false,
      read: false,
      archived: false,
      date: '2026-01-01',
    }));
    const results = buildGlobalSearchResults(notes, [], [], [], 'sepsis', t, new Set());
    expect(results.length).toBeLessThanOrEqual(MAX_GLOBAL_SEARCH_RESULTS);
  });
});
