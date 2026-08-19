import { describe, expect, it } from 'vitest';
import type { QuizItem, QuizFolder, QuizSet } from '../types';
import { findQuizItemSource } from './quizItemSource';

describe('findQuizItemSource', () => {
  const folders: QuizFolder[] = [
    { id: 'folder-a', name: 'Akut pediatrik boken', createdAt: '2024-01-01' },
  ];
  const sets: QuizSet[] = [
    {
      id: 'system-favorites-set',
      name: 'Favorit frågor',
      system: 'favorites',
      folderId: 'fav-folder',
      items: [{ id: 99, favOf: 42, question: 'Q', answer: 'A', noteId: 0, noteTitle: '', date: '' }],
      createdAt: '2024-01-01',
    },
    {
      id: 'set-a',
      name: 'Koagulation',
      folderId: 'folder-a',
      items: [{ id: 42, question: 'Q', answer: 'A', noteId: 0, noteTitle: '', date: '' }],
      createdAt: '2024-01-01',
    },
  ];
  const quizzes: QuizItem[] = [];

  it('finds the home set for a favorited question id', () => {
    const source = findQuizItemSource(42, sets, folders, quizzes);
    expect(source).toEqual({
      setId: 'set-a',
      setName: 'Koagulation',
      folderId: 'folder-a',
      folderName: 'Akut pediatrik boken',
      fromNotes: false,
    });
  });

  it('finds notes-origin questions', () => {
    const noteQuizzes: QuizItem[] = [{ id: 7, question: 'Q', answer: 'A', noteTitle: 'Min anteckning', noteId: 1, date: '' }];
    const source = findQuizItemSource(7, sets, folders, noteQuizzes);
    expect(source?.fromNotes).toBe(true);
    expect(source?.setName).toBe('Min anteckning');
  });
});
