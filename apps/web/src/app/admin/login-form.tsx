"use client";

import { useActionState } from "react";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loginAction, type ActionState } from "./actions";

const initial: ActionState = { status: "idle" };

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <div className="border-border bg-card rounded-2xl border p-6">
        <div className="flex items-center gap-2">
          <span className="bg-muted grid size-9 place-items-center rounded-xl">
            <Lock className="size-4" />
          </span>
          <div>
            <h1 className="font-semibold">Admin</h1>
            <p className="text-muted-foreground text-xs">PhotoDost account management</p>
          </div>
        </div>

        <form action={action} className="mt-5 flex flex-col gap-3">
          <div>
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoFocus
              required
              className="border-border bg-background mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="border-border bg-background mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          {state.status === "error" ? (
            <p className="text-destructive text-sm" role="alert">
              {state.message}
            </p>
          ) : null}

          <Button type="submit" className="mt-1 w-full rounded-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
