import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db, schema } from "./db";
import { env } from "./env";
import { magicLinkEmail, sendEmail } from "./email";

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

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
  // We use passwordless magic links + optional Google; no password auth.
  emailAndPassword: { enabled: false },
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
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const { subject, text, html } = magicLinkEmail(url);
        await sendEmail({ to: email, subject, text, html });
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
