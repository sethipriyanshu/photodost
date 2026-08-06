"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { PROVISIONED_DAYS } from "@photodost/db";
import { adminLogin, adminLogout, clientIp, isAdmin } from "@/lib/admin-auth";
import { hashPassword } from "better-auth/crypto";
import { auth, USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { PAID_PLANS, PLANS } from "@/lib/storage";

export interface ActionState {
  status: "idle" | "error" | "success";
  message?: string;
  /** Echoed back so the admin can read the credentials out to the customer. */
  created?: { username: string; password: string; plan: string; expiresOn: string };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Provisioned accounts need an email because Better Auth requires one and the
 * column is NOT NULL UNIQUE. Nothing is ever sent to it — these customers sign
 * in with a username. `.invalid` is reserved by RFC 2606 precisely so it can
 * never resolve, which makes an accidental send fail loudly instead of leaking.
 */
function syntheticEmail(username: string): string {
  return `${username}@provisioned.photodost.invalid`;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = clientIp(await headers());

  const result = await adminLogin({ username, password, ip });

  switch (result) {
    case "ok":
      revalidatePath("/admin");
      return { status: "success" };
    case "locked":
      return {
        status: "error",
        message: "Too many attempts. Try again in 15 minutes.",
      };
    case "unconfigured":
      return {
        status: "error",
        message: "Admin access isn't configured on this deployment.",
      };
    default:
      // Deliberately not saying which of the two was wrong.
      return { status: "error", message: "Incorrect username or password." };
  }
}

export async function logoutAction(): Promise<void> {
  await adminLogout();
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Account provisioning
// ---------------------------------------------------------------------------

const createSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(USERNAME_MIN, `At least ${USERNAME_MIN} characters.`)
    .max(USERNAME_MAX, `At most ${USERNAME_MAX} characters.`)
    .regex(USERNAME_PATTERN, "Letters, numbers, dots and underscores only."),
  password: z.string().min(8, "At least 8 characters."),
  plan: z.enum(["starter", "pro", "business"]),
});

/**
 * Create a paid account after payment has been taken in person.
 *
 * The plan is parked on the user as `provisioned_plan` rather than applied to a
 * workspace, because the workspace doesn't exist yet — the customer names their
 * own studio at `/onboarding` on first sign-in, and `createWorkspace` collects
 * the plan there. The term starts now, since that's when they paid.
 */
export async function createAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  if (!(await isAdmin())) return { status: "error", message: "Not signed in." };

  const parsed = createSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    plan: formData.get("plan"),
  });

  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { username, password, plan } = parsed.data;
  const expiresAt = new Date(Date.now() + PROVISIONED_DAYS * DAY_MS);

  try {
    /**
     * `auth.api.createUser` rather than `signUpEmail`: public registration is
     * disabled (`disableSignUp`), and that flag is checked with no server-side
     * bypass. `createUser` skips its permission check when called without
     * request headers, which is exactly this path — we've already authenticated
     * the admin via our own cookie.
     *
     * It also bypasses the username plugin's validation hooks, so the schema
     * above applies the same rules the plugin would, and the unique index on
     * `user.username` is what actually prevents collisions.
     */
    const created = await auth.api.createUser({
      body: {
        email: syntheticEmail(username),
        password,
        name: username,
        data: {
          username,
          displayUsername: username,
          provisionedPlan: plan,
          provisionedUntil: expiresAt,
        },
      },
    });

    const userId = (created as { user?: { id?: string } })?.user?.id;
    if (!userId) {
      return { status: "error", message: "Account was not created. Please try again." };
    }

    // `data` should carry these through, but the admin plugin's handling of extra
    // fields varies by adapter — so write them explicitly rather than trusting it.
    // Without them the customer would onboard onto the free trial after paying.
    await db
      .update(schema.user)
      .set({ provisionedPlan: plan, provisionedUntil: expiresAt, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));

    revalidatePath("/admin");
    return {
      status: "success",
      created: {
        username,
        password,
        plan: PLANS[plan].label,
        expiresOn: expiresAt.toISOString(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The unique index is the real collision check.
    if (/unique|duplicate|already exists|already taken/i.test(message)) {
      return { status: "error", message: `The username "${username}" is already taken.` };
    }
    console.error("[admin/createAccount] failed", err);
    return { status: "error", message: "Could not create the account. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// Renew / cancel
// ---------------------------------------------------------------------------

export async function extendAccountAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;

  const workspaceId = String(formData.get("workspaceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!workspaceId && !userId) return;

  const until = new Date(Date.now() + PROVISIONED_DAYS * DAY_MS);

  if (workspaceId) {
    // Extend from now rather than from the old end date: renewals are taken in
    // person, so the customer is paying for a year starting today, and someone
    // renewing three months late shouldn't get a term that's already part-spent.
    await db
      .update(schema.workspaces)
      .set({
        currentPeriodEnd: until,
        subscriptionStatus: "active",
        cancelAtPeriodEnd: false,
        // Clear any retention state — the account is live again, so the
        // deletion clock and the warnings that went with it no longer apply.
        retentionWarnedAt: null,
        retentionFinalWarnedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaces.id, workspaceId));
  } else {
    // Not onboarded yet — extend the parked provisioning record instead.
    await db
      .update(schema.user)
      .set({ provisionedUntil: until, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));
  }

  revalidatePath("/admin");
}

export async function cancelAccountAction(formData: FormData): Promise<void> {
  if (!(await isAdmin())) return;

  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!workspaceId) return;

  /**
   * Cancelling blocks new events and uploads but leaves galleries readable, so
   * the photographer's own clients aren't punished for a lapsed account.
   *
   * It does start the retention clock: photos become eligible for deletion after
   * the grace period. That deletion is still gated on a warning email actually
   * having been sent, so with no mailer configured nothing is destroyed yet.
   */
  await db
    .update(schema.workspaces)
    .set({
      subscriptionStatus: "canceled",
      cancelAtPeriodEnd: false,
      updatedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));

  revalidatePath("/admin");
}

/**
 * Issue a new password for an account and return it once.
 *
 * There is no email, so there is no self-service reset: a customer who forgets
 * their password has no way back in except this. Without it a forgotten password
 * means abandoning the account and the events in it.
 *
 * The password is hashed and written directly rather than going through the
 * admin plugin's `setUserPassword`, which reads `ctx.context.session.user.id`
 * unconditionally and therefore throws when called server-side without a
 * session — unlike `createUser`, it has no bypass. `hashPassword` from
 * better-auth/crypto is the same primitive the library uses internally, so the
 * stored hash is byte-for-byte what a normal sign-up would produce.
 */
export async function resetPasswordAction(
  userId: string,
): Promise<{ ok: true; password: string } | { ok: false; message: string }> {
  if (!(await isAdmin())) return { ok: false, message: "Not signed in." };
  if (!userId) return { ok: false, message: "No account selected." };

  // Same alphabet as the create form: no look-alike characters, because this
  // gets read aloud down a phone line.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");

  try {
    const hash = await hashPassword(password);

    // The credential lives on the account row for the email/password provider.
    const updated = await db
      .update(schema.account)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "credential")))
      .returning({ id: schema.account.id });

    if (updated.length === 0) {
      // A Google-only account has no credential row to reset.
      return {
        ok: false,
        message: "This account signs in with Google, so it has no password.",
      };
    }

    // Existing sessions keep working after a reset — the customer isn't kicked
    // out mid-upload just because a new password was issued.
    revalidatePath("/admin");
    return { ok: true, password };
  } catch (err) {
    console.error("[admin/resetPassword] failed", err);
    return { ok: false, message: "Could not reset the password. Please try again." };
  }
}

/** Plan options for the create form, priced from the catalog. */
export async function planOptions(): Promise<
  { value: string; label: string; priceInr: number; storageGb: number }[]
> {
  return PAID_PLANS.map((plan) => ({
    value: plan,
    label: PLANS[plan].label,
    priceInr: PLANS[plan].priceInr,
    storageGb: Math.round(PLANS[plan].quotaBytes / (1024 * 1024 * 1024)),
  }));
}
