import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SiteHeader } from "@/components/site-header";
import { getEventBySlug, getVariantKeyMap, listEventAssets } from "@/lib/events";
import { getAlbumForEvent } from "@/lib/albums";
import { AlbumManager, type AlbumView } from "./album-manager";
import { requireWorkspace } from "@/lib/session";
import { env } from "@/lib/env";
import { qrDataUrl } from "@/lib/qr";
import { displayUrls } from "@/lib/s3";
import { EventDashboard } from "./event-dashboard";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { workspace } = await requireWorkspace();
  const event = await getEventBySlug(workspace.id, slug);
  return { title: event?.name ?? "Event" };
}

export default async function EventPage({ params }: PageProps) {
  const { slug } = await params;
  const { workspace } = await requireWorkspace();
  const event = await getEventBySlug(workspace.id, slug);
  if (!event) notFound();

  const assets = await listEventAssets(event.id);
  const album = await getAlbumForEvent(event.id);

  // Dates and bigints don't cross the server/client boundary as-is.
  const albumView: AlbumView | null = album
    ? {
        id: album.id,
        publishedAt: album.publishedAt?.toISOString() ?? null,
        cover: album.cover ? { ...album.cover, bytes: Number(album.cover.bytes) } : null,
        back: album.back ? { ...album.back, bytes: Number(album.back.bytes) } : null,
        spreads: album.spreads.map((s) => ({ ...s, bytes: Number(s.bytes) })),
        totalBytes: album.totalBytes,
      }
    : null;
  const variantMap = await getVariantKeyMap(assets.map((a) => a.id));
  const guestUrl = `${env.APP_URL.replace(/\/$/, "")}/g/${event.shareToken}`;
  const qr = await qrDataUrl(guestUrl);

  return (
    <div className="relative min-h-dvh">
      <SiteHeader
        backHref="/events"
        backLabel="Events"
        rightSlot={
          <Button asChild variant="outline" size="sm">
            <Link href={`/g/${event.shareToken}`} target="_blank">
              <ExternalLink className="size-4" />
              Guest view
            </Link>
          </Button>
        }
      />

      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{event.name}</h1>
            {event.description ? (
              <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm">{event.description}</p>
            ) : null}
            {event.date ? (
              <p className="text-muted-foreground mt-1.5 text-sm">
                {new Date(event.date).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            ) : null}
          </div>

          <div className="text-muted-foreground text-xs">
            <span className="font-mono">{event.slug}</span>
          </div>
        </div>

        <EventDashboard
          slug={event.slug}
          shareToken={event.shareToken}
          guestUrl={guestUrl}
          qrDataUrl={qr}
          initialMatchThreshold={event.matchThreshold}
          initialRevoked={Boolean(event.shareRevokedAt)}
          initialCoverAssetId={event.coverAssetId}
          initialAssets={assets.map((a) => {
            const { url, thumbUrl } = displayUrls(a.originalKey, variantMap.get(a.id));
            return {
              id: a.id,
              url,
              thumbUrl,
              mime: a.mime,
              bytes: Number(a.bytes),
              createdAt: a.createdAt.toISOString(),
            };
          })}
        />

        <AlbumManager slug={slug} guestUrl={guestUrl} initialAlbum={albumView} />

        {workspace.photosPurgedAt && assets.length === 0 ? (
          <p className="border-border bg-muted/40 text-muted-foreground mt-10 rounded-xl border p-4 text-xs">
            The photos for this event were deleted on{" "}
            {new Intl.DateTimeFormat("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(workspace.photosPurgedAt)}{" "}
            because the plan lapsed. Deletion is permanent — subscribing again lets you upload new
            photos, but cannot bring these back.
          </p>
        ) : null}

        <div className="text-muted-foreground mt-10 flex items-center gap-2 text-xs">
          <Share2 className="size-3.5" />
          Share the guest link or QR with attendees — only your workspace can manage this event.
        </div>
      </main>
    </div>
  );
}
