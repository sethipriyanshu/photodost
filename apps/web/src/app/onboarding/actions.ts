"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { createWorkspace, getWorkspaceForUser } from "@/lib/workspaces";
import { slugify } from "@/lib/tokens";

const inputSchema = z.object({
  name: z.string().trim().min(2, "Studio name must be at least 2 characters.").max(80),
  slug: z.string().trim().min(2, "Workspace URL must be at least 2 characters.").max(40).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid color.")
    .optional(),
});

export type OnboardingState = { status: "idle" } | { status: "error"; message: string };

export async function createWorkspaceAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireSession();

  // Idempotent: if they already have a workspace, just go to the app.
  const existing = await getWorkspaceForUser(user.id);
  if (existing) redirect("/app");

  const parsed = inputSchema.safeParse({
    name: formData.get("name"),
    slug: (formData.get("slug") as string) || undefined,
    accentColor: (formData.get("accentColor") as string) || undefined,
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Please check the form.",
    };
  }

  const slugSource = parsed.data.slug || parsed.data.name;
  if (!slugify(slugSource)) {
    return { status: "error", message: "Please choose a workspace URL with letters or numbers." };
  }

  try {
    await createWorkspace({
      userId: user.id,
      name: parsed.data.name,
      slug: slugSource,
      accentColor: parsed.data.accentColor,
    });
  } catch (err) {
    console.error("[onboarding] createWorkspace failed", err);
    return { status: "error", message: "Could not create your workspace. Please try again." };
  }

  redirect("/app");
}
