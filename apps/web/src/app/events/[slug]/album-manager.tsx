"use client";

import { useCallback, useRef, useState } from "react";
import { BookOpen, Eye, EyeOff, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Album manager for an event.
 *
 * Three separate pickers — front cover, spreads, back cover — rather than one
 * drop zone that guesses roles from filenames. Album exports are named
 * inconsistently ("(2).jpg", "Front.jpg", "(141).jpg"), so guessing would be
 * wrong often enough to be worse than asking.
 *
 * Spreads keep the order they were selected in.
 */

export interface AlbumPageView {
  id: string;
  kind: "cover" | "spread" | "back";
  position: number;
  url: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface AlbumView {
  id: string;
  publishedAt: string | null;
  cover: AlbumPageView | null;
  back: AlbumPageView | null;
  spreads: AlbumPageView[];
  totalBytes: number;
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Real pixel dimensions, read in the browser so the viewer can shape the book. */
async function readDimensions(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const out = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return out;
  } catch {
    // Not fatal — openBookAspect falls back to a sensible default.
    return {};
  }
}

export function AlbumManager({
  slug,
  guestUrl,
  initialAlbum,
}: {
  slug: string;
  guestUrl: string;
  initialAlbum: AlbumView | null;
}) {
  const [album, setAlbum] = useState<AlbumView | null>(initialAlbum);
  const [busy, setBusy] = useState<null | "cover" | "spread" | "back" | "publish">(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const spreadInput = useRef<HTMLInputElement>(null);
  const backInput = useRef<HTMLInputElement>(null);

  const published = Boolean(album?.publishedAt);
  const spreadCount = album?.spreads.length ?? 0;
  const canPublish = Boolean(album?.cover) || spreadCount > 0;

  const upload = useCallback(
    async (kind: "cover" | "spread" | "back", fileList: FileList) => {
      const all = Array.from(fileList);
      // 0-byte files turn up in copied folders and would upload "fine" as an
      // unrenderable page, so drop them before asking for presigned URLs.
      const files = all.filter((f) => f.size > 0);
      const skipped = all.length - files.length;
      if (skipped > 0) {
        toast.warning(`Skipped ${skipped} empty file${skipped === 1 ? "" : "s"}.`);
      }
      if (files.length === 0) return;

      setBusy(kind);
      setProgress({ done: 0, total: files.length });

      try {
        const described = await Promise.all(
          files.map(async (f) => ({
            filename: f.name,
            mime: f.type || "image/jpeg",
            size: f.size,
            ...(await readDimensions(f)),
          })),
        );

        const presignRes = await fetch(`/api/events/${slug}/album/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, files: described }),
        });
        const presign = await presignRes.json();
        if (!presignRes.ok) throw new Error(presign.error ?? "Could not start the upload.");

        // Bounded concurrency: a 20-spread album at 40 MB each would otherwise
        // open twenty simultaneous PUTs and hold every file in memory at once.
        const CONCURRENCY = 4;
        const queue = presign.uploads as Array<{
          pageId: string;
          key: string;
          uploadUrl: string;
          mime: string;
          position: number;
          width: number | null;
          height: number | null;
        }>;
        let cursor = 0;
        let done = 0;
        const failures: string[] = [];

        async function worker() {
          while (cursor < queue.length) {
            const index = cursor++;
            const item = queue[index]!;
            const file = files[index]!;
            try {
              const put = await fetch(item.uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": item.mime },
                body: file,
              });
              if (!put.ok) throw new Error(`HTTP ${put.status}`);
            } catch (err) {
              failures.push(file.name);
            } finally {
              done += 1;
              setProgress({ done, total: queue.length });
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

        if (failures.length === queue.length) {
          throw new Error("Every upload failed. Check your connection and try again.");
        }

        const finalizeRes = await fetch(`/api/events/${slug}/album/pages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            pages: queue.map((u) => ({
              pageId: u.pageId,
              key: u.key,
              position: u.position,
              width: u.width,
              height: u.height,
            })),
          }),
        });
        const finalized = await finalizeRes.json();
        if (!finalizeRes.ok) throw new Error(finalized.error ?? "Could not save the pages.");

        setAlbum(finalized.album);
        toast.success(
          kind === "spread"
            ? `Added ${finalized.added} spread${finalized.added === 1 ? "" : "s"}.`
            : `${kind === "cover" ? "Front" : "Back"} cover updated.`,
        );
        if (failures.length > 0) {
          toast.warning(
            `${failures.length} file${failures.length === 1 ? "" : "s"} failed to upload.`,
          );
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(null);
        setProgress(null);
        coverInput.current && (coverInput.current.value = "");
        spreadInput.current && (spreadInput.current.value = "");
        backInput.current && (backInput.current.value = "");
      }
    },
    [slug],
  );

  async function removePage(pageId: string) {
    try {
      const res = await fetch(`/api/events/${slug}/album/pages?pageId=${pageId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not remove the page.");
      setAlbum(data.album);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the page.");
    }
  }

  async function togglePublish() {
    setBusy("publish");
    try {
      const res = await fetch(`/api/events/${slug}/album`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: !published }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not update the album.");
      setAlbum(data.album);
      toast.success(
        data.album?.publishedAt ? "Album is live for guests." : "Album hidden from guests.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the album.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="border-border bg-card mt-8 rounded-2xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4" />
          <div>
            <h2 className="font-semibold">Flipbook album</h2>
            <p className="text-muted-foreground text-xs">
              Upload your designed spreads. Guests flip through them from the same QR.
            </p>
          </div>
        </div>

        {album ? (
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                published
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {published ? "Live" : "Draft"}
            </span>
            <Button
              type="button"
              variant={published ? "outline" : "default"}
              size="sm"
              className="rounded-full"
              disabled={busy !== null || !canPublish}
              onClick={togglePublish}
            >
              {busy === "publish" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : published ? (
                <EyeOff className="size-3.5" />
              ) : (
                <Eye className="size-3.5" />
              )}
              {published ? "Hide from guests" : "Publish"}
            </Button>
          </div>
        ) : null}
      </div>

      {/* pickers */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Slot
          label="Front cover"
          hint="One image"
          page={album?.cover ?? null}
          busy={busy === "cover"}
          onPick={() => coverInput.current?.click()}
          onRemove={album?.cover ? () => removePage(album.cover!.id) : undefined}
        />
        <Slot
          label="Spreads"
          hint={spreadCount > 0 ? `${spreadCount} added` : "Select many at once"}
          page={album?.spreads[0] ?? null}
          count={spreadCount}
          busy={busy === "spread"}
          onPick={() => spreadInput.current?.click()}
        />
        <Slot
          label="Back cover"
          hint="One image"
          page={album?.back ?? null}
          busy={busy === "back"}
          onPick={() => backInput.current?.click()}
          onRemove={album?.back ? () => removePage(album.back!.id) : undefined}
        />
      </div>

      <input
        ref={coverInput}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => e.target.files?.length && upload("cover", e.target.files)}
      />
      <input
        ref={spreadInput}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => e.target.files?.length && upload("spread", e.target.files)}
      />
      <input
        ref={backInput}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => e.target.files?.length && upload("back", e.target.files)}
      />

      {progress ? (
        <p className="text-muted-foreground mt-3 text-xs">
          Uploading {progress.done} of {progress.total}…
        </p>
      ) : null}

      {/* spread strip */}
      {spreadCount > 0 ? (
        <div className="mt-5">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              Spreads in order
            </h3>
            <span className="text-muted-foreground text-xs">
              {formatBytes(album?.totalBytes ?? 0)} total
            </span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {album!.spreads.map((s, i) => (
              <div key={s.id} className="group relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={s.url}
                  alt={`Spread ${i + 1}`}
                  className="border-border h-16 rounded border object-cover"
                />
                <span className="bg-background/90 absolute bottom-0.5 left-0.5 rounded px-1 text-[10px] font-medium tabular-nums">
                  {i + 1}
                </span>
                <button
                  type="button"
                  aria-label={`Remove spread ${i + 1}`}
                  onClick={() => removePage(s.id)}
                  className="bg-destructive text-destructive-foreground absolute -right-1.5 -top-1.5 hidden size-5 place-items-center rounded-full group-hover:grid"
                >
                  <Trash2 className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {published ? (
        <p className="text-muted-foreground mt-4 text-xs">
          Guests see it at{" "}
          <a
            href={`${guestUrl}/album`}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            {guestUrl}/album
          </a>
        </p>
      ) : canPublish ? (
        <p className="text-muted-foreground mt-4 text-xs">
          Publish when you&apos;re ready — guests won&apos;t see the album until then.
        </p>
      ) : null}
    </section>
  );
}

function Slot({
  label,
  hint,
  page,
  count,
  busy,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  page: AlbumPageView | null;
  count?: number;
  busy: boolean;
  onPick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="border-border relative rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>

      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        className="bg-muted/40 hover:bg-muted mt-2 grid aspect-[3/1] w-full place-items-center overflow-hidden rounded-lg transition disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="text-muted-foreground size-4 animate-spin" />
        ) : page ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={page.url} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
            <Upload className="size-3.5" />
            Choose
          </span>
        )}
      </button>

      {count !== undefined && count > 1 ? (
        <span className="bg-primary text-primary-foreground absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold">
          +{count - 1} more
        </span>
      ) : null}
    </div>
  );
}
