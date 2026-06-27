import { useEffect, useState } from 'react';
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
  const [showSaving, setShowSaving] = useState(false);

  useEffect(() => {
    if (cloudStatus !== 'saving') {
      setShowSaving(false);
      return;
    }
    const timer = setTimeout(() => setShowSaving(true), 700);
    return () => clearTimeout(timer);
  }, [cloudStatus]);

  if (!user) return null;

  return (
    <SaveStatusBadge
      status={showSaving ? 'syncing' : 'saved'}
      title={showSaving ? t.cloudSaving : t.cloudSavedMain}
      size={size}
      className={className}
    />
  );
}
