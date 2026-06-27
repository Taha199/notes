export function CloudSavedIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M6.5 17h10a3 3 0 0 0 .45-5.97A4.5 4.5 0 0 0 12.2 7.2 3.8 3.8 0 0 0 5 10.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.2" cy="16.8" r="4.2" fill="currentColor" />
      <path
        d="M15.4 16.8l1 1 2.2-2.4"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloudSyncIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 12a8 8 0 0 1 13.4-5.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 4v5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-13.4 5.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M20 20v-5h-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Subtle icon-only save/sync badge — text only in tooltip. */
export function SaveStatusBadge({
  status,
  title,
  size = 'sm',
  className = '',
}: {
  status: 'saved' | 'syncing' | 'none';
  title: string;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  if (status === 'none') return null;
  const px = size === 'xs' ? 14 : 16;
  return (
    <span
      className={
        'inline-flex shrink-0 items-center text-app-text-secondary/40 transition-opacity dark:text-gray-500 ' +
        (status === 'syncing' ? 'opacity-70' : 'opacity-100') +
        (className ? ` ${className}` : '')
      }
      title={title}
      aria-label={title}
    >
      {status === 'syncing' ? (
        <CloudSyncIcon size={px} className="animate-spin [animation-duration:1.5s]" />
      ) : (
        <CloudSavedIcon size={px} />
      )}
    </span>
  );
}
