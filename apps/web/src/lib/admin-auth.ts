import "server-only";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * Authentication for the admin area (`/admin`).
 *
 * Deliberately separate from Better Auth. The admin is not a customer account:
 * there is no user row for it, so there is nothing in the database to
 * compromise, and the `/admin/*` endpoints the Better Auth admin plugin mounts
 * stay unreachable because no user is ever given `role: "admin"`.
 *
 * The credential lives in the environment as a scrypt hash, never plaintext.
 * Generate one with:
 *
 *   node -e 'const{randomBytes,scryptSync}=require("node:crypto");
 *     const s=randomBytes(16),h=scryptSync(process.argv[1],s,64,{N:16384,r:8,p:1});
 *     console.log(`scrypt$16384$8$1$${s.toString("hex")}$${h.toString("hex")}`)' "your-password"
 */

const COOKIE_NAME = "photodost_admin";
/** Admin sessions are short by design — this grants the ability to mint accounts. */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Password verification
// ---------------------------------------------------------------------------

/** `scrypt$N$r$p$saltHex$hashHex` */
function verifyScrypt(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashHex!, "hex");
  if (expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex!, "hex"), expected.length, {
      N,
      r,
      p,
      // scrypt with N=16384,r=8 needs more than Node's default 32MB limit.
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Rate limiting
//
// In-process and therefore per-instance and reset by deploys. That is a real
// limitation, but for a single admin credential it still turns an online
// brute-force into an impractical one, and it needs no extra infrastructure.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; first: number }>();

function rateLimitKey(ip: string): string {
  return ip || "unknown";
}

export function isLockedOut(ip: string): boolean {
  const entry = attempts.get(rateLimitKey(ip));
  if (!entry) return false;
  if (Date.now() - entry.first > LOCKOUT_MS) {
    attempts.delete(rateLimitKey(ip));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string): void {
  const key = rateLimitKey(ip);
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.first > LOCKOUT_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  entry.count += 1;
}

function clearFailures(ip: string): void {
  attempts.delete(rateLimitKey(ip));
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

/**
 * `<expiresAt>.<nonce>.<hmac>` — signed with BETTER_AUTH_SECRET.
 *
 * Stateless on purpose: there is one admin, so a session table would buy
 * nothing. The nonce exists so two logins don't produce an identical token.
 */
function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(payload).digest("base64url");
}

function mintToken(): string {
  const payload = `${Date.now() + SESSION_TTL_MS}.${randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

function tokenIsValid(token: string | undefined): boolean {
  if (!token) return false;
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return false;

  const payload = token.slice(0, idx);
  const presented = token.slice(idx + 1);
  const expected = sign(payload);

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const expiresAt = Number(payload.split(".")[0]);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function adminConfigured(): boolean {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD_HASH);
}

export type LoginResult = "ok" | "invalid" | "locked" | "unconfigured";

export async function adminLogin(opts: {
  username: string;
  password: string;
  ip: string;
}): Promise<LoginResult> {
  if (!adminConfigured()) return "unconfigured";
  if (isLockedOut(opts.ip)) return "locked";

  const userMatches =
    opts.username.trim().toLowerCase() === env.ADMIN_USERNAME.trim().toLowerCase();
  const passwordMatches = verifyScrypt(opts.password, env.ADMIN_PASSWORD_HASH);

  // Both are computed before branching so a wrong username and a wrong password
  // take the same path; scrypt dominates the timing either way.
  if (!userMatches || !passwordMatches) {
    recordFailure(opts.ip);
    return "invalid";
  }

  clearFailures(opts.ip);
  const jar = await cookies();
  jar.set(COOKIE_NAME, mintToken(), {
    httpOnly: true,
    // Lax rather than Strict: Strict drops the cookie on a top-level navigation
    // from an external context, which makes bookmarks and pasted links appear
    // logged out. Every mutation is a POST from same-origin, so Lax is enough.
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return "ok";
}

export async function adminLogout(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  return tokenIsValid(jar.get(COOKIE_NAME)?.value);
}

/** Client IP for rate limiting, from the platform's forwarding headers. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "";
}
