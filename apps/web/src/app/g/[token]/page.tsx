import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, ImageOff } from "lucide-react";
import { countEventAssets, getEventByShareToken } from "@/lib/events";
import { hasPublishedAlbum } from "@/lib/albums";
import { getWorkspaceById } from "@/lib/workspaces";
import { GuestExperience } from "./guest-experience";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const event = await getEventByShareToken(token);
  return {
    title: event?.name ?? "Your photos",
    description: event ? `Find your photos from ${event.name}` : "Find your photos",
  };
}

export default async function GuestPage({ params }: PageProps) {
  const { token } = await params;
  const event = await getEventByShareToken(token);
  if (!event || event.shareRevokedAt) notFound();

  const workspace = await getWorkspaceById(event.workspaceId);
  // A quiet line, not a competing hero: the selfie search stays the main action.
  const albumAvailable = await hasPublishedAlbum(event.id);

  // The retention purge deletes photos but keeps the event row, so a QR printed
  // on a wedding invitation still resolves. Say so plainly rather than walking a
  // guest through a selfie search that can only ever return nothing.
  const purged = workspace?.photosPurgedAt !== null && (await countEventAssets(event.id)) === 0;
  if (purged) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <ImageOff className="text-muted-foreground size-8" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{event.name}</h1>
        <p className="text-muted-foreground mt-2 text-sm">These photos are no longer available.</p>
        <p className="text-muted-foreground mt-4 text-xs">
          If you were expecting to find yourself here, please contact the photographer directly —
          they may still have the originals.
        </p>
      </main>
    );
  }

  return (
    <>
      <GuestExperience
        token={token}
        eventName={event.name}
        eventDate={event.date ? event.date.toISOString() : null}
        eventDescription={event.description}
        accentColor={workspace?.accentColor ?? null}
      />

      {albumAvailable ? (
        <div className="mx-auto max-w-md px-6 pb-10 text-center">
          <p className="text-muted-foreground text-sm">There&apos;s an album for this event too.</p>
          <Link
            href={`/g/${token}/album`}
            className="text-primary mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium underline"
          >
            <BookOpen className="size-4" />
            View the event album
          </Link>
        </div>
      ) : null}
    </>
  );
}
