import { isSearchHit, splitForHighlight, type SearchHitCounter } from '../../lib/noteSearch';

export function HighlightedText({
  text,
  search,
  className,
  counter,
  activeHitIndex = null,
}: {
  text: string;
  search: string;
  className?: string;
  counter?: SearchHitCounter;
  activeHitIndex?: number | null;
}) {
  if (!search.trim()) return <span className={className}>{text}</span>;
  const parts = splitForHighlight(text, search);
  const localCounter = counter ?? { value: 0 };
  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (!isSearchHit(part, search)) {
          return <span key={`${part}-${index}`}>{part}</span>;
        }
        const hitIndex = localCounter.value++;
        return (
          <mark
            key={`${part}-${index}`}
            data-search-hit={hitIndex}
            className={hitIndex === activeHitIndex ? 'note-search-hit note-search-hit--active' : 'note-search-hit'}
          >
            {part}
          </mark>
        );
      })}
    </span>
  );
}
