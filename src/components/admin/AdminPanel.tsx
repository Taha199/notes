import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { FB_DB_URL, ADMIN_EMAIL } from '../../lib/firebase';

interface UserRow {
  uid: string;
  email: string;
  displayName: string;
  lastSeen: number;
  ip: string;
  provider: string;
  blocked: boolean;
  bytes: number;
}

interface AuthUserRow {
  uid: string;
  email: string;
  displayName: string;
  lastLoginAt: number;
  provider: string;
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
          bytes,
        };
      });
      list.sort((a, b) => b.lastSeen - a.lastSeen);
      setRows(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
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

      {loading ? (
        <p className="py-10 text-center text-sm text-app-text-secondary">Laddar…</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-app-border bg-white shadow-sm dark:border-white/10 dark:bg-gray-900">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead>
              <tr className="border-b border-app-border text-[11px] uppercase tracking-wider text-app-text-secondary/70 dark:border-white/10">
                <th className="px-4 py-3 font-semibold">Användare</th>
                <th className="px-4 py-3 font-semibold">Senast sedd</th>
                <th className="px-4 py-3 font-semibold">IP-adress</th>
                <th className="px-4 py-3 font-semibold">Lagring</th>
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
                          {row.email === ADMIN_EMAIL && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">ADMIN</span>}
                        </p>
                        <p className="truncate text-xs text-app-text-secondary dark:text-gray-400">{row.email || `ID: ${row.uid}`}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-app-text-secondary dark:text-gray-400">{timeAgo(row.lastSeen)}</td>
                  <td className="px-4 py-3 font-mono text-[12px] text-app-text-secondary dark:text-gray-400">{row.ip || '—'}</td>
                  <td className="px-4 py-3 text-app-text-secondary dark:text-gray-400">{formatBytes(row.bytes)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {row.email !== ADMIN_EMAIL && (
                        <>
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
