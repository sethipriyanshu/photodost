"use client";
import { createAuthClient } from "better-auth/react";
import { magicLinkClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  // `usernameClient` adds `signIn.username({ username, password })`, which is how
  // accounts provisioned by the admin sign in. `magicLinkClient` is kept so the
  // email path works the moment SMTP is configured — the server only registers
  // the magic-link plugin when SMTP_HOST is set, and the sign-in page hides the
  // option to match, so this client plugin is inert until then.
  plugins: [usernameClient(), magicLinkClient()],
});

export const { signIn, signOut, useSession } = authClient;
