import { useAuth } from '../../contexts/AuthContext';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';

export function CloudSaveIndicator({
  className = '',
  size = 'sm',
}: {
  className?: string;
  size?: 'sm' | 'xs';
}) {
  const { user } = useAuth();
  const { cloudStatus } = useNotes();
  const { t } = useLanguage();

  if (!user) return null;

  const saving = cloudStatus === 'saving';
  const justSaved = cloudStatus === 'saved';
  const textClass = size === 'xs' ? 'text-[10px]' : 'text-[11px]';
  const colorClass = saving
    ? 'text-amber-500 dark:text-amber-400'
    : justSaved
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-emerald-600/75 dark:text-emerald-400/75';

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${textClass} ${colorClass} ${className}`}
      title={t.cloudSavedMain}
    >
      <span className={saving ? 'animate-pulse' : ''} aria-hidden>
        ☁
      </span>
      <span>{saving ? t.cloudSaving : t.cloudSavedMain}</span>
    </span>
  );
}
