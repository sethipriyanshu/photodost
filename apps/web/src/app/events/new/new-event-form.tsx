"use client";

import { useActionState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEvent, type CreateEventState } from "./actions";

export function NewEventForm() {
  const [state, action, isPending] = useActionState<CreateEventState, FormData>(createEvent, {
    status: "idle",
  });

  return (
    <div className="border-border bg-card rounded-2xl border p-6 shadow-sm sm:p-8">
      <div className="bg-primary/10 text-primary grid size-10 place-items-center rounded-xl">
        <Sparkles className="size-5" />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">Create a new event</h1>
      <p className="text-muted-foreground mt-1.5 text-sm">
        Give your event a name. You can add photos and share the QR right after.
      </p>

      <form action={action} className="mt-7 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Event name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="e.g. Riya & Aman's Wedding"
            autoFocus
            required
            minLength={2}
            maxLength={120}
            disabled={isPending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Event date (optional)</Label>
          <Input id="date" name="date" type="date" disabled={isPending} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="description">Description (optional)</Label>
          <Input
            id="description"
            name="description"
            type="text"
            placeholder="A short note guests see on the gallery page"
            maxLength={500}
            disabled={isPending}
          />
        </div>

        {state.status === "error" ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm"
          >
            {state.message}
          </p>
        ) : null}

        <Button type="submit" size="lg" disabled={isPending}>
          {isPending ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating event…
            </>
          ) : (
            <>
              Create event
              <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-xs">
        This event lives in your workspace. Share the guest QR — not this page.
      </p>
    </div>
  );
}
