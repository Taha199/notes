import { useAuth } from '../../contexts/AuthContext';
import { useNotes } from '../../contexts/NotesContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { SaveStatusBadge } from './SaveStatusIcon';

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

  const syncing = cloudStatus === 'saving';

  return (
    <SaveStatusBadge
      status={syncing ? 'syncing' : 'saved'}
      title={syncing ? t.cloudSaving : t.cloudSavedMain}
      size={size}
      className={className}
    />
  );
}
