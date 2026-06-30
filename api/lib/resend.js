const DEFAULT_FROM = 'Taha Note <noreply@tahanote.com>';

export async function sendEmail({ to, subject, html, text, replyTo, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const error = new Error('missing-resend-api-key');
    error.code = 'missing-resend-api-key';
    throw error;
  }

  const payload = {
    from: process.env.RESEND_FROM || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (text) payload.text = text;
  if (replyTo) payload.reply_to = replyTo;
  if (attachments?.length) payload.attachments = attachments;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error('email-send-failed');
    error.code = 'email-send-failed';
    error.detail = detail;
    error.status = response.status;
    throw error;
  }

  return response.json();
}
