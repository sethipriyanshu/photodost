"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

/**
 * A page-turning photo album.
 *
 * Built with CSS 3D rather than a flipbook library on purpose. The well-known
 * ones (StPageFlip and its React wrapper) were last published in 2022, predate
 * React 19, and their headline feature is *soft paper bending* — pages that
 * curl like a paperback. A wedding album is thick rigid card: its pages pivot,
 * they don't bend. So a rigid leaf rotating about the spine is both more
 * accurate for this object and something we fully control.
 *
 * Geometry
 * --------
 * Album software exports **spreads** — one wide image covering two facing
 * pages. A physical album is made of leaves, each with a front and a back, and
 * the two halves of a spread live on *different* leaves:
 *
 *   leaf 0:  front = cover        back = spread 1 left
 *   leaf 1:  front = spread 1 right   back = spread 2 left
 *   leaf 2:  front = spread 2 right   back = spread 3 left
 *   leaf N:  front = spread N right   back = back cover
 *
 * So the flat face sequence is [cover, s1L, s1R, s2L, s2R, …, sNL, sNR, back],
 * which is always even, and leaves = faces / 2. Halves are produced at render
 * time with a 200%-wide image and a negative offset, so the uploaded file is
 * never cut and re-exporting a layout means replacing one file.
 */

export interface FlipbookPage {
  kind: "cover" | "spread" | "back";
  url: string;
  /** Real pixel dimensions, captured at upload. Drive the book's shape. */
  width?: number | null;
  height?: number | null;
}

interface Face {
  url: string;
  /** Which half of a spread this face shows; `full` for the covers. */
  half: "left" | "right" | "full";
}

function buildFaces(pages: FlipbookPage[]): Face[] {
  const cover = pages.find((p) => p.kind === "cover");
  const back = pages.find((p) => p.kind === "back");
  const spreads = pages.filter((p) => p.kind === "spread");

  const faces: Face[] = [];
  if (cover) faces.push({ url: cover.url, half: "full" });
  for (const s of spreads) {
    faces.push({ url: s.url, half: "left" });
    faces.push({ url: s.url, half: "right" });
  }
  if (back) faces.push({ url: back.url, half: "full" });

  // Leaves need pairs. A missing cover or back would otherwise shift every
  // spread onto the wrong side of the book, so pad rather than mis-render.
  if (faces.length % 2 === 1) faces.push({ url: "", half: "full" });
  return faces;
}

/**
 * The open book's width-to-height ratio, taken from the files themselves.
 *
 * Albums are not one shape: a 12×12" square opens at 2:1, a 12×9" landscape at
 * 8:3, an 8×12" portrait at 4:3. Hardcoding a ratio would letterbox or crop
 * every album that isn't square, so the shape comes from the uploads.
 *
 * Spreads win because a spread *is* the open book. A cover is a single page, so
 * its ratio is doubled. Where spreads disagree — a photographer mixing exports —
 * the most common shape wins rather than whichever happens to be first, so one
 * odd page can't set the geometry for the whole book.
 */
function openBookAspect(pages: FlipbookPage[]): number {
  const ratioOf = (p: FlipbookPage) =>
    p.width && p.height && p.height > 0 ? p.width / p.height : null;

  const spreadRatios = pages
    .filter((p) => p.kind === "spread")
    .map(ratioOf)
    .filter((r): r is number => r !== null);

  if (spreadRatios.length > 0) {
    // Bucket to 2dp so near-identical exports count as the same shape.
    const tally = new Map<string, { ratio: number; n: number }>();
    for (const r of spreadRatios) {
      const key = r.toFixed(2);
      const cur = tally.get(key);
      if (cur) cur.n += 1;
      else tally.set(key, { ratio: r, n: 1 });
    }
    return [...tally.values()].sort((a, b) => b.n - a.n)[0]!.ratio;
  }

  // No spreads with dimensions — fall back to a cover, doubled (it's one page).
  const coverRatio = ratioOf(pages.find((p) => p.kind === "cover") ?? ({} as FlipbookPage));
  if (coverRatio) return coverRatio * 2;

  // Nothing to go on: assume a square-page album.
  return 2;
}

function FaceImage({ face, eager }: { face: Face; eager: boolean }) {
  if (!face.url) return <div className="size-full bg-neutral-200 dark:bg-neutral-800" />;
  return (
    <div className="size-full overflow-hidden bg-neutral-100 dark:bg-neutral-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={face.url}
        alt=""
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        className="h-full max-w-none select-none object-contain"
        style={
          face.half === "full"
            ? { width: "100%" }
            : { width: "200%", marginLeft: face.half === "right" ? "-100%" : 0 }
        }
      />
    </div>
  );
}

/** Ink-and-shadow near the spine. Sells the fold more than the geometry does. */
function SpineShade({ side }: { side: "left" | "right" }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 w-[14%]"
      style={{
        [side]: 0,
        background:
          side === "right"
            ? "linear-gradient(to left, rgba(0,0,0,0.28), rgba(0,0,0,0.06) 45%, transparent)"
            : "linear-gradient(to right, rgba(0,0,0,0.28), rgba(0,0,0,0.06) 45%, transparent)",
      }}
    />
  );
}

export function Flipbook({ pages }: { pages: FlipbookPage[] }) {
  const faces = useMemo(() => buildFaces(pages), [pages]);
  const aspect = useMemo(() => openBookAspect(pages), [pages]);
  const leafCount = faces.length / 2;

  // How many leaves have been turned. 0 = closed on the cover.
  const [turned, setTurned] = useState(0);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const canForward = turned < leafCount;
  const canBack = turned > 0;

  const next = useCallback(() => setTurned((t) => Math.min(leafCount, t + 1)), [leafCount]);
  const prev = useCallback(() => setTurned((t) => Math.max(0, t - 1)), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Home") setTurned(0);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // Swipe. Guests arrive from a QR code, so touch is the primary input.
  const dragStart = useRef<number | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    dragStart.current = e.clientX;
    setDragging(true);
  }
  function onPointerUp(e: React.PointerEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    setDragging(false);
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) next();
    else prev();
  }

  if (faces.length === 0) return null;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div
        ref={containerRef}
        className="relative w-full max-w-4xl touch-pan-y select-none"
        style={{ perspective: "2400px", perspectiveOrigin: "50% 45%" }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => (dragStart.current = null)}
      >
        {/* Shape comes from the uploaded spreads — see openBookAspect. */}
        <div
          className="relative w-full"
          style={{ aspectRatio: String(aspect), transformStyle: "preserve-3d" }}
        >
          {/* The static verso: whatever is behind the leaf currently on the left. */}
          <div className="absolute inset-y-0 left-0 w-1/2 overflow-hidden rounded-l-md bg-neutral-200 shadow-inner dark:bg-neutral-800">
            {turned > 0 ? <FaceImage face={faces[2 * turned - 1]!} eager /> : null}
            <SpineShade side="right" />
          </div>

          {/* The static recto: what sits under the stack still to be turned. */}
          <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden rounded-r-md bg-neutral-200 shadow-inner dark:bg-neutral-800">
            {turned < leafCount ? <FaceImage face={faces[2 * turned]!} eager /> : null}
            <SpineShade side="left" />
          </div>

          {/* The leaves themselves, hinged at the spine. */}
          {Array.from({ length: leafCount }, (_, i) => {
            const isTurned = i < turned;
            const front = faces[2 * i]!;
            const back = faces[2 * i + 1]!;
            // Unturned leaves stack with the topmost first; turned ones stack the
            // other way, so a leaf mid-flight is always above its neighbours.
            const z = isTurned ? i + 1 : leafCount - i;
            // Only render leaves near the current position: a 60-spread album
            // would otherwise mount 120 full-size images at once.
            if (Math.abs(i - turned) > 2) return null;

            return (
              <div
                key={i}
                className="absolute inset-y-0 right-0 w-1/2 [transition:transform_700ms_cubic-bezier(0.22,0.61,0.36,1)]"
                style={{
                  transformStyle: "preserve-3d",
                  transformOrigin: "left center",
                  transform: `rotateY(${isTurned ? -180 : 0}deg)`,
                  zIndex: z,
                }}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 overflow-hidden rounded-r-md shadow-xl"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  <FaceImage face={front} eager={Math.abs(i - turned) <= 1} />
                  <SpineShade side="left" />
                </div>
                {/* Back */}
                <div
                  className="absolute inset-0 overflow-hidden rounded-l-md shadow-xl"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <FaceImage face={back} eager={Math.abs(i - turned) <= 1} />
                  <SpineShade side="right" />
                </div>
              </div>
            );
          })}

          {/* Centre gutter: a thin dark seam reads as the binding. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-1/2 z-50 w-[3px] -translate-x-1/2"
            style={{
              background:
                "linear-gradient(to right, rgba(0,0,0,0.05), rgba(0,0,0,0.45), rgba(0,0,0,0.05))",
            }}
          />
        </div>

        {/* Contact shadow. Grounds the book instead of leaving it floating. */}
        <div
          aria-hidden
          className="mx-auto h-6 w-[85%] -translate-y-2 rounded-[50%] blur-xl"
          style={{ background: "rgba(0,0,0,0.35)" }}
        />

        {/* Click targets over each half. */}
        <button
          type="button"
          aria-label="Previous page"
          disabled={!canBack}
          onClick={prev}
          className="absolute inset-y-0 left-0 z-40 w-1/2 cursor-w-resize disabled:cursor-default"
        />
        <button
          type="button"
          aria-label="Next page"
          disabled={!canForward}
          onClick={next}
          className="absolute inset-y-0 right-0 z-40 w-1/2 cursor-e-resize disabled:cursor-default"
        />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={prev}
          disabled={!canBack}
          aria-label="Previous page"
          className="border-border grid size-9 place-items-center rounded-full border transition disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-muted-foreground min-w-24 text-center text-xs tabular-nums">
          {turned === 0
            ? "Cover"
            : turned >= leafCount
              ? "Back cover"
              : `Spread ${turned} of ${leafCount - 1}`}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={!canForward}
          aria-label="Next page"
          className="border-border grid size-9 place-items-center rounded-full border transition disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
        {turned > 0 ? (
          <button
            type="button"
            onClick={() => setTurned(0)}
            className="text-muted-foreground hover:text-foreground ml-1 inline-flex items-center gap-1.5 text-xs transition"
          >
            <RotateCcw className="size-3.5" />
            Start
          </button>
        ) : null}
      </div>

      <p className="text-muted-foreground text-center text-xs sm:hidden">
        Turn your phone sideways for a bigger view.
      </p>
      <p className="text-muted-foreground hidden text-center text-xs sm:block">
        Click either page, swipe, or use the arrow keys.
      </p>

      {dragging ? <span className="sr-only">Turning page</span> : null}
    </div>
  );
}
