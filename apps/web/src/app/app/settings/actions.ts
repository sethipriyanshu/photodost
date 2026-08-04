"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireWorkspace } from "@/lib/session";
import { updateWorkspace } from "@/lib/workspaces";

const inputSchema = z.object({
  name: z.string().trim().min(2, "Studio name must be at least 2 characters.").max(80),
  slug: z.string().trim().min(2, "Workspace URL must be at least 2 characters.").max(40).optional(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid color.")
    .optional(),
});

export type SettingsState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function updateWorkspaceAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const { workspace } = await requireWorkspace();

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

  const res = await updateWorkspace({
    workspaceId: workspace.id,
    name: parsed.data.name,
    slug: parsed.data.slug,
    accentColor: parsed.data.accentColor,
  });
  if (!res.ok) return { status: "error", message: res.error };

  revalidatePath("/app/settings");
  revalidatePath("/app");
  return { status: "success" };
}
