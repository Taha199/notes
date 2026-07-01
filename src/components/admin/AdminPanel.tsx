import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FB_DB_URL, ADMIN_EMAIL } from '../../lib/firebase';
import { getStorageLimitMB, MAX_STORAGE_LIMIT_MB, MIN_STORAGE_LIMIT_MB, plusStorageLimitForToggle, storageLimitPresetsMB } from '../../lib/storageQuota';
import { isPlusUser } from '../../lib/userPlan';

interface UserRow {
  uid: string;
  email: string;
  displayName: string;
  lastSeen: number;
  ip: string;
  provider: string;
  blocked: boolean;
  isPlus: boolean;
  bytes: number;
  storageLimitMB: number;
}

interface AuthUserRow {
  uid: string;
  email: string;
  displayName: string;
  lastLoginAt: number;
  provider: string;
}

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

function timeAgo(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just nu';
  if (min < 60) return `${min} min sedan`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h sedan`;
  const d = Math.floor(h / 24);
  return `${d} d sedan`;
}

function fallbackName(uid: string): string {
  return `Användare ${uid.slice(0, 6)}`;
}

export function AdminPanel() {
  const { user } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [editingLimitUid, setEditingLimitUid] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState('');
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
      setBackupError('Kunde inte hämta plattformsbackups.');
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
      setBackupError('Backup misslyckades. Kontrollera att service account har Storage-behörighet.');
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
      setBackupError('Kunde inte ladda ner backup.');
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [dbRes, authData] = await Promise.all([
        fetch(`${FB_DB_URL}/users.json`),
        user?.getIdToken()
          .then((token) => fetch('/api/admin-users', { headers: { Authorization: `Bearer ${token}` } }))
          .then((res) => (res.ok ? res.json() : { users: [] }))
          .catch(() => ({ users: [] })),
      ]);
      const data = (await dbRes.json()) ?? {};
      const authByUid = new Map<string, AuthUserRow>(
        ((authData?.users ?? []) as AuthUserRow[]).map((authUser) => [authUser.uid, authUser])
      );
      const allUids = new Set([...Object.keys(data), ...authByUid.keys()]);
      const list: UserRow[] = Array.from(allUids).map((uid) => {
        const blob = (data[uid] ?? {}) as Record<string, unknown>;
        const profile = (blob?.profile ?? {}) as Record<string, unknown>;
        const bytes = new TextEncoder().encode(JSON.stringify(blob ?? {})).length;
        const authUser = authByUid.get(uid);
        const email = ((profile.email as string) || authUser?.email || '').trim();
        const displayName = ((profile.displayName as string) || authUser?.displayName || '').trim();
        return {
          uid,
          email,
          displayName: displayName || email.split('@')[0] || fallbackName(uid),
          lastSeen: (profile.lastSeen as number) || authUser?.lastLoginAt || 0,
          ip: (profile.ip as string) ?? '',
          provider: (profile.provider as string) || authUser?.provider || '',
          blocked: profile.blocked === true,
          isPlus: isPlusUser(profile, email),
          bytes,
          storageLimitMB: getStorageLimitMB(profile, email),
        };
      });
      list.sort((a, b) => b.lastSeen - a.lastSeen);
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      load();
      void loadPlatformBackups();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const totalBytes = useMemo(() => rows.reduce((s, r) => s + r.bytes, 0), [rows]);

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center text-app-text-secondary">
        Du har inte behörighet att se den här sidan.
      </div>
    );
  }

  const toggleBlock = async (row: UserRow) => {
    setBusy(row.uid);
    try {
      await fetch(`${FB_DB_URL}/users/${row.uid}/profile/blocked.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(!row.blocked),
      });
      setRows((prev) => prev.map((r) => (r.uid === row.uid ? { ...r, blocked: !r.blocked } : r)));
    } finally {
      setBusy(null);
    }
  };

  const deleteUser = async (row: UserRow) => {
    setBusy(row.uid);
    try {
      await fetch(`${FB_DB_URL}/users/${row.uid}.json`, { method: 'DELETE' });
      setRows((prev) => prev.filter((r) => r.uid !== row.uid));
      setConfirmDelete(null);
    } finally {
      setBusy(null);
    }
  };

  const startEditLimit = (row: UserRow) => {
    setEditingLimitUid(row.uid);
    setLimitInput(String(row.storageLimitMB));
  };

  const cancelEditLimit = () => {
    setEditingLimitUid(null);
    setLimitInput('');
  };

  const saveStorageLimit = async (row: UserRow) => {
    const mb = Math.round(Number(limitInput));
    if (!Number.isFinite(mb) || mb < MIN_STORAGE_LIMIT_MB || mb > MAX_STORAGE_LIMIT_MB) return;
    setBusy(row.uid);
    try {
      await fetch(`${FB_DB_URL}/users/${row.uid}/profile/storageLimitMB.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mb),
      });
      setRows((prev) => prev.map((r) => (r.uid === row.uid ? { ...r, storageLimitMB: mb } : r)));
      cancelEditLimit();
    } finally {
      setBusy(null);
    }
  };

  const togglePlus = async (row: UserRow) => {
    if (row.email === ADMIN_EMAIL) return;
    const next = !row.isPlus;
    setBusy(row.uid);
    try {
      const storageLimitMB = plusStorageLimitForToggle(next);
      await fetch(`${FB_DB_URL}/users/${row.uid}/profile.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPlus: next, storageLimitMB }),
      });
      setRows((prev) =>
        prev.map((r) =>
          r.uid === row.uid ? { ...r, isPlus: next, storageLimitMB } : r,
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const usagePct = (row: UserRow) => Math.min(100, (row.bytes / (row.storageLimitMB * 1024 * 1024)) * 100);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-app-text dark:text-gray-100">👑 Användarpanel</h1>
          <p className="mt-0.5 text-xs text-app-text-secondary dark:text-gray-400">
            {rows.length} användare · {formatBytes(totalBytes)} totalt
          </p>
        </div>
        <button
          onClick={load}
          className="rounded-xl border border-app-border px-4 py-2 text-sm font-medium text-app-text-secondary transition hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
        >
          🔄 Uppdatera
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-500/25 dark:bg-emerald-500/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">Plattformsbackup (alla användare)</h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-emerald-800/80 dark:text-emerald-300/80">
              Hela appens data (alla konton) sparas automatiskt varje timme i Firebase Storage — separat från Realtime Database.
              Om molndatabasen skadas kan du ladda ner en kopia här.
            </p>
            {platformBackups[0] && (
              <p className="mt-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
                Senaste: {platformBackups[0].updated ? new Date(platformBackups[0].updated).toLocaleString('sv-SE') : '—'}
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
              {backupRunning ? 'Sparar…' : 'Kör backup nu'}
            </button>
            {platformBackups[0] && (
              <button
                type="button"
                onClick={() => void downloadPlatformBackup(platformBackups[0].name)}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
              >
                Ladda ner senaste
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadPlatformBackups()}
              disabled={backupLoading}
              className="rounded-xl border border-emerald-300 px-4 py-2 text-xs font-semibold text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200"
            >
              Uppdatera lista
            </button>
          </div>
        </div>
        {backupLoading ? (
          <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">Laddar backups…</p>
        ) : platformBackups.length === 0 ? (
          <p className="mt-3 text-xs text-emerald-800/70 dark:text-emerald-300/70">
            Inga plattformsbackups ännu. Kör en manuellt eller vänta på timvis cron (kräver CRON_SECRET i Vercel).
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {platformBackups.slice(0, 6).map((backup) => (
              <div key={backup.name} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200/80 bg-white/70 px-3 py-2 dark:border-emerald-500/20 dark:bg-black/20">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-app-text dark:text-gray-100">{backup.name.split('/').pop()}</p>
                  <p className="text-[10px] text-app-text-secondary dark:text-gray-400">
                    {backup.updated ? new Date(backup.updated).toLocaleString('sv-SE') : '—'} · {formatBytes(backup.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void downloadPlatformBackup(backup.name)}
                  className="flex-shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
                >
                  Ladda ner
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-app-text-secondary">Laddar…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
          <table className="w-full min-w-[920px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-app-border text-[11px] uppercase tracking-wider text-app-text-secondary/70 dark:border-white/10">
                <th className="px-4 py-3 font-semibold">Användare</th>
                <th className="px-4 py-3 font-semibold">Senast sedd</th>
                <th className="px-4 py-3 font-semibold">IP-adress</th>
                <th className="px-4 py-3 font-semibold">Lagring</th>
                <th className="px-4 py-3 font-semibold">Gräns</th>
                <th className="px-4 py-3 text-right font-semibold">Åtgärder</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.uid} className="border-b border-app-border/50 last:border-0 dark:border-white/5">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#8A82FF] text-sm font-bold text-white">
                        {(row.displayName || row.email || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-semibold text-app-text dark:text-gray-100">
                          {row.displayName}
                          {row.blocked && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold text-red-600 dark:bg-red-500/15 dark:text-red-400">BLOCKERAD</span>}
                          {row.isPlus && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-bold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">PLUS</span>}
                          {row.email === ADMIN_EMAIL && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">ADMIN</span>}
                        </p>
                        <p className="truncate text-xs text-app-text-secondary dark:text-gray-400">{row.email || `ID: ${row.uid}`}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-app-text-secondary dark:text-gray-400">{timeAgo(row.lastSeen)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-app-text-secondary dark:text-gray-400">{row.ip || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="min-w-[110px]">
                      <div className="font-medium text-app-text dark:text-gray-200">{formatBytes(row.bytes)}</div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                        <div
                          className={'h-full rounded-full ' + (usagePct(row) > 90 ? 'bg-red-500' : usagePct(row) > 70 ? 'bg-amber-500' : 'bg-primary')}
                          style={{ width: `${usagePct(row).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingLimitUid === row.uid ? (
                      <div className="flex min-w-[150px] flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={MIN_STORAGE_LIMIT_MB}
                            max={MAX_STORAGE_LIMIT_MB}
                            value={limitInput}
                            onChange={(e) => setLimitInput(e.target.value)}
                            className="w-20 rounded-lg border border-app-border bg-app-bg px-2 py-1 text-[12px] outline-none focus:border-primary dark:border-white/15 dark:bg-white/5"
                          />
                          <span className="text-[12px] text-app-text-secondary">MB</span>
                          <button
                            type="button"
                            onClick={() => void saveStorageLimit(row)}
                            disabled={busy === row.uid}
                            className="rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                          >
                            ✓
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditLimit}
                            className="rounded-md border border-app-border px-2 py-1 text-[11px] text-app-text-secondary dark:border-white/15"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {storageLimitPresetsMB().map((mb) => (
                            <button
                              key={mb}
                              type="button"
                              onClick={() => setLimitInput(String(mb))}
                              className="rounded-md border border-app-border px-1.5 py-0.5 text-[10px] text-app-text-secondary hover:bg-app-bg dark:border-white/15"
                            >
                              {mb}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditLimit(row)}
                        className="rounded-lg border border-app-border px-2.5 py-1.5 text-[12px] font-semibold text-app-text transition hover:bg-app-bg dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
                        title="Ändra lagringsgräns"
                      >
                        {row.storageLimitMB} MB ✏️
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {row.email !== ADMIN_EMAIL && (
                        <>
                          <button
                            onClick={() => togglePlus(row)}
                            disabled={busy === row.uid}
                            className={'rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ' + (row.isPlus
                              ? 'border-violet-300 text-violet-600 hover:bg-violet-50 dark:border-violet-500/30 dark:hover:bg-violet-500/10'
                              : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-white/15 dark:text-gray-300 dark:hover:bg-white/5')}
                          >
                            {row.isPlus ? 'Ta bort Plus' : 'Aktivera Plus'}
                          </button>
                          <button
                            onClick={() => toggleBlock(row)}
                            disabled={busy === row.uid}
                            className={'rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ' + (row.blocked
                              ? 'border-emerald-300 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10'
                              : 'border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-500/30 dark:hover:bg-amber-500/10')}
                          >
                            {row.blocked ? 'Avblockera' : 'Blockera'}
                          </button>
                          <button
                            onClick={() => setConfirmDelete(row)}
                            disabled={busy === row.uid}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-[12px] font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:hover:bg-red-500/10"
                          >
                            Radera
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-900">
            <h2 className="mb-2 text-lg font-bold text-app-text dark:text-gray-100">Radera användare?</h2>
            <p className="mb-1 text-sm text-app-text-secondary dark:text-gray-400">
              Detta raderar permanent all data för <strong className="text-app-text dark:text-gray-200">{confirmDelete.email}</strong>.
            </p>
            <p className="mb-6 text-xs text-app-text-secondary/70 dark:text-gray-500">
              OBS: Själva inloggningskontot tas bort av Firebase först när användaren loggar in igen blockerad. Datan raderas direkt.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => deleteUser(confirmDelete)}
                disabled={busy === confirmDelete.uid}
                className="w-full rounded-xl bg-red-500 py-3 text-sm font-bold text-white transition hover:bg-red-600 disabled:opacity-60"
              >
                {busy === confirmDelete.uid ? 'Raderar…' : 'Ja, radera all data'}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="w-full rounded-xl border border-app-border py-3 text-sm font-semibold text-app-text transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
              >
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
