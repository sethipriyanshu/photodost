-- Phase 5 (Razorpay billing): make the billing columns provider-neutral.
--
-- This repo normally syncs schema with `pnpm db:push`, but drizzle-kit cannot
-- tell a rename from a drop+create without prompting, and a drop+create would
-- lose live subscription IDs. Run this BEFORE `db:push` on any database that
-- has real data; afterwards push sees no diff for these columns.
--
--   psql "$DATABASE_URL" -f packages/db/sql/2026-07-27-billing-columns.sql

ALTER TABLE workspaces RENAME COLUMN stripe_customer_id TO billing_customer_id;
ALTER TABLE workspaces RENAME COLUMN stripe_subscription_id TO billing_subscription_id;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS billing_plan_key text;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
