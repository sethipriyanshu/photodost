"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setPending(true);
    const { error } = await signIn.magicLink({ email: email.trim(), callbackURL: "/app" });
    setPending(false);
    if (error) {
      toast.error(error.message ?? "Could not send the link. Try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="border-border bg-card rounded-xl border p-5 text-sm">
        <Mail className="text-primary mb-2 size-5" />
        <p className="font-medium">Check your email</p>
        <p className="text-muted-foreground mt-1">
          We sent a sign-in link to <span className="text-foreground">{email}</span>. Locally, open{" "}
          <a
            href="http://localhost:8025"
            className="text-primary underline"
            target="_blank"
            rel="noreferrer"
          >
            Mailpit
          </a>{" "}
          to find it.
        </p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" disabled={pending || !email.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Send magic link
        </Button>
      </form>

      {googleEnabled ? (
        <>
          <div className="text-muted-foreground flex items-center gap-3 text-xs">
            <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
          </div>
          <Button
            variant="outline"
            onClick={() => signIn.social({ provider: "google", callbackURL: "/app" })}
          >
            Continue with Google
          </Button>
        </>
      ) : null}
    </div>
  );
}
