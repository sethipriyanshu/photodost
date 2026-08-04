import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ImageIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { getEventCoverThumbs, listEvents } from "@/lib/events";
import { requireWorkspace } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
};

export default async function EventsPage() {
  const { workspace } = await requireWorkspace();
  const events = await listEvents(workspace.id);
  const coverThumbs = await getEventCoverThumbs(events);

  return (
    <div className="relative min-h-dvh">
      <SiteHeader
        backHref="/app"
        backLabel="Dashboard"
        rightSlot={
          <Button asChild size="sm" className="rounded-full px-4">
            <Link href="/events/new">
              <Plus className="size-4" />
              New event
            </Link>
          </Button>
        }
      />

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="reveal">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Your events</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Each event is its own photo library with its own QR code.
          </p>
        </div>

        {events.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="reveal-group mt-8 grid gap-3 sm:grid-cols-2">
            {events.map((e) => {
              const cover = coverThumbs.get(e.id);
              return (
                <li key={e.id}>
                  <Link
                    href={`/events/${e.slug}`}
                    className="border-border bg-card lift flex items-center gap-4 rounded-2xl border p-3.5"
                  >
                    <div className="bg-muted size-16 shrink-0 overflow-hidden rounded-xl">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="size-full object-cover" />
                      ) : (
                        <div className="from-primary/15 text-primary grid size-full place-items-center bg-gradient-to-br to-fuchsia-500/10">
                          <ImageIcon className="size-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-base font-semibold">{e.name}</div>
                      <div className="text-muted-foreground mt-1 text-xs">
                        {e.date
                          ? new Date(e.date).toLocaleDateString(undefined, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : `Created ${new Date(e.createdAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 opacity-50" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-card/40 relative mt-10 overflow-hidden rounded-3xl border border-dashed px-6 py-14 text-center sm:py-20">
      <div className="aurora" aria-hidden />
      <div className="bg-primary/10 text-primary mx-auto grid size-14 place-items-center rounded-2xl">
        <ImageIcon className="size-6" />
      </div>
      <h2 className="mt-5 text-xl font-bold tracking-tight">No events yet</h2>
      <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
        Create your first event to upload photos and share them via QR code.
      </p>
      <Button asChild size="lg" className="shadow-primary/30 mt-7 rounded-full px-8 shadow-lg">
        <Link href="/events/new">
          <Plus className="size-4" />
          Create your first event
        </Link>
      </Button>
    </div>
  );
}
