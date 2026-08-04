import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * URL-safe random ID using A-Z, a-z, 0-9. Defaults to 16 chars (~95 bits of
 * entropy, plenty for a public share token).
 */
export function randomId(length = 16): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function generateEventSlug(name: string): string {
  const base = slugify(name) || "event";
  return `${base}-${randomId(6).toLowerCase()}`;
}

export function generateShareToken(): string {
  return randomId(20);
}
