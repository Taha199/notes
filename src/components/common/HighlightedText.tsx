import { isSearchHit, splitForHighlight } from '../../lib/noteSearch';

export function HighlightedText({ text, search, className }: { text: string; search: string; className?: string }) {
  if (!search.trim()) return <span className={className}>{text}</span>;
  const parts = splitForHighlight(text, search);
  return (
    <span className={className}>
      {parts.map((part, index) => (
        isSearchHit(part, search)
          ? <mark key={`${part}-${index}`} className="note-search-hit">{part}</mark>
          : <span key={`${part}-${index}`}>{part}</span>
      ))}
    </span>
  );
}
