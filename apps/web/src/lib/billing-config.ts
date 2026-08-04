import "server-only";
import { env } from "./env";

/**
 * Billing configuration and readiness.
 *
 * Deliberately separate from `billing.ts` (the Cashfree client) and free of any
 * import from `storage.ts`: the quota layer needs to ask "is billing actually
 * live?" and the billing client needs the plan catalog, so putting the answer
 * here is what keeps those two from importing each other in a cycle.
 */

export type CashfreeMode = "sandbox" | "production";

/**
 * Cashfree switches environments by base URL, not by key prefix — the same
 * request against the wrong host fails as an auth error, which is a confusing
 * way to find out. So the mode is explicit config.
 */
export function cashfreeMode(): CashfreeMode {
  return env.CASHFREE_MODE === "production" ? "production" : "sandbox";
}

export function cashfreeApiBase(): string {
  return cashfreeMode() === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

/**
 * The API version this client is written against. Cashfree pins request and
 * response shapes to this header, so it is a code-level constant rather than
 * config — bumping it means reviewing the field names in `billing.ts`.
 */
export const CASHFREE_API_VERSION = "2026-01-01";

/**
 * Why billing can't run right now, or null when it's fully wired.
 *
 * Enforcing per-plan quotas without a working checkout would trap a workspace
 * at its current plan with no way to upgrade, so every caller treats a non-null
 * result as "stay in Beta mode and say why" rather than half-enforcing.
 *
 * Note there is no webhook-secret check: Cashfree signs webhooks with the same
 * secret key used for API calls, so verifying the key is present covers both.
 * Plan IDs aren't checked either — they're derived from the catalog
 * (`cashfreePlanId`), not configured, so they can't go missing.
 */
export function billingConfigError(): string | null {
  if (!env.BILLING_ENABLED) return null;

  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    return "BILLING_ENABLED is true but CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not set.";
  }

  if (env.CASHFREE_MODE !== "sandbox" && env.CASHFREE_MODE !== "production") {
    return `CASHFREE_MODE must be "sandbox" or "production" (got "${env.CASHFREE_MODE}").`;
  }

  // A sandbox key against the production host (or vice versa) authenticates as
  // a 401 that reads like a bad secret. Catching the mismatch here turns a
  // confusing runtime failure into a startup-time message.
  const looksTest = env.CASHFREE_SECRET_KEY.includes("_test_");
  if (looksTest && cashfreeMode() === "production") {
    return "CASHFREE_MODE is production but CASHFREE_SECRET_KEY is a test key.";
  }
  if (!looksTest && cashfreeMode() === "sandbox") {
    return "CASHFREE_MODE is sandbox but CASHFREE_SECRET_KEY is not a test key.";
  }

  return null;
}

/**
 * True when real per-plan quotas should be enforced *and* a workspace has a way
 * to pay its way out of them. Anything less keeps the app in Beta mode.
 */
export function billingReady(): boolean {
  return env.BILLING_ENABLED && billingConfigError() === null;
}
