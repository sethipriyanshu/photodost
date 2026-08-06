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
  trialDays,
}: {
  googleEnabled: boolean;
  magicLinkEnabled: boolean;
  /** Passed in rather than imported: @photodost/db is server-only, and importing
   *  it here pulls the Postgres driver into the browser bundle. */
  trialDays: number;
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
      // Bad credentials must stay indistinguishable from an unknown user — but
      // only bad credentials. Collapsing *every* failure into "wrong password"
      // hides outages and misconfiguration behind a message that sends people
      // hunting for a typo that isn't there.
      const credentialFailure =
        error.code === "INVALID_USERNAME_OR_PASSWORD" ||
        error.code === "INVALID_EMAIL_OR_PASSWORD" ||
        error.status === 401;

      if (credentialFailure) {
        toast.error("Incorrect username or password.");
      } else {
        console.error("[sign-in] unexpected failure", error);
        toast.error(
          !error.status
            ? "Couldn't reach the server. Check your connection and try again."
            : `Sign-in failed (${error.status}). Please try again or contact us.`,
        );
      }
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
        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            onClick={() => signIn.social({ provider: "google", callbackURL: "/app" })}
          >
            <GoogleMark />
            Continue with Google
          </Button>
          <p className="text-muted-foreground text-center text-xs">
            New studios get a free {trialDays}-day trial — no card needed.
          </p>
        </div>
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

/** Google's "G" mark, inlined as SVG — remote images are blocked by CSP. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
