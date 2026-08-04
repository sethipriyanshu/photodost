"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspaceAction, type OnboardingState } from "./actions";

function previewSlug(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "your-studio"
  );
}

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action, isPending] = useActionState<OnboardingState, FormData>(
    createWorkspaceAction,
    { status: "idle" },
  );
  const [name, setName] = useState(defaultName);
  const [slug, setSlug] = useState("");
  const [accentColor, setAccentColor] = useState("#5046E5");

  const effectiveSlug = previewSlug(slug || name);

  return (
    <form
      action={action}
      className="border-border bg-card flex flex-col gap-5 rounded-2xl border p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Studio name</Label>
        <Input
          id="name"
          name="name"
          type="text"
          placeholder="e.g. Fern & Light Studio"
          autoFocus
          required
          minLength={2}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isPending}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slug">Workspace URL</Label>
        <Input
          id="slug"
          name="slug"
          type="text"
          placeholder={previewSlug(name)}
          maxLength={40}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={isPending}
        />
        <p className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{effectiveSlug}</span>.photodost.app
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accentColor">Accent color</Label>
        <div className="flex items-center gap-2">
          <input
            id="accentColor"
            name="accentColor"
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            disabled={isPending}
            className="border-border size-10 cursor-pointer rounded-md border bg-transparent"
          />
          <span className="text-muted-foreground text-sm">{accentColor}</span>
        </div>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating workspace…
          </>
        ) : (
          <>
            Create workspace
            <ArrowRight className="size-4" />
          </>
        )}
      </Button>
    </form>
  );
}
