import { useEffect, useState } from 'react';
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

  const textClass = size === 'xs' ? 'text-[10px]' : 'text-[11px]';
  const colorClass = showSaving
    ? 'text-amber-500 dark:text-amber-400'
    : 'text-emerald-600 dark:text-emerald-400';

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium ${textClass} ${colorClass} ${className}`}
      title={t.cloudSavedMain}
    >
      <span className={showSaving ? 'animate-pulse' : ''} aria-hidden>
        ☁
      </span>
      <span>{showSaving ? t.cloudSaving : t.cloudSavedMain}</span>
    </span>
  );
}
