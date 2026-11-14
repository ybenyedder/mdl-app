import nodemailer from 'nodemailer';
import webpush from 'web-push';

let vapidConfigured = false;

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY || '';
}

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || 'mailto:mdl@lycee.fr';
  if (pub && priv) {
    webpush.setVapidDetails(subj, pub, priv);
    vapidConfigured = true;
    return true;
  }
  return false;
}

export async function sendWebPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; url?: string }
): Promise<{ ok: boolean; error?: string }> {
  if (!ensureVapid()) {
    return { ok: false, error: 'VAPID non configuré' };
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      },
      JSON.stringify(payload)
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur WebPush' };
  }
}

export async function sendOptionalEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<{ sent: boolean; previewOnly?: boolean }> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { sent: false, previewOnly: true };
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: { user, pass }
  });
  await transporter.sendMail({
    from: process.env.SMTP_FROM || user,
    to: input.to,
    subject: input.subject,
    text: input.text
  });
  return { sent: true };
}
