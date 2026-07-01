import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';

interface PlatformBackupRow {
  name: string;
  size: number;
  updated: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

const copy = {
  en: {
    title: 'Platform backup (all users)',
    sub: 'Full app data for every account is saved hourly to Firebase Storage — separate from Realtime Database. Download a copy here if the cloud database is damaged.',
    run: 'Run backup now',
    running: 'Saving…',
    downloadLatest: 'Download latest',
    refresh: 'Refresh list',
    loading: 'Loading backups…',
    empty: 'No platform backups yet. Run one manually or wait for hourly cron (requires CRON_SECRET in Vercel).',
    latest: 'Latest',
    download: 'Download',
    listError: 'Could not load platform backups.',
    runError: 'Backup failed. Check that the service account has Storage permission.',
    downloadError: 'Could not download backup.',
  },
  sv: {
    title: 'Plattformsbackup (alla användare)',
    sub: 'Hela appens data (alla konton) sparas automatiskt varje timme i Firebase Storage — separat från Realtime Database. Om molndatabasen skadas kan du ladda ner en kopia här.',
    run: 'Kör backup nu',
    running: 'Sparar…',
    downloadLatest: 'Ladda ner senaste',
    refresh: 'Uppdatera lista',
    loading: 'Laddar backups…',
    empty: 'Inga plattformsbackups ännu. Kör en manuellt eller vänta på timvis cron (kräver CRON_SECRET i Vercel).',
    latest: 'Senaste',
    download: 'Ladda ner',
    listError: 'Kunde inte hämta plattformsbackups.',
    runError: 'Backup misslyckades. Kontrollera att service account har Storage-behörighet.',
    downloadError: 'Kunde inte ladda ner backup.',
  },
};

export function PlatformBackupCard({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const t = copy[lang];
  const [platformBackups, setPlatformBackups] = useState<PlatformBackupRow[]>([]);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupError, setBackupError] = useState('');

  const loadPlatformBackups = async () => {
    if (!user) return;
    setBackupLoading(true);
    setBackupError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-platform-backup', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('list-failed');
      const data = (await res.json()) as { backups: PlatformBackupRow[] };
      setPlatformBackups(data.backups ?? []);
    } catch {
      setBackupError(t.listError);
    } finally {
      setBackupLoading(false);
    }
  };

  const runPlatformBackup = async () => {
    if (!user) return;
    setBackupRunning(true);
    setBackupError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-platform-backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('run-failed');
      await loadPlatformBackups();
    } catch {
      setBackupError(t.runError);
    } finally {
      setBackupRunning(false);
    }
  };

  const downloadPlatformBackup = async (name: string) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin-platform-backup?download=${encodeURIComponent(name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('download-failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name.split('/').pop() || 'tahanote-backup.json.gz';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setBackupError(t.downloadError);
    }
  };

  useEffect(() => {
    void loadPlatformBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  return (
    <div className={'rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10 ' + className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">{t.title}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-300/80">{t.sub}</p>
          {platformBackups[0] && (
            <p className="mt-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
              {t.latest}: {platformBackups[0].updated ? new Date(platformBackups[0].updated).toLocaleString(lang === 'sv' ? 'sv-SE' : 'en-GB') : '—'}
              {' · '}{formatBytes(platformBackups[0].size)}
            </p>
          )}
          {backupError && <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{backupError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runPlatformBackup()}
            disabled={backupRunning}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {backupRunning ? t.running : t.run}
          </button>
          {platformBackups[0] && (
            <button
              type="button"
              onClick={() => void downloadPlatformBackup(platformBackups[0].name)}
              className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            >
              {t.downloadLatest}
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadPlatformBackups()}
            disabled={backupLoading}
            className="rounded-xl border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200"
          >
            {t.refresh}
          </button>
        </div>
      </div>
      {backupLoading ? (
        <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">{t.loading}</p>
      ) : platformBackups.length === 0 ? (
        <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">{t.empty}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {platformBackups.slice(0, 6).map((backup) => (
            <div key={backup.name} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/80 bg-white/70 px-3 py-2 dark:border-emerald-500/20 dark:bg-black/20">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-app-text dark:text-gray-100">{backup.name.split('/').pop()}</p>
                <p className="text-[10px] text-app-text-secondary dark:text-gray-400">
                  {backup.updated ? new Date(backup.updated).toLocaleString(lang === 'sv' ? 'sv-SE' : 'en-GB') : '—'} · {formatBytes(backup.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void downloadPlatformBackup(backup.name)}
                className="flex-shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
              >
                {t.download}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
