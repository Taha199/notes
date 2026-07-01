import { runPlatformBackup, verifyCronSecret } from '../lib/platformBackup.js';

export const config = {
  maxDuration: 60,
};

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'method-not-allowed' });
  }

  if (!verifyCronSecret(request)) {
    return response.status(401).json({ error: 'unauthorized' });
  }

  try {
    const result = await runPlatformBackup();
    return response.status(200).json(result);
  } catch (error) {
    console.error('Cron platform backup failed', error);
    return response.status(500).json({ error: 'backup-failed', message: error instanceof Error ? error.message : 'unknown' });
  }
}
