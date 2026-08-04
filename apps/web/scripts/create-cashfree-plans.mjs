#!/usr/bin/env node
/**
 * Create the Cashfree subscription plans for every paid tier in the catalog.
 *
 *   pnpm billing:create-plans           # create against whatever keys are set
 *   pnpm billing:create-plans --dry-run # print what would be created
 *
 * Unlike Razorpay, plan IDs are **merchant-supplied** and derived from the
 * catalog (`photodost_<tier>_annual`), so there is nothing to paste back into
 * .env afterwards — the app computes the same IDs via `cashfreePlanId()`.
 *
 * Re-running is safe: a plan that already exists is reported as such and left
 * alone. To change a price, edit PLANS in src/lib/storage.ts and give the tier a
 * new plan ID — a live plan's amount cannot be edited in place, and existing
 * subscribers stay on what they bought.
 *
 * The catalog is duplicated here rather than imported because src/lib/storage.ts
 * is TypeScript with `server-only` and Next path aliases, none of which a plain
 * node script can load. Keep the two in sync.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "../.env");

// --- minimal .env loader (no dependency) ----------------------------------
function loadEnv(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnv(envPath);
const APP_ID = process.env.CASHFREE_APP_ID || fileEnv.CASHFREE_APP_ID;
const SECRET = process.env.CASHFREE_SECRET_KEY || fileEnv.CASHFREE_SECRET_KEY;
const MODE = process.env.CASHFREE_MODE || fileEnv.CASHFREE_MODE || "sandbox";

const API_BASE =
  MODE === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
const API_VERSION = "2026-01-01";

const dryRun = process.argv.includes("--dry-run");

// --- catalog: mirror of the paid tiers in src/lib/storage.ts ----------------
// Billing is annual only. Ten cycles is effectively "until cancelled" —
// Cashfree requires a finite max.
const MAX_CYCLES = 10;

const PLANS = [
  { key: "starter", label: "Starter", priceInr: 999, storageGb: 25 },
  { key: "pro", label: "Pro", priceInr: 1399, storageGb: 50 },
  { key: "business", label: "Studio", priceInr: 1999, storageGb: 100 },
];

/** Must match `cashfreePlanId()` in src/lib/storage.ts. */
function planId(key) {
  return `photodost_${key}_annual`;
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!dryRun && (!APP_ID || !SECRET)) {
  fail(
    "CASHFREE_APP_ID / CASHFREE_SECRET_KEY are not set.\n" +
      `  Looked in process.env and ${envPath}.\n` +
      "  Run with --dry-run to preview without credentials.",
  );
}

if (MODE !== "sandbox" && MODE !== "production") {
  fail(`CASHFREE_MODE must be "sandbox" or "production" (got "${MODE}").`);
}

async function cashfree(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-client-id": APP_ID,
      "x-client-secret": SECRET,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  return { ok: res.ok, status: res.status, payload };
}

async function main() {
  console.log(`\nCashfree plans — ${MODE} (${API_BASE})`);
  console.log(`${PLANS.length} paid tiers, billed yearly\n`);

  for (const plan of PLANS) {
    const id = planId(plan.key);
    const body = {
      plan_id: id,
      // Cashfree restricts this to alphanumerics and a short list of specials —
      // parentheses and commas are rejected, so keep names and notes plain.
      plan_name: `PhotoDost ${plan.label} Annual`,
      plan_type: "PERIODIC",
      plan_currency: "INR",
      plan_recurring_amount: plan.priceInr,
      // The mandate ceiling. Set to the recurring amount: we never charge more
      // than the catalog price, and a tight cap limits the damage if anything
      // ever tried to.
      plan_max_amount: plan.priceInr,
      plan_max_cycles: MAX_CYCLES,
      plan_intervals: 1,
      plan_interval_type: "YEAR",
      plan_note: `${plan.storageGb} GB storage - unlimited events`,
    };

    const summary = `${id}  ₹${plan.priceInr}/yr  ${plan.storageGb} GB`;

    if (dryRun) {
      console.log(`  would create  ${summary}`);
      continue;
    }

    const { ok, status, payload } = await cashfree("/plans", body);

    if (ok) {
      console.log(`  created       ${summary}`);
      continue;
    }

    // Already there — the whole point of deterministic IDs is that this is a
    // safe, expected outcome on a re-run. Cashfree answers a duplicate with
    // HTTP 400 "Plan already exist." (sic), not a 409.
    const message = String(payload.message ?? "");
    if (status === 409 || /already exist|duplicate/i.test(message)) {
      console.log(`  exists        ${summary}`);
      continue;
    }

    fail(`Could not create ${id} (HTTP ${status}): ${message || "unknown error"}`);
  }

  if (dryRun) {
    console.log("\nDry run — nothing was created.\n");
    return;
  }

  console.log("\n✓ Done. No env vars to add — plan IDs derive from the catalog.");
  console.log("  Next: create the webhook, then set BILLING_ENABLED=true.\n");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
