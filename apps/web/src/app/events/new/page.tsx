import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { requireWorkspace } from "@/lib/session";
import { NewEventForm } from "./new-event-form";

export const metadata: Metadata = {
  title: "New event",
};

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  await requireWorkspace();
  return (
    <div className="relative min-h-dvh">
      <SiteHeader backHref="/events" backLabel="Events" />
      <main className="mx-auto max-w-xl px-4 pb-20 pt-8 sm:px-6 sm:pt-14">
        <NewEventForm />
      </main>
    </div>
  );
}
