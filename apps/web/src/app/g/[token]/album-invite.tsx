"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface AlbumInviteData {
  href: string;
  previewUrl: string | null;
  previewWidth: number | null;
  previewHeight: number | null;
  spreadCount: number;
}

interface Props {
  album: AlbumInviteData;
  /** True while the guest is somewhere a modal would interrupt (camera, results). */
  suppressed?: boolean;
}

/** Long enough for the page to settle, short enough to feel like part of arriving. */
const OPEN_DELAY_MS = 900;

/**
 * A one-time invite to the event album.
 *
 * The gallery is a full-viewport experience, so an inline CTA below it is never
 * seen on a phone without scrolling. This surfaces the album on arrival instead
 * and then stays out of the way — the header chip is the permanent way back, so
 * closing this can't strand a guest.
 *
 * Dismissal is remembered per session, not forever: a guest who comes back to
 * the QR next week gets the invite again, but it never nags twice in one visit.
 */
export function AlbumInvite({ album, suppressed = false }: Props) {
  const [open, setOpen] = useState(false);
  const storageKey = `pd:album-invite:${album.href}`;

  // The timer fires ~1s after mount; by then the guest may already have opened
  // the camera. Read the live value so we never cover a viewfinder.
  const suppressedRef = useRef(suppressed);
  suppressedRef.current = suppressed;

  const remember = useCallback(() => {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // Private mode / storage disabled: the invite simply shows again.
    }
  }, [storageKey]);

  const close = useCallback(() => {
    setOpen(false);
    remember();
  }, [remember]);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(storageKey) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    const timer = setTimeout(() => {
      if (suppressedRef.current) {
        remember(); // Missed its moment — don't ambush them later.
        return;
      }
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [storageKey, remember]);

  // Escape to close, and hold the page still while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  if (!open) return null;

  const ratio =
    album.previewWidth && album.previewHeight ? album.previewWidth / album.previewHeight : 3 / 2;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="album-invite-title"
    >
      <div
        className="pop-scrim absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />

      <div className="pop-sheet safe-bottom border-border bg-background relative w-full max-w-sm rounded-t-3xl border p-5 shadow-2xl sm:mx-4 sm:rounded-3xl">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="text-muted-foreground hover:bg-muted hover:text-foreground absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full transition-colors"
        >
          <X className="size-4" />
        </button>

        {album.previewUrl ? (
          <div
            className="bg-muted relative mb-4 overflow-hidden rounded-2xl"
            style={{ aspectRatio: ratio }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={album.previewUrl}
              alt=""
              className="size-full object-cover"
              loading="eager"
              decoding="async"
            />
            {/* A hint of the spine, so it reads as a book rather than a photo. */}
            <div
              className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/25"
              aria-hidden
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent"
              aria-hidden
            />
          </div>
        ) : null}

        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <BookOpen className="size-5" />
          </div>
          <div className="min-w-0 pr-6">
            <h2 id="album-invite-title" className="text-base font-bold tracking-tight">
              The album is ready
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              {album.spreadCount > 0
                ? `Flip through all ${album.spreadCount} page${
                    album.spreadCount === 1 ? "" : "s"
                  } of the designed album, just like the printed book.`
                : "Flip through the designed album, just like the printed book."}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <Button asChild size="lg" className="h-12 w-full rounded-xl font-semibold">
            <Link href={album.href} onClick={remember}>
              <BookOpen className="size-4" />
              View the album
            </Link>
          </Button>
          <button
            type="button"
            onClick={close}
            className="text-muted-foreground hover:text-foreground h-10 rounded-xl text-sm font-medium transition-colors"
          >
            Find my photos first
          </button>
        </div>
      </div>
    </div>
  );
}
