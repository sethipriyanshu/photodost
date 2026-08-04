import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// pgvector helper. Custom type so we can store/query 512-d face embeddings
// without pulling in a pgvector-specific drizzle plugin for the MVP.
// ---------------------------------------------------------------------------
const vector = (name: string, dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value) {
      return (value as string)
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((n) => Number(n));
    },
  })(name);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const assetStatus = pgEnum("asset_status", ["uploaded", "processing", "ready", "failed"]);
export const assetVariantKind = pgEnum("asset_variant_kind", ["thumb", "preview", "full"]);

// Subscription plans. The plan is the source of both quotas; the billing
// webhook mirrors the purchased plan's allotments onto the workspace columns.
// The catalog (labels, INR prices, quotas) lives in apps/web/src/lib/storage.ts
// — note the top tier is `business` in the enum, branded "Studio" in the UI.
//
// `free` is the 7-day trial tier every workspace starts on: 500 MB, one event,
// and no payment. It is also where a lapsed or cancelled subscription lands, so
// nothing is ever left pointing at a paid tier it isn't paying for.
export const plan = pgEnum("plan", ["free", "starter", "pro", "business"]);

// Subscription lifecycle, normalized across providers (Cashfree's statuses are
// mapped onto this set in lib/billing.ts). Defaults to `trialing` so a fresh
// workspace is usable before it ever subscribes.
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

// ---------------------------------------------------------------------------
// Better Auth tables. These match Better Auth's expected model + field names
// (camelCase JS keys → snake_case columns). Better Auth owns all writes here;
// we only read `user` to resolve the signed-in owner. IDs are text because
// Better Auth generates its own string IDs.
// ---------------------------------------------------------------------------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("session_user_idx").on(t.userId),
  }),
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("account_user_idx").on(t.userId),
  }),
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    identifierIdx: index("verification_identifier_idx").on(t.identifier),
  }),
);

// ---------------------------------------------------------------------------
// Tenancy. A workspace is the unit of ownership + billing + storage quota.
// One workspace per user for now (auto-created at onboarding), but modeled as
// a first-class table with a memberships join so teams can be added later
// without a migration. Every owned resource (events) carries a
// `workspace_id`.
// ---------------------------------------------------------------------------
// Free-tier defaults. These are the columns' fallback values, so a workspace
// that has never subscribed starts on the trial allotment rather than on a paid
// tier's. The real per-workspace quota is set from the purchased plan by the
// billing webhook. Until billing is configured, enforcement falls back to Beta
// quotas (see `effectiveQuotas` in apps/web/src/lib/storage.ts).
const FREE_QUOTA_BYTES = 500 * 1024 * 1024; // 500 MB
const FREE_EVENT_QUOTA = 1;
/** Length of the free trial a new workspace gets, in days. */
export const TRIAL_DAYS = 7;

/**
 * How long photos survive after access ends — a cancelled subscription's paid
 * period lapsing, or a free trial expiring. After this the objects are deleted
 * permanently and are not recoverable.
 */
export const RETENTION_GRACE_DAYS = 7;

/** How many days before deletion the second ("final notice") email goes out. */
export const RETENTION_FINAL_WARNING_DAYS = 3;

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The subdomain label, e.g. "ferns-studio" → ferns-studio.photodost.app.
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Accent color for light branding of the public pages.
    accentColor: text("accent_color").default("#5046E5").notNull(),
    plan: plan("plan").default("free").notNull(),
    // Denormalized from `plan` for fast quota checks. Storage is the only cap
    // on paid tiers, so `event_quota` is nullable and NULL means unlimited —
    // only the free tier constrains event count.
    eventQuota: integer("event_quota").default(FREE_EVENT_QUOTA),
    storageQuotaBytes: bigint("storage_quota_bytes", { mode: "number" })
      .default(FREE_QUOTA_BYTES)
      .notNull(),
    storageUsedBytes: bigint("storage_used_bytes", { mode: "number" }).default(0).notNull(),
    // Billing — provider-neutral (Cashfree today). Populated by the
    // subscription webhooks in apps/web/src/app/api/billing/webhook; null for
    // any workspace that has never subscribed.
    billingCustomerId: text("billing_customer_id"),
    billingSubscriptionId: text("billing_subscription_id"),
    // Which catalog entry was purchased, e.g. "pro". Kept alongside `plan`
    // because the catalog key is the provider-facing identity of the purchase.
    billingPlanKey: text("billing_plan_key"),
    // Cashfree requires a customer phone number on every subscription, and we
    // have no other source for one — collected at checkout, reused on renewal.
    billingPhone: text("billing_phone"),
    subscriptionStatus: subscriptionStatus("subscription_status").default("trialing").notNull(),
    // End of the paid period — drives the "renews on" line and the grace
    // window after a failed charge. Set from the webhook payload.
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    // Cashfree's CANCEL is immediate — there is no cancel-at-cycle-end option.
    // So a cancellation records intent here, quotas stay until
    // `current_period_end`, and the worker's daily sweep fires the real CANCEL
    // once the period lapses. See apps/worker/src/billing-sweep.ts.
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    // Retention. Photos are deleted RETENTION_GRACE_DAYS after access ends; the
    // two warning timestamps exist so the daily sweep sends each email exactly
    // once instead of every run. `photosPurgedAt` marks a workspace whose
    // objects are gone — the event rows survive as shells, so the galleries can
    // say "photos were removed" rather than 404.
    // See apps/worker/src/retention.ts.
    retentionWarnedAt: timestamp("retention_warned_at", { withTimezone: true }),
    retentionFinalWarnedAt: timestamp("retention_final_warned_at", { withTimezone: true }),
    photosPurgedAt: timestamp("photos_purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    slugUnique: uniqueIndex("workspaces_slug_unique").on(t.slug),
    ownerIdx: index("workspaces_owner_idx").on(t.ownerUserId),
  }),
);

export const membershipRole = pgEnum("membership_role", ["owner", "admin", "member"]);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: membershipRole("role").default("owner").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceUserUnique: uniqueIndex("memberships_workspace_user_unique").on(
      t.workspaceId,
      t.userId,
    ),
    userIdx: index("memberships_user_idx").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Events. Owned by a workspace. The `slug` is unique *within* a workspace
// (two studios can both have "summer-wedding"); the `share_token` stays
// globally unique and remains the unguessable public capability.
// ---------------------------------------------------------------------------
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    date: timestamp("date", { withTimezone: true }),
    description: text("description"),
    coverAssetId: uuid("cover_asset_id"),
    shareToken: text("share_token").notNull(),
    shareRevokedAt: timestamp("share_revoked_at", { withTimezone: true }),
    matchThreshold: real("match_threshold").default(0.55).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceSlugUnique: uniqueIndex("events_workspace_slug_unique").on(t.workspaceId, t.slug),
    shareTokenUnique: uniqueIndex("events_share_token_unique").on(t.shareToken),
    workspaceIdx: index("events_workspace_idx").on(t.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// Assets (photos)
// ---------------------------------------------------------------------------
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    originalKey: text("original_key").notNull(),
    mime: text("mime").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    width: integer("width"),
    height: integer("height"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    blurDataUrl: text("blur_data_url"),
    status: assetStatus("status").default("uploaded").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    eventCreatedIdx: index("assets_event_created_idx").on(t.eventId, t.createdAt),
    statusIdx: index("assets_status_idx").on(t.status),
  }),
);

export const assetVariants = pgTable(
  "asset_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    variant: assetVariantKind("variant").notNull(),
    key: text("key").notNull(),
    width: integer("width").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
  },
  (t) => ({
    assetVariantUnique: uniqueIndex("asset_variants_unique").on(t.assetId, t.variant),
  }),
);

// ---------------------------------------------------------------------------
// Face embeddings (pgvector). Populated in Phase 4 by the worker + ML service.
// Selfie-search joins on event_id and orders by cosine distance.
// Requires the `vector` extension (created in postgres/init.sql).
// ---------------------------------------------------------------------------
export const faceEmbeddings = pgTable(
  "face_embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    bbox: jsonb("bbox").$type<[number, number, number, number]>(),
    embedding: vector("embedding", 512).notNull(),
    quality: real("quality"),
    detScore: real("det_score"),
    modelVersion: text("model_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    eventIdx: index("face_embeddings_event_idx").on(t.eventId),
    assetIdx: index("face_embeddings_asset_idx").on(t.assetId),
  }),
);

// ---------------------------------------------------------------------------
// Guest search log (rate limiting + abuse detection; no PII).
// ---------------------------------------------------------------------------
export const guestSearches = pgTable(
  "guest_searches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    userAgentHash: text("user_agent_hash"),
    matchCount: integer("match_count").default(0).notNull(),
    tookMs: integer("took_ms"),
    consentGiven: boolean("consent_given").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    eventCreatedIdx: index("guest_searches_event_created_idx").on(t.eventId, t.createdAt),
    ipIdx: index("guest_searches_ip_idx").on(t.ipHash, t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// HNSW index for face embeddings (applied via raw SQL in Phase 4).
// ---------------------------------------------------------------------------
export const faceEmbeddingsHnswIndexSql = sql`
  CREATE INDEX IF NOT EXISTS face_embeddings_hnsw
  ON face_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
`;

// ---------------------------------------------------------------------------
// Storage ledger. Append-only audit trail of every change to a workspace's
// byte usage. `workspaces.storage_used_bytes` is the fast denormalized
// counter; this table is the source of truth we reconcile against, and lets
// us answer "where did the space go?" without guessing. Positive delta =
// added bytes (upload), negative = freed (delete).
// ---------------------------------------------------------------------------
export const storageLedgerReason = pgEnum("storage_ledger_reason", [
  "asset_upload",
  "asset_delete",
  "reconcile",
  // Bulk deletion by the retention sweep after access ended. Distinct from
  // `asset_delete` (a deliberate user action) so the audit trail can tell "the
  // photographer removed this" from "we deleted it because the plan lapsed".
  "retention_purge",
]);

export const storageLedger = pgTable(
  "storage_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    deltaBytes: bigint("delta_bytes", { mode: "number" }).notNull(),
    reason: storageLedgerReason("reason").notNull(),
    objectKey: text("object_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    workspaceCreatedIdx: index("storage_ledger_workspace_created_idx").on(
      t.workspaceId,
      t.createdAt,
    ),
  }),
);
