import { env } from "./env";

/**
 * Sales contact, derived once from `SALES_PHONE`.
 *
 * There is no payment gateway in V1 — plans are bought by contacting the admin
 * directly, so this is the checkout button. It's a module rather than a constant
 * so the number lives in one place and every link form (tel:, wa.me, display)
 * stays consistent with it.
 *
 * `SALES_PHONE` is digits only including the country code, e.g. 917814270662.
 */
function buildContact(raw: string) {
  const digits = raw.replace(/\D/g, "");
  // Split an Indian number into +91 XXXXX XXXXX for display.
  const national = digits.startsWith("91") ? digits.slice(2) : digits;
  const display =
    national.length === 10 ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : `+${digits}`;

  const pitch = "Hi! I'd like to know more about PhotoDost plans.";

  return {
    /** Digits with country code, no punctuation. */
    digits,
    /** Human-readable, e.g. "+91 78142 70662". */
    display,
    telUrl: `tel:+${digits}`,
    /** wa.me needs the bare international number and a URL-encoded message. */
    whatsappUrl: `https://wa.me/${digits}?text=${encodeURIComponent(pitch)}`,
  };
}

export const SALES_CONTACT = buildContact(env.SALES_PHONE);
