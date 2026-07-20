/** Instant download — plain anchor, no async state, no ellipsis. */
export function FileDownloadButton({
  url,
  label,
  className,
}: {
  url: string;
  label: string;
  className: string;
}) {
  if (!url) {
    return (
      <span
        className={`${className} cursor-not-allowed opacity-50`}
        title={label}
      >
        {label}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      // Cross-origin Firebase URLs ignore `download`; attachment disposition opens/saves the file.
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  );
}
