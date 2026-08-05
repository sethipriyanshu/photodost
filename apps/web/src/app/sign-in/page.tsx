import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera } from "lucide-react";
import { getSession } from "@/lib/session";
import { magicLinkEnabled } from "@/lib/auth";
import { SALES_CONTACT } from "@/lib/contact";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  // Already signed in → straight to the app (which routes to onboarding if needed).
  if (await getSession()) redirect("/app");

  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4">
      <div className="aurora" aria-hidden />
      <div className="dots absolute inset-0 -z-10" aria-hidden />

      <div className="reveal w-full max-w-sm">
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2 text-lg font-bold tracking-tight"
        >
          <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-9 place-items-center rounded-xl shadow-lg">
            <Camera className="size-4.5" />
          </span>
          PhotoDost
        </Link>

        <div className="glass rounded-3xl p-6 shadow-xl sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Sign in with the username and password you were given.
          </p>
          <div className="mt-6">
            <SignInForm googleEnabled={googleEnabled} magicLinkEnabled={magicLinkEnabled} />
          </div>
        </div>

        <p className="text-muted-foreground mt-6 text-center text-xs">
          Don&apos;t have an account?{" "}
          <a href={SALES_CONTACT.whatsappUrl} className="text-primary underline">
            Message us on WhatsApp
          </a>{" "}
          or call{" "}
          <a href={SALES_CONTACT.telUrl} className="text-primary underline">
            {SALES_CONTACT.display}
          </a>
          .
        </p>
      </div>
    </div>
  );
}
