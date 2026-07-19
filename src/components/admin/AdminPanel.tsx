import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { useAuth } from '../../contexts/AuthContext';
import { ADMIN_EMAIL, database } from '../../lib/firebase';
import { getRtdbAuthToken, waitForAuthUser } from '../../lib/rtdb';
import { MAX_STORAGE_LIMIT_MB, MIN_STORAGE_LIMIT_MB, plusStorageLimitForToggle, storageLimitPresetsMB } from '../../lib/storageQuota';

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

interface PresenceEntry {
  lastSeen?: number;
  ip?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function timeAgo(ts: number, now = Date.now()): string {
  if (!ts) return '—';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  // Client heartbeat writes lastSeen about every 15s while online.
  if (sec < 90) return 'online';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min sedan`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h sedan`;
  const d = Math.floor(h / 24);
  return `${d} d sedan`;
}

function mergePresenceIntoRows(
  list: UserRow[],
  presence: Record<string, PresenceEntry> | null,
): UserRow[] {
  if (!presence) return list;
  return list.map((row) => {
    const live = presence[row.uid];
    if (!live) return row;
    const liveSeen = Number(live.lastSeen) || 0;
    const lastSeen = liveSeen > (row.lastSeen || 0) ? liveSeen : row.lastSeen;
    const ip = (typeof live.ip === 'string' && live.ip) || row.ip;
    if (lastSeen === row.lastSeen && ip === row.ip) return row;
    return { ...row, lastSeen, ip };
  });
}

function fallbackName(uid: string): string {
  return `Användare ${uid.slice(0, 6)}`;
}

export function AdminPanel() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.email === ADMIN_EMAIL;
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [editingLimitUid, setEditingLimitUid] = useState<string | null>(null);
  const [limitInput, setLimitInput] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const presenceRef = useRef<Record<string, PresenceEntry> | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const authUser = user ?? (await waitForAuthUser());
      if (!authUser) return;

      // Everything (names + storage) is computed server-side in one compact request,
      // instead of downloading the whole database to the browser.
      const token = await getRtdbAuthToken();
      if (!token) return;
      const res = await fetch('/api/admin-user-stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { users?: Array<Partial<UserRow>> };
      const list: UserRow[] = (data.users ?? []).map((u) => ({
        uid: u.uid ?? '',
        email: (u.email ?? '').trim(),
        displayName: (u.displayName ?? '').trim() || (u.email ?? '').split('@')[0] || fallbackName(u.uid ?? ''),
        lastSeen: u.lastSeen ?? 0,
        ip: u.ip ?? '',
        provider: u.provider ?? '',
        blocked: u.blocked === true,
        isPlus: u.isPlus === true,
        bytes: u.bytes ?? 0,
        storageLimitMB: u.storageLimitMB ?? 0,
      }));
      // Prefer fresher live presence over API/auth lastLoginAt when merging storage stats.
      setRows(mergePresenceIntoRows(list, presenceRef.current));
      setNow(Date.now());
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !isAdmin || !user) return;
    void load();
  }, [authLoading, isAdmin, user, load]);

  // Live presence from RTDB — updates Senast sedd without waiting for stats poll.
  useEffect(() => {
    if (authLoading || !isAdmin || !user) return;
    const unsub = onValue(dbRef(database, 'presence'), (snap) => {
      const val = (snap.val() ?? null) as Record<string, PresenceEntry> | null;
      presenceRef.current = val;
      setRows((prev) => mergePresenceIntoRows(prev, val));
      setNow(Date.now());
    });
    return () => unsub();
  }, [authLoading, isAdmin, user]);

  // Poll LAGRING (~10s) + tick relative "online" labels (~5s) while visible.
  useEffect(() => {
    if (authLoading || !isAdmin || !user) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void load({ silent: true });
    }, 10_000);
    const tick = window.setInterval(() => setNow(Date.now()), 5_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authLoading, isAdmin, user, load]);

  const totalBytes = useMemo(() => rows.reduce((s, r) => s + r.bytes, 0), [rows]);

  const adminAction = useCallback(async (payload: Record<string, unknown>) => {
    const token = await getRtdbAuthToken();
    if (!token) throw new Error('no-auth');
    const res = await fetch('/api/admin-user-action', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(err?.error || 'action-failed');
    }
    return (await res.json()) as Record<string, unknown>;
  }, []);

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
      const next = !row.blocked;
      await adminAction({ action: 'setBlocked', uid: row.uid, blocked: next });
      setRows((prev) => prev.map((r) => (r.uid === row.uid ? { ...r, blocked: next } : r)));
    } catch (e) {
      console.error('toggleBlock failed', e);
    } finally {
      setBusy(null);
    }
  };

  const deleteUser = async (row: UserRow) => {
    setBusy(row.uid);
    try {
      await adminAction({ action: 'deleteUser', uid: row.uid, email: row.email });
      setRows((prev) => prev.filter((r) => r.uid !== row.uid));
      setConfirmDelete(null);
    } catch (e) {
      console.error('deleteUser failed', e);
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
      await adminAction({ action: 'setStorageLimit', uid: row.uid, storageLimitMB: mb });
      setRows((prev) => prev.map((r) => (r.uid === row.uid ? { ...r, storageLimitMB: mb } : r)));
      cancelEditLimit();
    } catch (e) {
      console.error('saveStorageLimit failed', e);
    } finally {
      setBusy(null);
    }
  };

  const togglePlus = async (row: UserRow) => {
    if (row.email === ADMIN_EMAIL) return;
    const next = !row.isPlus;
    setBusy(row.uid);
    try {
      const data = await adminAction({ action: 'setPlus', uid: row.uid, isPlus: next });
      const storageLimitMB =
        typeof data.storageLimitMB === 'number' ? data.storageLimitMB : plusStorageLimitForToggle(next);
      setRows((prev) =>
        prev.map((r) =>
          r.uid === row.uid ? { ...r, isPlus: next, storageLimitMB } : r,
        ),
      );
    } catch (e) {
      console.error('togglePlus failed', e);
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
          onClick={() => void load()}
          className="rounded-xl border border-app-border px-4 py-2 text-sm font-medium text-app-text-secondary transition hover:bg-app-bg dark:border-white/10 dark:text-gray-400"
        >
          🔄 Uppdatera
        </button>
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
                  <td className={'px-4 py-3 ' + (now - row.lastSeen < 90_000 && row.lastSeen ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'text-app-text-secondary dark:text-gray-400')}>
                    {timeAgo(row.lastSeen, now)}
                  </td>
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
                            type="button"
                            onClick={() => void togglePlus(row)}
                            disabled={busy === row.uid}
                            className={'rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ' + (row.isPlus
                              ? 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25'
                              : 'border-violet-300 text-violet-600 hover:bg-violet-50 dark:border-violet-500/30 dark:text-violet-300 dark:hover:bg-violet-500/10')}
                          >
                            {busy === row.uid ? 'Sparar…' : row.isPlus ? 'Ta bort Plus' : 'Aktivera Plus'}
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
