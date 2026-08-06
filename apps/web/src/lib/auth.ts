import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, magicLink, username } from "better-auth/plugins";
import { db, schema } from "./db";
import { env } from "./env";
import { magicLinkEmail, sendEmail } from "./email";

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * Magic links are only offered when a real mail server is configured. Showing
 * the option without a working mailer produces a form that silently does
 * nothing, which is worse than not offering it at all.
 *
 * Note this uses SMTP_CONFIGURED, not SMTP_HOST: the latter defaults to
 * "localhost" and so is always truthy.
 */
export const magicLinkEnabled = env.SMTP_CONFIGURED;

/**
 * Username rules, matching the plugin's own defaults. Exported so the sign-in
 * form and the admin action validate against exactly the same thing —
 * `/admin/create-user` bypasses the plugin's validation hooks, so the admin
 * action has to apply these itself.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/;

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    provider: "pg",
    // Map Better Auth's models onto our Drizzle tables (singular names).
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  /**
   * Password auth is on for sign-in, but public registration is closed.
   *
   * Paid accounts are provisioned by the admin after payment is taken in person,
   * so nobody should be able to self-register a password account and bypass
   * that. Self-serve signup is Google only, and that path gets the free trial.
   *
   * `disableSignUp` is checked at the top of the sign-up handler with no
   * server-side bypass, so the admin action cannot use `signUpEmail`. It uses
   * the admin plugin's `createUser` instead, which does have one.
   */
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : undefined,
  session: {
    // 30-day idle expiry, refreshed daily; cookie-cached for snappy SSR.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    username({
      minUsernameLength: USERNAME_MIN,
      maxUsernameLength: USERNAME_MAX,
    }),
    /**
     * Enabled only to make `auth.api.createUser` available to the admin action.
     *
     * The `/admin/*` endpoints it mounts are effectively unreachable: an
     * anonymous request carries headers and is rejected as UNAUTHORIZED, and a
     * signed-in customer fails the permission check. Nothing is ever assigned
     * `role: "admin"`, so there is no account to compromise that would unlock
     * them — the admin area authenticates separately against ADMIN_* env
     * credentials.
     */
    admin(),
    ...(magicLinkEnabled
      ? [
          magicLink({
            sendMagicLink: async ({ email, url }) => {
              const { subject, text, html } = magicLinkEmail(url);
              await sendEmail({ to: email, subject, text, html });
            },
          }),
        ]
      : []),
  ],
});

export type Session = typeof auth.$Infer.Session;
