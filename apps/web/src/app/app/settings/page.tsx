import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireWorkspace } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, workspace } = await requireWorkspace();

  return (
    <div className="mx-auto min-h-dvh max-w-3xl px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/app">
              <ArrowLeft className="size-4" />
              Dashboard
            </Link>
          </Button>
        </div>
        <SignOutButton />
      </header>

      <div className="mt-6">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your studio identity and public branding.
        </p>
      </div>

      <div className="mt-6">
        <SettingsForm
          defaultName={workspace.name}
          defaultSlug={workspace.slug}
          defaultAccentColor={workspace.accentColor}
        />
      </div>

      {/* Account */}
      <section className="border-border bg-card mt-6 rounded-2xl border p-6">
        <h2 className="text-sm font-semibold">Account</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Signed in as</dt>
            <dd className="font-medium">{user.email}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
