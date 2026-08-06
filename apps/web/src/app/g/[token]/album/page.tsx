import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getPublishedAlbumByShareToken } from "@/lib/albums";
import { Flipbook, type FlipbookPage } from "@/components/flipbook";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const found = await getPublishedAlbumByShareToken(token);
  return {
    title: found ? `${found.eventName} — Album` : "Album",
    description: found ? `Flip through the album from ${found.eventName}` : undefined,
  };
}

export default async function GuestAlbumPage({ params }: PageProps) {
  const { token } = await params;
  const found = await getPublishedAlbumByShareToken(token);

  // Unpublished, empty, or a revoked share token all land here. 404 rather than
  // an empty book — there is nothing to read.
  if (!found) notFound();

  const { eventName, album, accentColor } = found;

  const pages: FlipbookPage[] = [
    ...(album.cover
      ? [
          {
            kind: "cover" as const,
            url: album.cover.url,
            width: album.cover.width,
            height: album.cover.height,
          },
        ]
      : []),
    ...album.spreads.map((s) => ({
      kind: "spread" as const,
      url: s.url,
      width: s.width,
      height: s.height,
    })),
    ...(album.back
      ? [
          {
            kind: "back" as const,
            url: album.back.url,
            width: album.back.width,
            height: album.back.height,
          },
        ]
      : []),
  ];

  return (
    <div
      className="min-h-dvh bg-neutral-950 px-4 py-6 sm:py-10"
      style={
        accentColor ? ({ ["--primary" as string]: accentColor } as React.CSSProperties) : undefined
      }
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <Link
            href={`/g/${token}`}
            className="inline-flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-white"
          >
            <ArrowLeft className="size-4" />
            Find my photos
          </Link>
          <span className="text-xs text-neutral-500">
            {album.spreads.length} spread{album.spreads.length === 1 ? "" : "s"}
          </span>
        </header>

        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-neutral-100 sm:text-2xl">{eventName}</h1>
          <p className="mt-1 text-xs text-neutral-400 sm:text-sm">The album</p>
        </div>

        <Flipbook pages={pages} />
      </div>
    </div>
  );
}
