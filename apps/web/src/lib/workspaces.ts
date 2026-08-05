import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { PROVISIONED_DAYS, TRIAL_DAYS } from "@photodost/db";
import { db, schema } from "./db";
import { PLANS } from "./storage";
import { slugify } from "./tokens";

export type Workspace = typeof schema.workspaces.$inferSelect;

/**
 * The workspace a user owns/belongs to. MVP is 1 user : 1 workspace, resolved
 * through the memberships join so teams can be added later without changing
 * call sites.
 */
export async function getWorkspaceForUser(userId: string): Promise<Workspace | null> {
  const rows = await db
    .select({ workspace: schema.workspaces })
    .from(schema.memberships)
    .innerJoin(schema.workspaces, eq(schema.memberships.workspaceId, schema.workspaces.id))
    .where(eq(schema.memberships.userId, userId))
    .limit(1);
  return rows[0]?.workspace ?? null;
}

export async function getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const rows = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Update a workspace's identity/branding. Validates + normalizes the slug and
 * enforces global uniqueness (excluding itself). Returns a discriminated result
 * so the caller can surface a friendly "slug taken" message.
 */
export async function updateWorkspace(opts: {
  workspaceId: string;
  name?: string;
  slug?: string;
  accentColor?: string;
}): Promise<{ ok: true; workspace: Workspace } | { ok: false; error: string }> {
  const updates: Partial<typeof schema.workspaces.$inferInsert> = { updatedAt: new Date() };

  if (opts.name !== undefined) updates.name = opts.name;
  if (opts.accentColor !== undefined) updates.accentColor = opts.accentColor;

  if (opts.slug !== undefined) {
    const slug = slugify(opts.slug);
    if (!slug) return { ok: false, error: "Choose a workspace URL with letters or numbers." };
    const [taken] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.slug, slug), ne(schema.workspaces.id, opts.workspaceId)))
      .limit(1);
    if (taken) return { ok: false, error: "That workspace URL is already taken." };
    updates.slug = slug;
  }

  const [workspace] = await db
    .update(schema.workspaces)
    .set(updates)
    .where(eq(schema.workspaces.id, opts.workspaceId))
    .returning();

  return { ok: true, workspace: workspace! };
}

/** Whether a workspace slug is free. Used by the onboarding slug picker. */
export async function isWorkspaceSlugAvailable(slug: string): Promise<boolean> {
  const existing = await getWorkspaceBySlug(slug);
  return existing === null;
}

/**
 * Create a workspace + owner membership atomically. Resolves slug collisions
 * by appending a numeric suffix. Returns the created workspace.
 */
export async function createWorkspace(opts: {
  userId: string;
  name: string;
  slug: string;
  accentColor?: string;
}): Promise<Workspace> {
  const base = slugify(opts.slug) || slugify(opts.name) || "studio";

  return db.transaction(async (tx) => {
    // Find a free slug (base, base-2, base-3, …).
    let slug = base;
    for (let attempt = 2; attempt <= 50; attempt++) {
      const taken = await tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.slug, slug))
        .limit(1);
      if (taken.length === 0) break;
      slug = `${base}-${attempt}`;
    }

    // Did the admin sell this person a plan? Payment is taken in person, so the
    // purchase is recorded on the user at provisioning time and collected here,
    // when they finish naming their studio. A self-serve Google signup has none
    // of this and gets the free trial instead.
    const [owner] = await tx
      .select({
        provisionedPlan: schema.user.provisionedPlan,
        provisionedUntil: schema.user.provisionedUntil,
      })
      .from(schema.user)
      .where(eq(schema.user.id, opts.userId))
      .limit(1);

    const provisioned =
      owner?.provisionedPlan && owner.provisionedPlan !== "free"
        ? { plan: owner.provisionedPlan, until: owner.provisionedUntil }
        : null;

    const definition = provisioned ? PLANS[provisioned.plan] : null;

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({
        name: opts.name,
        slug,
        ownerUserId: opts.userId,
        accentColor: opts.accentColor ?? "#5046E5",
        ...(definition && provisioned
          ? {
              plan: provisioned.plan,
              eventQuota: definition.eventQuota,
              storageQuotaBytes: definition.quotaBytes,
              subscriptionStatus: "active" as const,
              // The term the admin sold. Nothing renews it automatically — the
              // customer contacts the admin again and the admin extends it.
              currentPeriodEnd:
                provisioned.until ?? new Date(Date.now() + PROVISIONED_DAYS * 24 * 60 * 60 * 1000),
              // No trial: they paid.
              trialEndsAt: null,
            }
          : {
              // Quotas default to the free tier. The trial clock starts here —
              // the only place it's ever set, so a workspace can't extend its
              // own trial by re-onboarding.
              trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
            }),
      })
      .returning();

    await tx.insert(schema.memberships).values({
      workspaceId: workspace!.id,
      userId: opts.userId,
      role: "owner",
    });

    // Consume the provisioning record so it can't be replayed onto a second
    // workspace if this user somehow onboards again.
    if (provisioned) {
      await tx
        .update(schema.user)
        .set({ provisionedPlan: null, provisionedUntil: null, updatedAt: new Date() })
        .where(eq(schema.user.id, opts.userId));
    }

    return workspace!;
  });
}
