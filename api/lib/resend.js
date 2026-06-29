const DEFAULT_FROM = 'Taha Note <noreply@tahanote.com>';

export async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('missing-resend-api-key');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || DEFAULT_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error('email-send-failed');
    error.detail = detail;
    throw error;
  }

  return response.json();
}
