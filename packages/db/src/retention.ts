import { sql, type SQL } from "drizzle-orm";

/**
 * When a workspace's access ended — the anchor every retention deadline is
 * measured from. Null means access has *not* ended, so nothing is ever purged.
 *
 * The clause order matters and is the whole reason this lives in one place:
 *
 * - `canceled` is checked **first**. The billing sweep sets `plan = 'free'` when
 *   it drops a cancelled workspace, so a former paying customer looks like a
 *   free one. If the free/trial branch ran first it would read that customer's
 *   long-expired `trial_ends_at` and purge their photos immediately instead of
 *   after the grace period.
 *
 * - The trial branch requires `trialing` or `incomplete`. `incomplete` is
 *   included because an abandoned checkout leaves a workspace in that state
 *   indefinitely; without it those uploads would never be collected.
 *
 * - A paid term that simply ran out counts as ended even while its status is
 *   still `active`. Accounts are provisioned by hand for a fixed term and
 *   nothing renews them automatically, so an expired term is the normal end of
 *   an account's life — not an anomaly. Checked before the trial branch because
 *   a lapsed paid workspace keeps its `plan` set.
 *
 * - `past_due` returns NULL explicitly. It is recoverable, and destroying
 *   someone's galleries over a payment problem would be unforgivable.
 */
export function accessEndedAtSql(alias = "w"): SQL {
  const w = sql.raw(alias);
  return sql`CASE
    WHEN ${w}.subscription_status = 'past_due' THEN NULL
    WHEN ${w}.subscription_status = 'canceled'
      THEN COALESCE(${w}.current_period_end, ${w}.updated_at)
    WHEN ${w}.plan <> 'free' AND ${w}.current_period_end IS NOT NULL
         AND ${w}.current_period_end <= now()
      THEN ${w}.current_period_end
    WHEN ${w}.plan = 'free' AND ${w}.subscription_status IN ('trialing', 'incomplete')
      THEN ${w}.trial_ends_at
    ELSE NULL
  END`;
}

/** The moment a workspace's photos become eligible for deletion. */
export function purgeDueAtSql(graceDays: number, alias = "w"): SQL {
  return sql`(${accessEndedAtSql(alias)} + ${sql.raw(`interval '${graceDays} days'`)})`;
}
