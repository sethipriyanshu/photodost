import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  MessageCircle,
  Phone,
  QrCode,
  ScanFace,
  Sparkles,
  Upload,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { listEvents } from "@/lib/events";
import { getSessionWorkspace } from "@/lib/session";
import { SALES_CONTACT } from "@/lib/contact";
import { PAID_PLANS, PLANS, planFeatures } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Marketing landing for logged-out visitors; signed-in owners see their own
  // recent events (scoped to their workspace).
  const ctx = await getSessionWorkspace();
  const events = ctx ? await listEvents(ctx.workspace.id).catch(() => []) : [];
  const signedIn = Boolean(ctx);
  const hasEvents = events.length > 0;

  return (
    <div className="relative min-h-dvh">
      <header className="safe-top glass sticky top-0 z-40">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <span className="bg-primary text-primary-foreground shadow-primary/30 grid size-8 place-items-center rounded-xl shadow-lg">
              <Camera className="size-4" />
            </span>
            PhotoDost
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              asChild
              variant={signedIn ? "default" : "ghost"}
              size="sm"
              className="rounded-full px-4"
            >
              <Link href={signedIn ? "/app" : "/sign-in"}>
                {signedIn ? "Dashboard" : "Sign in"}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
        {/* Hero */}
        <section className="relative isolate overflow-visible pt-12 sm:pt-20">
          <div className="aurora" aria-hidden />
          <div className="dots absolute inset-0 -z-10" aria-hidden />

          <div className="reveal-group grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="flex flex-col items-start gap-6">
              <span className="glass text-muted-foreground inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium">
                <Sparkles className="text-primary size-3.5" />
                Face-recognition photo delivery for event photographers
              </span>

              <h1 className="text-balance text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
                Every guest finds
                <br />
                <span className="text-gradient">their photos.</span>
              </h1>

              <p className="text-muted-foreground max-w-xl text-pretty text-base leading-relaxed sm:text-lg">
                Upload the event, share one QR. Guests take a single selfie and instantly see only
                the photos they&apos;re in — no apps, no accounts, no endless scrolling.
              </p>

              <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
                <Button
                  asChild
                  size="lg"
                  className="shadow-primary/30 h-13 rounded-full px-8 shadow-lg"
                >
                  <Link href={signedIn ? "/events/new" : "/sign-in"}>
                    {signedIn ? "Create an event" : "Start free"}
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                {hasEvents ? (
                  <Button asChild variant="outline" size="lg" className="h-13 rounded-full px-8">
                    <Link href="/events">My events ({events.length})</Link>
                  </Button>
                ) : null}
              </div>

              <ul className="text-muted-foreground mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs sm:text-sm">
                {["One selfie, instant results", "Self-hosted AI", "Guests need no app"].map(
                  (t) => (
                    <li key={t} className="inline-flex items-center gap-1.5">
                      <Check className="text-primary size-3.5" />
                      {t}
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Product mockup — the guest phone experience, in pure CSS */}
            <div className="relative mx-auto hidden w-full max-w-[300px] lg:block">
              <PhoneMockup />
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-24 sm:mt-32">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Three steps. <span className="text-gradient">Zero friction.</span>
            </h2>
            <p className="text-muted-foreground mt-3 text-sm sm:text-base">
              From your camera roll to every guest&apos;s pocket in minutes.
            </p>
          </div>

          <div className="reveal-group mt-10 grid gap-4 sm:grid-cols-3 sm:gap-5">
            <StepCard
              icon={<Upload className="size-5" />}
              step="01"
              title="Upload your photos"
              description="Drag-and-drop the whole shoot. Every face is indexed automatically by self-hosted AI."
            />
            <StepCard
              icon={<QrCode className="size-5" />}
              step="02"
              title="Share one QR"
              description="Print it at the venue or drop it in the group chat. One code covers the entire event."
            />
            <StepCard
              icon={<ScanFace className="size-5" />}
              step="03"
              title="Guests selfie-search"
              description="One selfie returns every photo that guest appears in — and nothing else."
            />
          </div>
        </section>

        {/* Recent events for signed-in owners */}
        {hasEvents ? (
          <section className="mt-20">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Recent events</h2>
              <Button asChild variant="ghost" size="sm" className="rounded-full">
                <Link href="/events">See all</Link>
              </Button>
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {events.slice(0, 4).map((e) => (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.slug}`}
                    className="border-border bg-card lift flex items-center justify-between gap-3 rounded-2xl border p-4"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{e.name}</div>
                      <div className="text-muted-foreground text-xs">
                        Created {new Date(e.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 opacity-50" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          /* Bottom CTA for logged-out visitors */
          <section className="relative mt-24 overflow-hidden rounded-3xl sm:mt-32">
            <div className="aurora" aria-hidden />
            {/* Pricing. There is no checkout — plans are bought by talking to us,
                so every card points at the same contact action. */}
            <div id="pricing" className="mb-16 scroll-mt-20">
              <div className="text-center">
                <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-4xl">
                  Simple yearly pricing
                </h2>
                <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm sm:text-base">
                  Capped by storage only — run as many events as you like. Get in touch and
                  we&apos;ll set your studio up the same day.
                </p>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {PAID_PLANS.map((key) => {
                  const plan = PLANS[key];
                  const featured = key === "pro";
                  return (
                    <div
                      key={key}
                      className={`glass relative flex flex-col rounded-3xl p-6 ${
                        featured ? "ring-primary/60 ring-2" : ""
                      }`}
                    >
                      {featured ? (
                        <span className="bg-primary text-primary-foreground absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold">
                          Most popular
                        </span>
                      ) : null}
                      <h3 className="font-semibold">{plan.label}</h3>
                      <p className="text-muted-foreground mt-1 text-xs">{plan.blurb}</p>
                      <p className="mt-4 text-3xl font-bold tracking-tight">
                        ₹{plan.priceInr.toLocaleString("en-IN")}
                        <span className="text-muted-foreground text-sm font-medium">/year</span>
                      </p>
                      <ul className="text-muted-foreground mt-5 flex flex-1 flex-col gap-2 text-sm">
                        {planFeatures(key).map((feature) => (
                          <li key={feature} className="flex items-center gap-2">
                            <Check className="text-primary size-3.5 shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                      <Button
                        asChild
                        variant={featured ? "default" : "outline"}
                        className="mt-6 w-full rounded-full"
                      >
                        <a href={SALES_CONTACT.whatsappUrl} target="_blank" rel="noreferrer">
                          <MessageCircle className="size-4" />
                          Talk to us
                        </a>
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="glass mt-6 flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center">
                <h3 className="text-lg font-semibold">Questions? Talk to a human.</h3>
                <p className="text-muted-foreground max-w-md text-sm">
                  We&apos;ll walk you through it and get your studio set up the same day.
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-2">
                  <Button asChild className="rounded-full">
                    <a href={SALES_CONTACT.whatsappUrl} target="_blank" rel="noreferrer">
                      <MessageCircle className="size-4" />
                      WhatsApp
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="rounded-full">
                    <a href={SALES_CONTACT.telUrl}>
                      <Phone className="size-4" />
                      {SALES_CONTACT.display}
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            <div className="glass flex flex-col items-center gap-5 rounded-3xl px-6 py-14 text-center sm:py-20">
              <span className="bg-primary/10 text-primary grid size-12 place-items-center rounded-2xl">
                <Zap className="size-5" />
              </span>
              <h2 className="text-balance text-2xl font-bold tracking-tight sm:text-4xl">
                Deliver photos the way guests expect.
              </h2>
              <p className="text-muted-foreground max-w-md text-sm sm:text-base">
                Message us and we&apos;ll have your studio running today.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  asChild
                  size="lg"
                  className="shadow-primary/30 h-13 rounded-full px-8 shadow-lg"
                >
                  <a href={SALES_CONTACT.whatsappUrl} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-4" />
                    Get started on WhatsApp
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-13 rounded-full px-8">
                  <a href={SALES_CONTACT.telUrl}>
                    <Phone className="size-4" />
                    {SALES_CONTACT.display}
                  </a>
                </Button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-border/60 border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col items-start gap-3 px-4 py-8 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-md">
              <Camera className="size-3" />
            </span>
            © {new Date().getFullYear()} PhotoDost
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <a
              href={SALES_CONTACT.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <MessageCircle className="size-3.5" />
              WhatsApp us
            </a>
            <a
              href={SALES_CONTACT.telUrl}
              className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
            >
              <Phone className="size-3.5" />
              {SALES_CONTACT.display}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* CSS-only phone mockup of the guest experience. */
function PhoneMockup() {
  return (
    <div className="float-slow relative">
      <div
        className="from-primary/40 absolute -inset-4 -z-10 rounded-[3rem] bg-gradient-to-br via-fuchsia-500/20 to-cyan-400/20 blur-2xl"
        aria-hidden
      />
      <div className="border-border bg-card overflow-hidden rounded-[2.4rem] border-[6px] shadow-2xl">
        {/* Notch */}
        <div className="bg-card flex justify-center pb-1 pt-2.5">
          <div className="bg-muted h-1.5 w-16 rounded-full" />
        </div>
        {/* Screen */}
        <div className="px-4 pb-5 pt-2">
          <div className="text-[11px] font-semibold">Riya &amp; Arjun — Reception</div>
          <div className="text-muted-foreground text-[9px]">Your photos · 23 of 1,847 match</div>

          {/* Selfie chip */}
          <div className="bg-primary/10 mt-2.5 flex items-center gap-2 rounded-xl p-2">
            <div className="scan-ring grid size-9 shrink-0 place-items-center rounded-full p-[2px]">
              <div className="bg-card grid size-full place-items-center rounded-full">
                <ScanFace className="text-primary size-4" />
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold leading-tight">Matched you!</div>
              <div className="text-muted-foreground text-[9px] leading-tight">98% confidence</div>
            </div>
          </div>

          {/* Photo grid */}
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {TILES.map((t, i) => (
              <div
                key={i}
                className={`rounded-lg bg-gradient-to-br ${t} aspect-square`}
                style={{ animationDelay: `${i * 90}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const TILES = [
  "from-indigo-300 to-violet-400 dark:from-indigo-500 dark:to-violet-600",
  "from-rose-300 to-pink-400 dark:from-rose-500 dark:to-pink-600",
  "from-amber-300 to-orange-400 dark:from-amber-500 dark:to-orange-600",
  "from-cyan-300 to-sky-400 dark:from-cyan-500 dark:to-sky-600",
  "from-fuchsia-300 to-purple-400 dark:from-fuchsia-500 dark:to-purple-600",
  "from-emerald-300 to-teal-400 dark:from-emerald-500 dark:to-teal-600",
  "from-sky-300 to-indigo-400 dark:from-sky-500 dark:to-indigo-600",
  "from-pink-300 to-rose-400 dark:from-pink-500 dark:to-rose-600",
  "from-violet-300 to-indigo-400 dark:from-violet-500 dark:to-indigo-600",
];

function StepCard({
  icon,
  step,
  title,
  description,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-border bg-card lift group relative overflow-hidden rounded-3xl border p-6 sm:p-7">
      <div
        className="from-primary/10 absolute -right-16 -top-16 size-40 rounded-full bg-gradient-to-br to-transparent blur-2xl transition-opacity"
        aria-hidden
      />
      <div className="flex items-center justify-between">
        <div className="bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground grid size-11 place-items-center rounded-2xl transition-colors duration-300">
          {icon}
        </div>
        <span className="text-gradient text-3xl font-bold tabular-nums opacity-70">{step}</span>
      </div>
      <h3 className="mt-5 text-lg font-bold tracking-tight">{title}</h3>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{description}</p>
    </div>
  );
}
