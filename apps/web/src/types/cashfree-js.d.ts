/**
 * Types for `@cashfreepayments/cashfree-js`, which ships none of its own — the
 * published package is a thin loader that pulls the real SDK from
 * https://sdk.cashfree.com/js/v3/cashfree.js at runtime.
 *
 * This declares only the subscription surface we use. It was read off the v3
 * bundle rather than the docs, which don't cover `subscriptionsCheckout` — note
 * the option is **`subsSessionId`**, not `subscriptionSessionId`, and passing
 * the wrong one fails at runtime with "subsSessionId is missing in options".
 */
declare module "@cashfreepayments/cashfree-js" {
  export type CashfreeMode = "sandbox" | "production";

  /** Where checkout renders. `_modal` keeps the user on the page. */
  export type RedirectTarget = "_self" | "_blank" | "_top" | "_modal";

  export interface CashfreeCheckoutError {
    type?: string;
    code?: string;
    message?: string;
  }

  export interface SubscriptionsCheckoutOptions {
    /** From the create-subscription response's `subscription_session_id`. */
    subsSessionId: string;
    /** Defaults to the mode given to `load()`; must match it if supplied. */
    mode?: CashfreeMode;
    redirectTarget?: RedirectTarget;
  }

  export interface SubscriptionsCheckoutResult {
    error?: CashfreeCheckoutError;
    /** Present when the mandate was authorized. */
    subscription?: Record<string, unknown>;
  }

  export interface Cashfree {
    subscriptionsCheckout(
      options: SubscriptionsCheckoutOptions,
    ): Promise<SubscriptionsCheckoutResult | undefined>;
  }

  /** Resolves to null in a server environment. */
  export function load(options: { mode: CashfreeMode }): Promise<Cashfree | null>;
}
