import { useEffect, useRef, useState } from 'react';

export function CloudSavedIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M6 17h10.2a3 3 0 0 0 .5-5.96A4.5 4.5 0 0 0 12 7.1 3.9 3.9 0 0 0 4.8 10.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17.5" cy="17" r="4.5" fill="currentColor" />
      <path
        d="M15.5 17l1.1 1.1 2.4-2.6"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CloudSyncIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 12a8 8 0 0 1 13.4-5.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M4 4v5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12a8 8 0 0 1-13.4 5.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M20 20v-5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon-only save badge — clearer colors, spin while syncing, pop when done. */
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
  const prevStatus = useRef(status);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    if (prevStatus.current === 'syncing' && status === 'saved') {
      setPop(true);
      const timer = setTimeout(() => setPop(false), 550);
      prevStatus.current = status;
      return () => clearTimeout(timer);
    }
    prevStatus.current = status;
  }, [status]);

  if (status === 'none') return null;

  const px = size === 'xs' ? 18 : 20;
  const colorClass =
    status === 'syncing'
      ? 'text-primary dark:text-primary'
      : 'text-emerald-600 dark:text-emerald-400';

  return (
    <span
      className={
        `inline-flex shrink-0 items-center transition-transform duration-300 ${colorClass}` +
        (pop ? ' scale-110' : ' scale-100') +
        (className ? ` ${className}` : '')
      }
      title={title}
      aria-label={title}
      aria-live="polite"
    >
      {status === 'syncing' ? (
        <CloudSyncIcon size={px} className="animate-spin [animation-duration:0.9s]" />
      ) : (
        <CloudSavedIcon size={px} />
      )}
    </span>
  );
}
