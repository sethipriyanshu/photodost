"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireWorkspace } from "@/lib/session";
import { checkEventQuota, subscriptionBlock } from "@/lib/storage";
import { generateEventSlug, generateShareToken } from "@/lib/tokens";

const inputSchema = z.object({
  name: z.string().trim().min(2, "Event name must be at least 2 characters.").max(120),
  date: z.string().optional(),
  description: z.string().trim().max(500).optional(),
});

export type CreateEventState = { status: "idle" } | { status: "error"; message: string };

export async function createEvent(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const parsed = inputSchema.safeParse({
    name: formData.get("name"),
    date: (formData.get("date") as string) || undefined,
    description: (formData.get("description") as string) || undefined,
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Please check the form and try again.";
    return { status: "error", message };
  }

  const { workspace } = await requireWorkspace();

  // A lapsed subscription blocks new events before quota is even considered —
  // the fix is payment, not a bigger plan. Existing galleries stay live.
  const lapsed = subscriptionBlock(workspace);
  if (lapsed) {
    return {
      status: "error",
      message:
        lapsed === "past_due"
          ? "A payment on your subscription failed. Update it in Plan & billing to create events again."
          : lapsed === "trial_expired"
            ? "Your free trial has ended. Choose a plan in Plan & billing to create events again."
            : "Your subscription has ended. Renew in Plan & billing to create events again.",
    };
  }

  // Enforce the plan's event cap before creating another event. A null quota
  // means unlimited, which never fails this check — so `ok === false` implies a
  // real number here.
  const { ok, usage } = await checkEventQuota(workspace.id);
  if (!ok) {
    return {
      status: "error",
      message: `You've reached your plan's event limit (${usage.quota ?? 0}). Upgrade in Plan & billing to create more events.`,
    };
  }

  const slug = generateEventSlug(parsed.data.name);
  const shareToken = generateShareToken();

  let dateValue: Date | null = null;
  if (parsed.data.date) {
    const parsedDate = new Date(parsed.data.date);
    if (!Number.isNaN(parsedDate.getTime())) dateValue = parsedDate;
  }

  try {
    await db.insert(schema.events).values({
      workspaceId: workspace.id,
      name: parsed.data.name,
      slug,
      shareToken,
      date: dateValue,
      description: parsed.data.description ?? null,
    });
  } catch (err) {
    console.error("[createEvent] insert failed", err);
    return {
      status: "error",
      message: "Could not create event. Please try again.",
    };
  }

  redirect(`/events/${slug}`);
}
