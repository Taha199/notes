import { gzipSync, gunzipSync } from 'node:zlib';
import {
  FB_DB_URL,
  STORAGE_BUCKET,
  getGoogleAccessToken,
  readRtdb,
  readServiceAccount,
} from './firebaseAdmin.js';

export const PLATFORM_BACKUP_PREFIX = 'platform-backups/';
export const MAX_PLATFORM_BACKUPS = 168;

const DB_SCOPE = 'https://www.googleapis.com/auth/firebase.database';
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

function formatBackupName(timestamp) {
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${PLATFORM_BACKUP_PREFIX}tahanote-${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.json.gz`;
}

async function getBackupTokens() {
  const serviceAccount = readServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  const [dbToken, storageToken] = await Promise.all([
    getGoogleAccessToken(serviceAccount, [DB_SCOPE]),
    getGoogleAccessToken(serviceAccount, [STORAGE_SCOPE]),
  ]);
  return { dbToken, storageToken };
}

async function listBackupObjects(storageToken) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o?prefix=${encodeURIComponent(PLATFORM_BACKUP_PREFIX)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${storageToken}` },
  });
  if (!response.ok) return [];
  const data = await response.json();
  const items = (data.items || []).filter((item) => item.name?.endsWith('.json.gz'));
  items.sort((a, b) => String(b.name).localeCompare(String(a.name)));
  return items;
}

async function deleteBackupObject(storageToken, name) {
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(name)}`;
  await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${storageToken}` },
  });
}

async function trimOldBackups(storageToken) {
  const items = await listBackupObjects(storageToken);
  const overflow = items.length - MAX_PLATFORM_BACKUPS;
  if (overflow <= 0) return 0;
  let removed = 0;
  for (let i = items.length - 1; i >= MAX_PLATFORM_BACKUPS; i -= 1) {
    await deleteBackupObject(storageToken, items[i].name);
    removed += 1;
  }
  return removed;
}

export async function runPlatformBackup() {
  const startedAt = Date.now();
  const { dbToken, storageToken } = await getBackupTokens();
  const users = await readRtdb(dbToken, '/users');
  const userCount = users && typeof users === 'object' ? Object.keys(users).length : 0;
  const payload = {
    version: 1,
    exportedAt: new Date(startedAt).toISOString(),
    source: FB_DB_URL,
    userCount,
    users: users || {},
  };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const objectName = formatBackupName(startedAt);
  const uploadUrl = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${storageToken}`,
      'Content-Type': 'application/gzip',
    },
    body: compressed,
  });
  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    throw new Error(`storage-upload-failed:${uploadRes.status}:${detail.slice(0, 200)}`);
  }
  const uploaded = await uploadRes.json();
  const removed = await trimOldBackups(storageToken);
  return {
    ok: true,
    objectName: uploaded.name || objectName,
    exportedAt: payload.exportedAt,
    userCount,
    bytes: compressed.length,
    rawBytes: compressed.length,
    removedOld: removed,
  };
}

export async function listPlatformBackups() {
  const { storageToken } = await getBackupTokens();
  const items = await listBackupObjects(storageToken);
  return items.map((item) => ({
    name: item.name,
    size: Number(item.size || 0),
    updated: item.updated || item.timeCreated || null,
  }));
}

export async function downloadPlatformBackup(objectName) {
  if (!objectName.startsWith(PLATFORM_BACKUP_PREFIX) || !objectName.endsWith('.json.gz')) {
    throw new Error('invalid-backup-name');
  }
  const { storageToken } = await getBackupTokens();
  const url = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(STORAGE_BUCKET)}/o/${encodeURIComponent(objectName)}?alt=media`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${storageToken}` },
  });
  if (!response.ok) throw new Error('backup-not-found');
  const buffer = Buffer.from(await response.arrayBuffer());
  const json = gunzipSync(buffer).toString('utf8');
  return { json, gzip: buffer, objectName };
}

export function verifyCronSecret(request) {
  if (request.headers['x-vercel-cron'] === '1') return true;
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = request.headers.authorization || '';
  const bearer = auth.replace(/^Bearer\s+/i, '');
  return bearer === expected;
}
