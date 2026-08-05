"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Mail } from "lucide-react";
import { toast } from "sonner";
import { signIn } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Two ways in:
 *
 *  - Username + password, for accounts the admin provisions after taking payment
 *    in person. This is the primary path and needs no email infrastructure.
 *  - Google, for self-serve signup, which lands on the 7-day free trial.
 *
 * The magic-link form only appears when the server has SMTP configured
 * (`magicLinkEnabled`), so there's never a button that silently does nothing.
 */
export function SignInForm({
  googleEnabled,
  magicLinkEnabled,
}: {
  googleEnabled: boolean;
  magicLinkEnabled: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const [email, setEmail] = useState("");
  const [emailPending, setEmailPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setPending(true);
    const { error } = await signIn.username({
      username: username.trim().toLowerCase(),
      password,
    });
    setPending(false);
    if (error) {
      // Never distinguish "no such user" from "wrong password".
      toast.error("Incorrect username or password.");
      return;
    }
    // Lands on /app, which redirects to /onboarding on first sign-in so they can
    // name their studio.
    router.push("/app");
    router.refresh();
  }

  async function onMagicLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setEmailPending(true);
    const { error } = await signIn.magicLink({ email: email.trim(), callbackURL: "/app" });
    setEmailPending(false);
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
          We sent a sign-in link to <span className="text-foreground">{email}</span>.
        </p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setSent(false)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onPasswordSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="yourstudio"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
        </div>
        <Button type="submit" disabled={pending || !username.trim() || !password}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          Sign in
        </Button>
      </form>

      {googleEnabled || magicLinkEnabled ? (
        <div className="text-muted-foreground flex items-center gap-3 text-xs">
          <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
        </div>
      ) : null}

      {googleEnabled ? (
        <Button
          variant="outline"
          onClick={() => signIn.social({ provider: "google", callbackURL: "/app" })}
        >
          Continue with Google
        </Button>
      ) : null}

      {magicLinkEnabled ? (
        <form onSubmit={onMagicLinkSubmit} className="flex flex-col gap-2">
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@studio.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={emailPending}
          />
          <Button type="submit" variant="ghost" disabled={emailPending || !email.trim()}>
            {emailPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" />
            )}
            Email me a link instead
          </Button>
        </form>
      ) : null}
    </div>
  );
}
