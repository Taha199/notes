import { isAllowedOrigin, verifyAdmin } from '../lib/firebaseAdmin.js';
import {
  downloadPlatformBackup,
  listPlatformBackups,
  runPlatformBackup,
} from '../lib/platformBackup.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  if (!isAllowedOrigin(request.headers.origin)) {
    return response.status(403).json({ error: 'forbidden' });
  }

  const idToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  const adminUser = idToken ? await verifyAdmin(idToken) : null;
  if (!adminUser) {
    return response.status(403).json({ error: 'forbidden' });
  }

  try {
    if (request.method === 'GET') {
      const downloadName = String(request.query.download || '');
      if (downloadName) {
        const { gzip, objectName } = await downloadPlatformBackup(downloadName);
        response.setHeader('Content-Type', 'application/gzip');
        response.setHeader('Content-Disposition', `attachment; filename="${objectName.split('/').pop()}"`);
        return response.status(200).send(gzip);
      }
      const backups = await listPlatformBackups();
      return response.status(200).json({ backups });
    }

    if (request.method === 'POST') {
      const result = await runPlatformBackup();
      return response.status(200).json(result);
    }

    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'method-not-allowed' });
  } catch (error) {
    console.error('Admin platform backup failed', error);
    return response.status(500).json({ error: 'request-failed', message: error instanceof Error ? error.message : 'unknown' });
  }
}
