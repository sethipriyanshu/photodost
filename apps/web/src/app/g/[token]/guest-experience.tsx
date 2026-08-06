"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BookOpen,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  RefreshCw,
  ScanFace,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlbumInvite, type AlbumInviteData } from "./album-invite";

interface Photo {
  id: string;
  url: string;
  thumbUrl: string;
  previewUrl: string;
  mime: string;
  width: number | null;
  height: number | null;
  score?: number | null;
}

interface MatchResponse {
  photos: Photo[];
  faceMatchingActive: boolean;
  matchedCount: number;
  totalCount: number;
  reason?: string | null;
}

interface Props {
  token: string;
  eventName: string;
  eventDate: string | null;
  eventDescription: string | null;
  accentColor?: string | null;
  /** Null when this event has no published album. */
  album?: AlbumInviteData | null;
}

type Stage = "intro" | "camera" | "captured" | "searching" | "results";

export function GuestExperience({
  token,
  eventName,
  eventDate,
  eventDescription,
  accentColor,
  album = null,
}: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [faceMatchingActive, setFaceMatchingActive] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);

  // Brand the public gallery with the studio's accent color by overriding the
  // primary token for this subtree.
  const accentStyle = accentColor
    ? ({ "--primary": accentColor } as React.CSSProperties)
    : undefined;

  return (
    <div className="bg-background relative min-h-dvh" style={accentStyle}>
      <Header eventName={eventName} eventDate={eventDate} albumHref={album?.href ?? null} />

      {/* Mounted once so it can't re-open on every stage change. */}
      {album ? <AlbumInvite album={album} suppressed={stage !== "intro"} /> : null}

      {stage === "intro" ? (
        <Intro
          description={eventDescription}
          onStart={() => {
            setError(null);
            setStage("camera");
          }}
        />
      ) : null}

      {stage === "camera" ? (
        <CameraView
          onCapture={(dataUrl) => {
            setSelfieDataUrl(dataUrl);
            setStage("captured");
          }}
          onCancel={() => setStage("intro")}
          onError={(msg) => {
            setError(msg);
            setStage("intro");
          }}
        />
      ) : null}

      {stage === "captured" && selfieDataUrl ? (
        <CapturedReview
          dataUrl={selfieDataUrl}
          consent={consent}
          onConsentChange={setConsent}
          onRetake={() => {
            setSelfieDataUrl(null);
            setStage("camera");
          }}
          onConfirm={async () => {
            setStage("searching");
            try {
              const blob = await (await fetch(selfieDataUrl)).blob();
              const fd = new FormData();
              fd.set("selfie", blob, "selfie.jpg");
              fd.set("consent", consent ? "true" : "false");
              const res = await fetch(`/api/g/${token}/match`, {
                method: "POST",
                body: fd,
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(body.error ?? "Search failed");
              }
              const data = (await res.json()) as MatchResponse;
              setPhotos(data.photos);
              setFaceMatchingActive(data.faceMatchingActive);
              setTotalCount(data.totalCount);
              setFallbackReason(data.reason ?? null);
              setStage("results");
            } catch (err) {
              console.error(err);
              setError(
                err instanceof Error
                  ? err.message
                  : "We could not search right now. Please try again.",
              );
              setStage("captured");
            }
          }}
        />
      ) : null}

      {stage === "searching" ? <Searching /> : null}

      {stage === "results" ? (
        <Results
          photos={photos}
          faceMatchingActive={faceMatchingActive}
          totalCount={totalCount}
          fallbackReason={fallbackReason}
          onRetake={() => {
            setSelfieDataUrl(null);
            setPhotos([]);
            setStage("camera");
          }}
          onStartOver={() => {
            setSelfieDataUrl(null);
            setPhotos([]);
            setStage("intro");
          }}
        />
      ) : null}

      {error && (stage === "intro" || stage === "captured") ? (
        <div className="safe-bottom fixed inset-x-0 bottom-4 z-40 mx-auto max-w-md px-4">
          <div className="bg-destructive text-destructive-foreground reveal flex items-center gap-2 rounded-2xl px-4 py-3 text-sm shadow-xl">
            <AlertCircle className="size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss" className="-m-2 p-2">
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Header({
  eventName,
  eventDate,
  albumHref,
}: {
  eventName: string;
  eventDate: string | null;
  albumHref: string | null;
}) {
  return (
    <header className="safe-top glass sticky top-0 z-30">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2.5 px-4">
        <div className="bg-primary text-primary-foreground shadow-primary/30 grid size-9 place-items-center rounded-xl shadow-lg">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold tracking-tight">{eventName}</div>
          {eventDate ? (
            <div className="text-muted-foreground text-[11px]">
              {new Date(eventDate).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </div>
          ) : null}
        </div>

        {/* The durable way to the album — the invite popup is dismissible, this isn't. */}
        {albumHref ? (
          <Link
            href={albumHref}
            className="border-border/70 bg-background/60 hover:border-primary/50 hover:text-primary ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <BookOpen className="size-3.5" />
            Album
          </Link>
        ) : null}
      </div>
    </header>
  );
}

function Intro({ description, onStart }: { description: string | null; onStart: () => void }) {
  return (
    <main className="relative mx-auto flex max-w-md flex-col items-center px-5 pb-40 pt-12 text-center sm:pt-16">
      <div className="aurora" aria-hidden />

      <div className="reveal-group flex flex-col items-center">
        <div className="scan-ring grid size-20 place-items-center rounded-[1.75rem] p-[3px]">
          <div className="bg-background grid size-full place-items-center rounded-[1.6rem]">
            <ScanFace className="text-primary size-9" />
          </div>
        </div>

        <h1 className="mt-7 text-balance text-4xl font-bold tracking-tight">
          Find <span className="text-gradient">your photos</span>
        </h1>
        <p className="text-muted-foreground mt-3 max-w-xs text-pretty text-[15px] leading-relaxed">
          {description ?? "Take a quick selfie and we'll find every photo you appear in."}
        </p>

        <ul className="text-muted-foreground mt-8 flex w-full max-w-xs flex-col gap-3 text-left text-sm">
          <Tip>Use good lighting on your face</Tip>
          <Tip>Remove sunglasses if possible</Tip>
          <Tip>Your selfie is never shown to anyone else</Tip>
        </ul>
      </div>

      {/* Big thumb-reach CTA pinned to the bottom on phones */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-5 pb-5 pt-8">
        <div
          className="from-background pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent"
          aria-hidden
        />
        <Button
          size="lg"
          className="shadow-primary/40 h-15 relative w-full rounded-2xl text-base font-semibold shadow-xl active:scale-[0.98]"
          onClick={onStart}
        >
          <Camera className="size-5" />
          Take a selfie
        </Button>
      </div>
    </main>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <li className="glass flex items-start gap-2.5 rounded-xl px-3.5 py-2.5">
      <span className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-full" />
      <span>{children}</span>
    </li>
  );
}

function CameraView({
  onCapture,
  onCancel,
  onError,
}: {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError("Your browser does not support camera access.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (err) {
        console.error("getUserMedia failed", err);
        const isPermission =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        onError(
          isPermission
            ? "Camera access was blocked. Allow camera in your browser settings and try again."
            : "Could not start the camera. Try again or use a different browser.",
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onError]);

  const snap = useCallback(() => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const size = Math.min(w, h);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the front-facing video to match what the user sees on screen,
    // and centre-crop to a square so faces sit in the middle of the frame.
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    const sx = (w - size) / 2;
    const sy = (h - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, size, size);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    onCapture(dataUrl);
  }, [onCapture, ready]);

  return (
    <main className="safe-bottom mx-auto flex max-w-md flex-col px-5 pb-10 pt-5">
      <div className="scan-ring reveal relative rounded-[2rem] p-[3px]">
        <div className="bg-muted relative aspect-square overflow-hidden rounded-[1.85rem]">
          <video ref={videoRef} playsInline muted className="size-full -scale-x-100 object-cover" />
          {!ready ? (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="text-muted-foreground size-7 animate-spin" />
            </div>
          ) : null}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-2/3 rounded-full border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]" />
          </div>
        </div>
      </div>

      <p className="text-muted-foreground mt-5 text-center text-sm font-medium">
        Centre your face inside the circle
      </p>

      <div className="mt-7 flex items-center justify-between gap-3">
        <Button variant="outline" size="lg" className="h-13 rounded-2xl px-5" onClick={onCancel}>
          <X className="size-4" />
          Cancel
        </Button>
        <button
          type="button"
          onClick={snap}
          disabled={!ready}
          aria-label="Take selfie"
          className={cn(
            "grid size-20 place-items-center rounded-full border-4 transition-all active:scale-90 disabled:opacity-50",
            "border-primary/30 bg-primary shadow-primary/40 shadow-xl hover:scale-105",
          )}
        >
          <span className="bg-primary-foreground size-14 rounded-full" />
        </button>
        <span className="w-[104px]" aria-hidden />
      </div>
    </main>
  );
}

function CapturedReview({
  dataUrl,
  consent,
  onConsentChange,
  onRetake,
  onConfirm,
}: {
  dataUrl: string;
  consent: boolean;
  onConsentChange: (v: boolean) => void;
  onRetake: () => void;
  onConfirm: () => void;
}) {
  return (
    <main className="safe-bottom reveal-group mx-auto flex max-w-md flex-col px-5 pb-10 pt-5">
      <div className="bg-muted relative aspect-square overflow-hidden rounded-[2rem] shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} alt="Your selfie" className="size-full object-cover" />
      </div>

      <label className="glass mt-4 flex cursor-pointer items-start gap-3 rounded-2xl p-4 text-left">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => onConsentChange(e.target.checked)}
          className="accent-primary mt-0.5 size-5 shrink-0"
        />
        <span className="text-muted-foreground text-xs leading-relaxed">
          I agree to have my selfie analyzed to find photos I appear in. It&apos;s used only for
          this search, never shown to anyone else, and the face data is discarded right after.
        </span>
      </label>

      <div className="mt-4 flex gap-3">
        <Button variant="outline" size="lg" className="h-14 flex-1 rounded-2xl" onClick={onRetake}>
          <RefreshCw className="size-4" />
          Retake
        </Button>
        <Button
          size="lg"
          className="shadow-primary/30 h-14 flex-1 rounded-2xl font-semibold shadow-lg"
          onClick={onConfirm}
          disabled={!consent}
        >
          Find my photos
        </Button>
      </div>
    </main>
  );
}

function Searching() {
  return (
    <main className="safe-bottom mx-auto flex max-w-md flex-col items-center px-5 pt-24 text-center">
      <div className="scan-ring grid size-24 place-items-center rounded-full p-[3px]">
        <div className="bg-background grid size-full place-items-center rounded-full">
          <ScanFace className="text-primary size-10 animate-pulse" />
        </div>
      </div>
      <h2 className="mt-8 text-2xl font-bold tracking-tight">Finding your photos…</h2>
      <p className="text-muted-foreground mt-2 text-sm">This usually takes just a few seconds.</p>
    </main>
  );
}

function Results({
  photos,
  faceMatchingActive,
  totalCount,
  fallbackReason,
  onRetake,
  onStartOver,
}: {
  photos: Photo[];
  faceMatchingActive: boolean;
  totalCount: number;
  fallbackReason: string | null;
  onRetake: () => void;
  onStartOver: () => void;
}) {
  // Real face matching ran but didn't find anything for this person.
  if (faceMatchingActive && photos.length === 0) {
    return (
      <main className="safe-bottom reveal mx-auto flex max-w-md flex-col items-center px-5 pb-12 pt-14 text-center">
        <div className="bg-muted text-muted-foreground size-18 grid place-items-center rounded-3xl">
          <Camera className="size-7" />
        </div>
        <h2 className="mt-6 text-2xl font-bold tracking-tight">We didn&apos;t find you yet</h2>
        <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-relaxed">
          {totalCount === 0
            ? "The photographer is still uploading. Check back in a bit."
            : "Try retaking your selfie with better lighting and your face fully visible."}
        </p>
        <div className="mt-8 flex w-full flex-col gap-2.5">
          <Button size="lg" className="h-14 rounded-2xl font-semibold" onClick={onRetake}>
            <Camera className="size-4" />
            Retake selfie
          </Button>
          <Button variant="outline" size="lg" className="h-14 rounded-2xl" onClick={onStartOver}>
            <RefreshCw className="size-4" />
            Start over
          </Button>
        </div>
      </main>
    );
  }

  if (photos.length === 0) {
    return (
      <main className="safe-bottom reveal mx-auto flex max-w-md flex-col items-center px-5 pb-12 pt-14 text-center">
        <div className="bg-muted text-muted-foreground size-18 grid place-items-center rounded-3xl">
          <Camera className="size-7" />
        </div>
        <h2 className="mt-6 text-2xl font-bold tracking-tight">No photos yet</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          The photographer is still uploading. Try again in a bit.
        </p>
        <Button
          size="lg"
          className="mt-8 h-14 w-full rounded-2xl font-semibold"
          onClick={onStartOver}
        >
          <RefreshCw className="size-4" />
          Try again
        </Button>
      </main>
    );
  }

  return (
    <main className="safe-bottom mx-auto max-w-3xl pb-16">
      {/* Sticky results bar under the main header */}
      <div className="glass sticky top-14 z-20 mb-1 px-4 py-3 sm:px-5">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight sm:text-xl">
              {faceMatchingActive ? "Your photos" : "All event photos"}
            </h2>
            <p className="text-muted-foreground text-xs">
              {faceMatchingActive
                ? `${photos.length} of ${totalCount} photos match you`
                : `${photos.length} ${photos.length === 1 ? "photo" : "photos"}${
                    fallbackReason
                      ? " — face matching not ready yet"
                      : " — face matching warming up"
                  }`}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {faceMatchingActive ? (
              <Button variant="outline" size="sm" className="rounded-full" onClick={onRetake}>
                <Camera className="size-4" />
                <span className="hidden sm:inline">Retake</span>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" className="rounded-full" onClick={onStartOver}>
              <RefreshCw className="size-4" />
              <span className="hidden sm:inline">Start over</span>
            </Button>
          </div>
        </div>
      </div>

      <PhotoGrid photos={photos} />
    </main>
  );
}

function PhotoGrid({ photos }: { photos: Photo[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <>
      <ul className="grid grid-cols-3 gap-1 px-1 sm:grid-cols-4 sm:gap-1.5 sm:px-2">
        {photos.map((p, i) => (
          <li key={p.id} className="reveal" style={{ animationDelay: `${Math.min(i, 20) * 35}ms` }}>
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              className="bg-muted block aspect-square w-full overflow-hidden rounded-xl transition-transform active:scale-95"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
      {openIndex !== null ? (
        <Lightbox
          photos={photos}
          index={openIndex}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Full-screen viewer with swipe + arrow navigation. Mobile-first: big touch
 * targets, swipe left/right to move, swipe-friendly image area, safe-area
 * padded action bar.
 */
function Lightbox({
  photos,
  index,
  onNavigate,
  onClose,
}: {
  photos: Photo[];
  index: number;
  onNavigate: (i: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index]!;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const prev = useCallback(
    () => onNavigate(index > 0 ? index - 1 : photos.length - 1),
    [index, photos.length, onNavigate],
  );
  const next = useCallback(
    () => onNavigate(index < photos.length - 1 ? index + 1 : 0),
    [index, photos.length, onNavigate],
  );

  // Keyboard navigation for desktop guests.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-xl"
      onTouchStart={(e) => {
        const t = e.touches[0]!;
        touchStart.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const t = e.changedTouches[0]!;
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        // Horizontal swipe → navigate. Downward swipe → close.
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx < 0) next();
          else prev();
        } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
          onClose();
        }
      }}
    >
      {/* Top bar */}
      <div className="safe-top flex items-center justify-between p-3 text-white">
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium tabular-nums">
          {index + 1} / {photos.length}
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid size-11 place-items-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Image */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-2">
        {/* Preview for fast display; the download button links the full original. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={photo.id}
          src={photo.previewUrl}
          alt=""
          className="reveal max-h-full max-w-full select-none rounded-xl object-contain"
          draggable={false}
        />

        {/* Desktop arrows */}
        {photos.length > 1 ? (
          <>
            <button
              onClick={prev}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:grid"
            >
              <ChevronLeft className="size-6" />
            </button>
            <button
              onClick={next}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:grid"
            >
              <ChevronRight className="size-6" />
            </button>
          </>
        ) : null}
      </div>

      {/* Bottom action bar */}
      <div className="safe-bottom flex items-center justify-center gap-3 p-4">
        <Button
          asChild
          size="lg"
          className="h-13 flex-1 rounded-2xl bg-white font-semibold text-black hover:bg-white/90 sm:max-w-52"
        >
          <a href={photo.url} download target="_blank" rel="noreferrer">
            <Download className="size-5" />
            Download
          </a>
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-13 rounded-2xl border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
          aria-label="Share"
          onClick={async () => {
            if (typeof navigator.share === "function") {
              try {
                await navigator.share({ url: photo.url });
              } catch {
                /* user cancelled */
              }
            } else {
              await navigator.clipboard.writeText(photo.url).catch(() => {});
            }
          }}
        >
          <Share2 className="size-5" />
        </Button>
      </div>
    </div>
  );
}
