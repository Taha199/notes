import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, QuizFolder, QuizItem, QuizSet } from '../types';
import type { Translation } from '../i18n/translations';
import {
  buildGlobalSearchHitStarts,
  buildGlobalSearchResults,
  collectQuizItems,
  type GlobalSearchResult,
} from '../lib/globalSearch';

const IDLE_TIMEOUT_MS = 150;

export function useGlobalSearchResults(
  enabled: boolean,
  search: string,
  notes: Note[],
  quizzes: QuizItem[],
  quizSets: QuizSet[],
  quizFolders: QuizFolder[],
  t: Translation,
  favQuizIds: Set<number>,
) {
  const collectedQuizzes = useMemo(
    () => collectQuizItems(quizzes, quizSets),
    [quizzes, quizSets],
  );
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const runRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setResults([]);
      return;
    }

    const runId = ++runRef.current;
    const compute = () => {
      if (runRef.current !== runId) return;
      const next = buildGlobalSearchResults(
        notes,
        quizzes,
        quizSets,
        quizFolders,
        search,
        t,
        favQuizIds,
        collectedQuizzes,
      );
      if (runRef.current === runId) setResults(next);
    };

    if (typeof requestIdleCallback !== 'undefined') {
      const handle = requestIdleCallback(compute, { timeout: IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(handle);
    }

    const timer = window.setTimeout(compute, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, search, notes, quizzes, quizSets, quizFolders, t, favQuizIds, collectedQuizzes]);

  const hitMetaImmediate = useMemo(
    () => (enabled && results.length > 0 ? buildGlobalSearchHitStarts(results, search) : { starts: {}, total: 0 }),
    [enabled, results, search],
  );
  const hitMeta = useDeferredValue(hitMetaImmediate);

  return { results, hitMeta, hitMetaPending: hitMeta !== hitMetaImmediate };
}
