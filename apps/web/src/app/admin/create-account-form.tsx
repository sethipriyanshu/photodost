"use client";

import { useActionState, useState } from "react";
import { Check, Copy, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createAccountAction, type ActionState } from "./actions";

const initial: ActionState = { status: "idle" };

interface PlanOption {
  value: string;
  label: string;
  priceInr: number;
  storageGb: number;
}

/** Readable and unambiguous when read aloud at a stall: no O/0, l/1, etc. */
function suggestPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}

export function CreateAccountForm({ plans }: { plans: PlanOption[] }) {
  const [state, action, pending] = useActionState(createAccountAction, initial);
  const [password, setPassword] = useState("");
  const [copied, setCopied] = useState(false);

  const created = state.status === "success" ? state.created : undefined;

  async function copyCredentials() {
    if (!created) return;
    const when = new Date(created.expiresOn).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    await navigator.clipboard.writeText(
      `PhotoDost account\nUsername: ${created.username}\nPassword: ${created.password}\nPlan: ${created.plan}\nValid until: ${when}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="border-border bg-card rounded-2xl border p-5">
      <div className="flex items-center gap-2">
        <UserPlus className="size-4" />
        <h2 className="font-semibold">Create a paid account</h2>
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        Take payment first (cash or UPI), then create the account and hand over the credentials.
        Valid for 365 days.
      </p>

      {created ? (
        <div className="border-border bg-muted/40 mt-4 rounded-xl border p-4">
          <p className="text-sm font-medium">Account created — give these to the customer</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono text-sm">
            <dt className="text-muted-foreground">Username</dt>
            <dd className="font-semibold">{created.username}</dd>
            <dt className="text-muted-foreground">Password</dt>
            <dd className="font-semibold">{created.password}</dd>
            <dt className="text-muted-foreground">Plan</dt>
            <dd>{created.plan}</dd>
            <dt className="text-muted-foreground">Until</dt>
            <dd>
              {new Date(created.expiresOn).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </dd>
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">
            The password isn&apos;t recoverable once you leave this page — copy it now. They&apos;ll
            name their studio when they first sign in.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 rounded-full"
            onClick={copyCredentials}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
      ) : null}

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="new-username" className="text-sm font-medium">
            Username
          </label>
          <input
            id="new-username"
            name="username"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="fernsstudio"
            className="border-border bg-background mt-1.5 w-full rounded-lg border px-3 py-2 font-mono text-sm"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            Letters, numbers, dots, underscores. 3–30 characters.
          </p>
        </div>

        <div>
          <label htmlFor="new-password" className="text-sm font-medium">
            Password
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="new-password"
              name="password"
              required
              minLength={8}
              autoComplete="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-border bg-background w-full rounded-lg border px-3 py-2 font-mono text-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-lg"
              onClick={() => setPassword(suggestPassword())}
            >
              Generate
            </Button>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            At least 8 characters. Generated ones avoid look-alike letters.
          </p>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="new-plan" className="text-sm font-medium">
            Plan
          </label>
          <select
            id="new-plan"
            name="plan"
            required
            defaultValue={plans[0]?.value}
            className="border-border bg-background mt-1.5 w-full rounded-lg border px-3 py-2 text-sm"
          >
            {plans.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} — {p.storageGb} GB — ₹{p.priceInr.toLocaleString("en-IN")}/year
              </option>
            ))}
          </select>
        </div>

        {state.status === "error" ? (
          <p className="text-destructive text-sm sm:col-span-2" role="alert">
            {state.message}
          </p>
        ) : null}

        <div className="sm:col-span-2">
          <Button type="submit" className="rounded-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Create account
          </Button>
        </div>
      </form>
    </section>
  );
}
