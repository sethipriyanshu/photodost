import "server-only";
import nodemailer from "nodemailer";
import { env } from "./env";

declare global {
  var __photodostMailer: nodemailer.Transporter | undefined;
}

/**
 * SMTP transport. Locally this points at Mailpit (localhost:1025, no auth) so
 * magic-link emails land in the Mailpit UI at http://localhost:8025. In
 * production, point SMTP_* at a real provider (Resend/SES/Postmark SMTP).
 */
function createTransport(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

const mailer = globalThis.__photodostMailer ?? createTransport();
if (env.NODE_ENV !== "production") {
  globalThis.__photodostMailer = mailer;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  await mailer.sendMail({
    from: env.EMAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

export function magicLinkEmail(url: string): { subject: string; text: string; html: string } {
  const subject = "Your Photo Dost sign-in link";
  const text = `Click to sign in to Photo Dost:\n\n${url}\n\nThis link expires shortly and can only be used once. If you didn't request it, you can ignore this email.`;
  const html = `
    <div style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">Sign in to Photo Dost</h1>
      <p style="color: #555; line-height: 1.5;">Click the button below to sign in. This link expires shortly and can only be used once.</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background: #5046E5; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; display: inline-block; font-weight: 600;">Sign in</a>
      </p>
      <p style="color: #888; font-size: 13px;">If the button doesn't work, paste this URL into your browser:<br><a href="${url}" style="color: #5046E5; word-break: break-all;">${url}</a></p>
      <p style="color: #aaa; font-size: 12px; margin-top: 24px;">If you didn't request this, you can safely ignore it.</p>
    </div>`;
  return { subject, text, html };
}
