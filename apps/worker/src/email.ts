import nodemailer from "nodemailer";
import { env } from "./env.js";

/**
 * SMTP transport for worker-sent mail (retention warnings). Separate from the
 * web app's `lib/email.ts` because that module is `server-only` and lives inside
 * the Next app; the templates here don't overlap with it.
 */
const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
});

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

interface Email {
  subject: string;
  text: string;
  html: string;
}

function layout(heading: string, bodyHtml: string, cta: { href: string; label: string }): string {
  return `
    <div style="font-family: ui-sans-serif, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${heading}</h1>
      ${bodyHtml}
      <p style="margin: 24px 0;">
        <a href="${cta.href}" style="background: #5046E5; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; display: inline-block; font-weight: 600;">${cta.label}</a>
      </p>
      <p style="color: #aaa; font-size: 12px; margin-top: 24px;">Photo Dost</p>
    </div>`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(date);
}

/**
 * First warning, sent when the grace period starts. The point of this email is
 * that it arrives while the photos still exist and can be downloaded.
 */
export function retentionStartEmail(opts: {
  workspaceName: string;
  deleteOn: Date;
  graceDays: number;
  wasTrial: boolean;
}): Email {
  const when = formatDate(opts.deleteOn);
  const billingUrl = `${env.APP_URL}/app/billing`;
  const reason = opts.wasTrial ? "Your free trial has ended" : "Your subscription has ended";

  const subject = `${reason} — your photos are kept until ${when}`;

  const text = [
    `${reason}.`,
    ``,
    `Your photos for "${opts.workspaceName}" are still online and your guests can still find themselves in them. We keep everything for ${opts.graceDays} days.`,
    ``,
    `On ${when} the photos will be permanently deleted. This cannot be undone.`,
    ``,
    `To keep them, choose a plan: ${billingUrl}`,
    ``,
    `If you'd rather not continue, please download anything you want to keep before that date.`,
  ].join("\n");

  const html = layout(
    reason,
    `<p style="color: #555; line-height: 1.5;">Your photos for <strong>${opts.workspaceName}</strong> are still online and your guests can still find themselves in them. We keep everything for ${opts.graceDays} days.</p>
     <p style="color: #555; line-height: 1.5;">On <strong>${when}</strong> the photos will be permanently deleted. This cannot be undone.</p>
     <p style="color: #555; line-height: 1.5;">If you'd rather not continue, please download anything you want to keep before then.</p>`,
    { href: billingUrl, label: "Choose a plan" },
  );

  return { subject, text, html };
}

/** Final notice, a few days out. Deliberately blunter than the first. */
export function retentionFinalEmail(opts: {
  workspaceName: string;
  deleteOn: Date;
  daysLeft: number;
}): Email {
  const when = formatDate(opts.deleteOn);
  const billingUrl = `${env.APP_URL}/app/billing`;
  const dayWord = opts.daysLeft === 1 ? "day" : "days";

  const subject = `Final notice: your photos are deleted in ${opts.daysLeft} ${dayWord}`;

  const text = [
    `Your photos for "${opts.workspaceName}" will be permanently deleted on ${when}.`,
    ``,
    `That's ${opts.daysLeft} ${dayWord} from now. After that they cannot be recovered, and your guest galleries will stop showing photos.`,
    ``,
    `Keep them by choosing a plan: ${billingUrl}`,
    ``,
    `Otherwise, download anything you still need now.`,
  ].join("\n");

  const html = layout(
    `Your photos are deleted in ${opts.daysLeft} ${dayWord}`,
    `<p style="color: #555; line-height: 1.5;">Your photos for <strong>${opts.workspaceName}</strong> will be permanently deleted on <strong>${when}</strong>.</p>
     <p style="color: #555; line-height: 1.5;">After that they cannot be recovered, and your guest galleries will stop showing photos.</p>
     <p style="color: #555; line-height: 1.5;">If you still need anything, please download it now.</p>`,
    { href: billingUrl, label: "Keep my photos" },
  );

  return { subject, text, html };
}
