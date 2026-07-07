import { useAuth } from '../../contexts/AuthContext';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { SaveStatusBadge } from './SaveStatusIcon';

function formatCloudTime(ts: number, locale: string) {
  return new Date(ts).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function CloudSavedAtLabel({
  className = '',
  size = 'sm',
  showWhenEmpty = false,
}: {
  className?: string;
  size?: 'sm' | 'xs';
  showWhenEmpty?: boolean;
}) {
  const { user } = useAuth();
  const { cloudStatus, cloudSyncedAt } = useNotes();
  const { t, lang } = useLanguage();

  if (!user) return null;

  const syncing = cloudStatus === 'saving';
  const failed = cloudStatus === 'error';
  const locale = lang === 'sv' ? 'sv-SE' : 'en-GB';

  if (!cloudSyncedAt && !syncing && !failed && !showWhenEmpty) return null;

  const text = syncing
    ? t.cloudSaving
    : failed
      ? t.cloudSaveError
      : cloudSyncedAt
        ? t.cloudSavedAt.replace('{time}', formatCloudTime(cloudSyncedAt, locale))
        : t.cloudNotSyncedYet;

  const badgeStatus = syncing ? 'syncing' : failed ? 'error' : cloudSyncedAt ? 'saved' : 'none';

  return (
    <span
      className={
        `inline-flex min-w-0 items-center gap-1.5 text-[11px] leading-tight ` +
        (failed
          ? 'text-amber-700 dark:text-amber-300'
          : syncing
            ? 'text-primary'
            : 'text-emerald-700 dark:text-emerald-300') +
        (className ? ` ${className}` : '')
      }
      title={text}
    >
      {badgeStatus !== 'none' && <SaveStatusBadge status={badgeStatus} title={text} size={size} />}
      <span className="truncate">{text}</span>
    </span>
  );
}
