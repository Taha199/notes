import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Note, QuizFolder, QuizItem, QuizSet } from '../types';
import type { Translation } from '../i18n/translations';
import {
  buildGlobalSearchHitStarts,
  buildGlobalSearchResults,
  collectQuizItems,
  type GlobalSearchResult,
} from '../lib/globalSearch';

const IDLE_TIMEOUT_MS = 800;

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
  const deferredSearch = useDeferredValue(search);
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
        deferredSearch,
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

    const timer = window.setTimeout(compute, 32);
    return () => window.clearTimeout(timer);
  }, [enabled, deferredSearch, notes, quizzes, quizSets, quizFolders, t, favQuizIds, collectedQuizzes]);

  const hitMetaImmediate = useMemo(
    () => (enabled && results.length > 0 ? buildGlobalSearchHitStarts(results, deferredSearch) : { starts: {}, total: 0 }),
    [enabled, results, deferredSearch],
  );
  const hitMeta = useDeferredValue(hitMetaImmediate);

  return { results, hitMeta, hitMetaPending: hitMeta !== hitMetaImmediate };
}
