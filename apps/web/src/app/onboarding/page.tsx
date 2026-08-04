import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Camera } from "lucide-react";
import { requireSession } from "@/lib/session";
import { getWorkspaceForUser } from "@/lib/workspaces";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Create your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const user = await requireSession();
  // Already onboarded → app.
  if (await getWorkspaceForUser(user.id)) redirect("/app");

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div className="aurora" aria-hidden />
      <div className="dots absolute inset-0 -z-10" aria-hidden />

      <div className="reveal w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-bold tracking-tight">
          <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-9 place-items-center rounded-xl shadow-lg">
            <Camera className="size-4.5" />
          </span>
          PhotoDost
        </div>

        <h1 className="text-center text-3xl font-bold tracking-tight">
          Create your <span className="text-gradient">workspace</span>
        </h1>
        <p className="text-muted-foreground mt-2 text-center text-sm">
          This is your studio&apos;s home for face-matching event galleries.
        </p>
        <div className="mt-7">
          <OnboardingForm defaultName={user.name ?? ""} />
        </div>
      </div>
    </div>
  );
}
