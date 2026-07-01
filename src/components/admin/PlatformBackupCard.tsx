import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { ADMIN_EMAIL } from '../../lib/firebase';

interface PlatformBackupRow {
  name: string;
  size: number;
  updated: string | null;
}

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_BACKUP_KEY = 'malacadhati_admin_platform_backup_at';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

const copy = {
  en: {
    title: 'Full app backup (all users)',
    sub: 'Runs automatically once per day. You do not need to change any settings — open this page anytime to download a copy.',
    run: 'Save copy now',
    running: 'Saving…',
    autoRunning: 'Creating first automatic copy…',
    downloadLatest: 'Download latest',
    refresh: 'Refresh',
    loading: 'Checking backups…',
    empty: 'No copy saved yet — creating one automatically…',
    protected: 'Protected — latest copy saved',
    latest: 'Latest copy',
    download: 'Download',
    listError: 'Could not load backups. Try again in a moment.',
    runError: 'Could not save backup. Try the button again.',
    runOk: 'Backup saved for all users',
    downloadError: 'Download failed. Try again.',
    downloadOk: 'Download started',
  },
  sv: {
    title: 'Säkerhetskopia — hela appen (alla användare)',
    sub: 'Sker automatiskt en gång per dygn. Du behöver inte göra något tekniskt — öppna den här sidan när du vill ladda ner en kopia.',
    run: 'Spara kopia nu',
    running: 'Sparar…',
    autoRunning: 'Skapar första automatiska kopian…',
    downloadLatest: 'Ladda ner senaste',
    refresh: 'Uppdatera',
    loading: 'Kontrollerar kopior…',
    empty: 'Ingen kopia ännu — skapar en automatiskt…',
    protected: 'Skyddat — senaste kopia sparad',
    latest: 'Senaste kopia',
    download: 'Ladda ner',
    listError: 'Kunde inte hämta kopior. Försök igen om en stund.',
    runError: 'Kunde inte spara backup. Tryck på knappen igen.',
    runOk: 'Backup sparad för alla användare',
    downloadError: 'Nedladdning misslyckades. Försök igen.',
    downloadOk: 'Nedladdning startad',
  },
};

export function PlatformBackupCard({ className = '' }: { className?: string }) {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const { show } = useToast();
  const t = copy[lang];
  const [platformBackups, setPlatformBackups] = useState<PlatformBackupRow[]>([]);
  const [backupLoading, setBackupLoading] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [backupError, setBackupError] = useState('');
  const autoStarted = useRef(false);

  const loadPlatformBackups = async (): Promise<PlatformBackupRow[]> => {
    if (!user) return [];
    setBackupLoading(true);
    setBackupError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-platform-backup', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('list-failed');
      const data = (await res.json()) as { backups: PlatformBackupRow[] };
      const items = data.backups ?? [];
      setPlatformBackups(items);
      return items;
    } catch {
      setBackupError(t.listError);
      return [];
    } finally {
      setBackupLoading(false);
    }
  };

  const runPlatformBackup = async (silent = false): Promise<boolean> => {
    if (!user) return false;
    setBackupRunning(true);
    setBackupError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin-platform-backup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('run-failed');
      localStorage.setItem(AUTO_BACKUP_KEY, String(Date.now()));
      await loadPlatformBackups();
      if (!silent) show(t.runOk);
      return true;
    } catch {
      setBackupError(t.runError);
      return false;
    } finally {
      setBackupRunning(false);
      setAutoRunning(false);
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
      show(t.downloadOk);
    } catch {
      setBackupError(t.downloadError);
    }
  };

  useEffect(() => {
    if (!user || user.email !== ADMIN_EMAIL || autoStarted.current) return;
    autoStarted.current = true;

    void (async () => {
      const items = await loadPlatformBackups();
      const lastAuto = Number(localStorage.getItem(AUTO_BACKUP_KEY)) || 0;
      const stale = Date.now() - lastAuto > AUTO_BACKUP_INTERVAL_MS;
      const needsBackup = items.length === 0 || stale;
      if (!needsBackup) return;

      setAutoRunning(true);
      await runPlatformBackup(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  const busy = backupRunning || autoRunning;
  const isProtected = platformBackups.length > 0 && !backupError;

  return (
    <div className={'rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10 ' + className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">{t.title}</h2>
            {isProtected && !busy && (
              <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                ✓ {t.protected}
              </span>
            )}
          </div>
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
            disabled={busy}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? (autoRunning ? t.autoRunning : t.running) : t.run}
          </button>
          {platformBackups[0] && (
            <button
              type="button"
              onClick={() => void downloadPlatformBackup(platformBackups[0].name)}
              disabled={busy}
              className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
            >
              {t.downloadLatest}
            </button>
          )}
        </div>
      </div>
      {backupLoading ? (
        <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">{t.loading}</p>
      ) : platformBackups.length === 0 ? (
        <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">{busy ? t.autoRunning : t.empty}</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {platformBackups.slice(0, 4).map((backup) => (
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
