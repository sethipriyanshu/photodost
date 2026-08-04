"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Download,
  ImageIcon,
  Loader2,
  Pause,
  Play,
  Plus,
  QrCode,
  RotateCw,
  Settings2,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AssetRow {
  id: string;
  url: string;
  /** Thumbnail URL for the grid; falls back to `url` until the worker derives it. */
  thumbUrl: string;
  mime: string;
  bytes: number;
  createdAt: string;
}

interface Props {
  slug: string;
  shareToken: string;
  guestUrl: string;
  qrDataUrl: string;
  initialMatchThreshold: number;
  initialRevoked: boolean;
  initialCoverAssetId: string | null;
  initialAssets: AssetRow[];
}

interface UploadingFile {
  id: string;
  file: File;
  progress: number;
  status: "uploading" | "registering" | "done" | "error";
  errorMessage?: string;
}

const ACCEPT = "image/jpeg,image/jpg,image/png";
const ACCEPTED_MIMES = new Set(["image/jpeg", "image/jpg", "image/png"]);

export function EventDashboard({
  slug,
  shareToken,
  guestUrl,
  qrDataUrl,
  initialMatchThreshold,
  initialRevoked,
  initialCoverAssetId,
  initialAssets,
}: Props) {
  const router = useRouter();
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [revoked, setRevoked] = useState(initialRevoked);
  const [shareBusy, setShareBusy] = useState(false);
  const [coverAssetId, setCoverAssetId] = useState<string | null>(initialCoverAssetId);

  const patchEvent = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/events/${slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Update failed (${res.status})`);
      return res.json();
    },
    [slug],
  );

  const handleToggleShare = useCallback(async () => {
    setShareBusy(true);
    try {
      await patchEvent({ shareRevoked: !revoked });
      setRevoked((v) => !v);
    } catch (err) {
      console.error("[event] toggle share failed", err);
    } finally {
      setShareBusy(false);
    }
  }, [patchEvent, revoked]);

  const handleRotate = useCallback(async () => {
    if (!window.confirm("Rotate the guest link? The current QR and link will stop working."))
      return;
    setShareBusy(true);
    try {
      await patchEvent({ rotateShareToken: true });
      // Re-render the server page so the new token, link and QR flow back in.
      router.refresh();
    } catch (err) {
      console.error("[event] rotate token failed", err);
    } finally {
      setShareBusy(false);
    }
  }, [patchEvent, router]);

  const handleSetCover = useCallback(
    async (assetId: string | null) => {
      const prev = coverAssetId;
      setCoverAssetId(assetId); // optimistic
      try {
        await patchEvent({ coverAssetId: assetId });
      } catch (err) {
        console.error("[event] set cover failed", err);
        setCoverAssetId(prev); // revert
      }
    },
    [coverAssetId, patchEvent],
  );

  // Prepend newly-known assets to the grid, skipping any already shown.
  const addAssets = useCallback((incoming: AssetRow[]) => {
    if (incoming.length === 0) return;
    setAssets((prev) => {
      const have = new Set(prev.map((p) => p.id));
      const fresh = incoming.filter((a) => !have.has(a.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, []);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const all = Array.from(files);
      const rejected = all.filter((f) => !ACCEPTED_MIMES.has(f.type.toLowerCase()));
      const fileArr = all.filter((f) => ACCEPTED_MIMES.has(f.type.toLowerCase()));

      if (rejected.length > 0) {
        setUploads((prev) => [
          ...rejected.map<UploadingFile>((file) => ({
            id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
            file,
            progress: 0,
            status: "error",
            errorMessage: `Only JPG or PNG are supported (got ${file.type || "unknown type"})`,
          })),
          ...prev,
        ]);
      }

      if (fileArr.length === 0) return;

      const tracker: UploadingFile[] = fileArr.map((file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        progress: 0,
        status: "uploading",
      }));
      setUploads((prev) => [...tracker, ...prev]);

      try {
        // Hash each file (best-effort) so the server can skip content already
        // in this event. Undefined when Web Crypto isn't available.
        const hashes = await Promise.all(fileArr.map(sha256Hex));

        const presignRes = await fetch(`/api/events/${slug}/upload-url`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            files: fileArr.map((f, i) => ({
              filename: f.name,
              mime: f.type,
              size: f.size,
              sha256: hashes[i],
            })),
          }),
        });

        if (!presignRes.ok) {
          throw new Error(`Failed to presign uploads (${presignRes.status})`);
        }
        const { uploads: presigned } = (await presignRes.json()) as {
          uploads: Array<
            | {
                filename: string;
                assetId: string;
                key: string;
                uploadUrl: string;
                mime: string;
                size: number;
                sha256?: string;
              }
            | { filename: string; duplicate: true; asset: AssetRow }
            | { filename: string; error: string }
          >;
        };

        const completed: Array<{
          assetId: string;
          key: string;
          mime: string;
          size: number;
          filename: string;
          sha256?: string;
        }> = [];
        const dupAssets: AssetRow[] = [];

        await Promise.all(
          presigned.map(async (item, idx) => {
            const tracking = tracker[idx]!;
            if ("error" in item) {
              setUploads((prev) =>
                prev.map((u) =>
                  u.id === tracking.id ? { ...u, status: "error", errorMessage: item.error } : u,
                ),
              );
              return;
            }

            // Already in this event — no upload needed.
            if ("duplicate" in item) {
              dupAssets.push(item.asset);
              setUploads((prev) =>
                prev.map((u) =>
                  u.id === tracking.id ? { ...u, progress: 100, status: "done" } : u,
                ),
              );
              return;
            }

            try {
              await putWithProgress({
                url: item.uploadUrl,
                file: tracking.file,
                onProgress: (pct) =>
                  setUploads((prev) =>
                    prev.map((u) => (u.id === tracking.id ? { ...u, progress: pct } : u)),
                  ),
              });

              setUploads((prev) =>
                prev.map((u) =>
                  u.id === tracking.id ? { ...u, progress: 100, status: "registering" } : u,
                ),
              );

              completed.push({
                assetId: item.assetId,
                key: item.key,
                mime: item.mime,
                size: item.size,
                filename: item.filename,
                sha256: item.sha256,
              });
            } catch (err) {
              console.error("[upload] PUT failed", err);
              setUploads((prev) =>
                prev.map((u) =>
                  u.id === tracking.id
                    ? {
                        ...u,
                        status: "error",
                        errorMessage: err instanceof Error ? err.message : "Upload failed",
                      }
                    : u,
                ),
              );
            }
          }),
        );

        // Merge any duplicates straight into the grid (they already exist).
        addAssets(dupAssets);

        if (completed.length > 0) {
          const registerRes = await fetch(`/api/events/${slug}/assets`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ assets: completed }),
          });
          if (!registerRes.ok) {
            throw new Error("Failed to register uploaded photos");
          }
          const { assets: registered } = (await registerRes.json()) as {
            assets: AssetRow[];
          };

          addAssets(registered);
          setUploads((prev) =>
            prev.map((u) => (u.status === "registering" ? { ...u, status: "done" } : u)),
          );
        }

        // Auto-clear finished (done) entries after a beat so the list stays tidy.
        window.setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.status !== "done"));
        }, 1500);
      } catch (err) {
        console.error("[upload] failed", err);
        setUploads((prev) =>
          prev.map((u) =>
            u.status === "uploading" || u.status === "registering"
              ? {
                  ...u,
                  status: "error",
                  errorMessage: err instanceof Error ? err.message : "Upload failed",
                }
              : u,
          ),
        );
      }
    },
    [slug, addAssets],
  );

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-6">
        <UploadZone onFiles={handleFiles} isDragging={isDragging} setIsDragging={setIsDragging} />
        {uploads.length > 0 ? <UploadList uploads={uploads} /> : null}

        <section>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Photos
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                {assets.length}
              </span>
            </h2>
          </div>

          {assets.length === 0 ? (
            <div className="border-border bg-card/30 mt-3 rounded-2xl border border-dashed px-6 py-12 text-center">
              <div className="bg-primary/10 text-primary mx-auto grid size-12 place-items-center rounded-2xl">
                <ImageIcon className="size-5" />
              </div>
              <p className="text-muted-foreground mt-3 text-sm">
                No photos yet. Drag images into the zone above, or use the button.
              </p>
            </div>
          ) : (
            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {assets.map((a) => (
                <PhotoTile
                  key={a.id}
                  asset={a}
                  slug={slug}
                  isCover={a.id === coverAssetId}
                  onSetCover={handleSetCover}
                  onDeleted={(id) => {
                    setAssets((prev) => prev.filter((p) => p.id !== id));
                    if (id === coverAssetId) setCoverAssetId(null);
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <ShareCard guestUrl={guestUrl} qrDataUrl={qrDataUrl} revoked={revoked} />
        <SettingsCard
          revoked={revoked}
          shareBusy={shareBusy}
          onToggleShare={handleToggleShare}
          onRotate={handleRotate}
          initialThreshold={initialMatchThreshold}
          onSaveThreshold={(t) => patchEvent({ matchThreshold: t })}
        />
        <div className="text-muted-foreground text-xs leading-relaxed">
          Share token: <span className="font-mono">{shareToken}</span>
        </div>
      </aside>
    </div>
  );
}

function PhotoTile({
  asset,
  slug,
  isCover,
  onSetCover,
  onDeleted,
}: {
  asset: AssetRow;
  slug: string;
  isCover: boolean;
  onSetCover: (id: string | null) => void;
  onDeleted: (id: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    const ok = window.confirm("Delete this photo? This cannot be undone.");
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${slug}/assets/${asset.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Delete failed (${res.status})`);
      }
      onDeleted(asset.id);
    } catch (err) {
      console.error("[delete] failed", err);
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  };

  return (
    <li className="bg-muted group relative aspect-square overflow-hidden rounded-xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={asset.thumbUrl}
        alt=""
        loading="lazy"
        className={cn(
          "size-full object-cover transition-transform duration-200",
          !deleting && "group-hover:scale-105",
          deleting && "opacity-40",
        )}
      />

      <div className="absolute right-1.5 top-1.5 flex gap-1">
        <button
          type="button"
          onClick={() => onSetCover(isCover ? null : asset.id)}
          aria-label={isCover ? "Remove as cover" : "Set as cover"}
          title={isCover ? "Cover photo — click to unset" : "Set as cover"}
          className={cn(
            "grid size-7 place-items-center rounded-full opacity-80 backdrop-blur-sm transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            isCover
              ? "bg-primary text-primary-foreground opacity-100"
              : "bg-black/55 text-white hover:bg-black/75",
          )}
        >
          <Star className={cn("size-3.5", isCover && "fill-current")} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          aria-label="Delete photo"
          title="Delete photo"
          className="grid size-7 place-items-center rounded-full bg-black/55 text-white opacity-80 backdrop-blur-sm transition hover:bg-black/75 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Trash2 className="size-3.5" />
          )}
        </button>
      </div>

      {isCover ? (
        <span className="bg-primary text-primary-foreground absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
          Cover
        </span>
      ) : null}

      {error ? (
        <div className="absolute inset-x-1 bottom-1 truncate rounded-md bg-red-500/90 px-2 py-1 text-[11px] font-medium text-white">
          {error}
        </div>
      ) : null}
    </li>
  );
}

function UploadZone({
  onFiles,
  isDragging,
  setIsDragging,
}: {
  onFiles: (files: FileList | File[]) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
          onFiles(e.dataTransfer.files);
        }
      }}
      className={cn(
        "border-border bg-card relative overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center transition-all duration-300",
        isDragging && "border-primary bg-primary/5 scale-[1.01]",
      )}
    >
      {isDragging ? <div className="aurora" aria-hidden /> : null}
      <div className="bg-primary/10 text-primary mx-auto grid size-12 place-items-center rounded-2xl">
        <Upload
          className={cn("size-5 transition-transform", isDragging && "-translate-y-0.5 scale-110")}
        />
      </div>
      <h3 className="mt-4 text-base font-bold tracking-tight">Drop photos here</h3>
      <p className="text-muted-foreground mt-1 text-sm">JPG or PNG. Up to 25 MB each.</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
      <Button
        type="button"
        className="mt-5 rounded-full px-6"
        onClick={() => inputRef.current?.click()}
      >
        <Plus className="size-4" />
        Choose photos
      </Button>
    </div>
  );
}

function UploadList({ uploads }: { uploads: UploadingFile[] }) {
  return (
    <ul className="border-border bg-card flex flex-col gap-2 rounded-2xl border p-3">
      {uploads.map((u) => (
        <li key={u.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="bg-muted size-9 shrink-0 overflow-hidden rounded-md">
            {u.file.type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={URL.createObjectURL(u.file)}
                alt=""
                className="size-full object-cover"
                onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{u.file.name}</div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
              {u.status === "uploading" ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Uploading {u.progress}%
                </>
              ) : u.status === "registering" ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Saving…
                </>
              ) : u.status === "done" ? (
                <>
                  <Check className="text-primary size-3" />
                  Uploaded
                </>
              ) : (
                <>
                  <X className="text-destructive size-3" />
                  {u.errorMessage ?? "Failed"}
                </>
              )}
            </div>
            {u.status === "uploading" ? (
              <div className="bg-muted relative mt-1 h-1 overflow-hidden rounded-full">
                <div
                  className="bg-primary absolute inset-y-0 left-0 rounded-full transition-[width]"
                  style={{ width: `${u.progress}%` }}
                />
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ShareCard({
  guestUrl,
  qrDataUrl,
  revoked,
}: {
  guestUrl: string;
  qrDataUrl: string;
  revoked: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <div className="border-border bg-card rounded-3xl border p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-xl">
          <QrCode className="size-4" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">Guest QR</h3>
          <p className="text-muted-foreground text-xs">Scan to open the gallery</p>
        </div>
        {revoked ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Paused
          </span>
        ) : null}
      </div>

      <div className="from-primary/20 mt-4 rounded-2xl bg-gradient-to-br via-fuchsia-500/10 to-cyan-400/10 p-[3px]">
        <div className="grid place-items-center rounded-[0.85rem] bg-white p-4">
          <Image
            src={qrDataUrl}
            alt="Guest QR code"
            width={220}
            height={220}
            unoptimized
            className="size-44 sm:size-48"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="bg-muted/60 truncate rounded-lg px-3 py-2 font-mono text-xs">
          {guestUrl}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              startTransition(async () => {
                try {
                  await navigator.clipboard.writeText(guestUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  // Clipboard might be blocked; fall back silently.
                }
              });
            }}
          >
            {copied ? (
              <>
                <Check className="size-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                Copy link
              </>
            )}
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1">
            <a href={qrDataUrl} download="event-qr.png">
              <Download className="size-3.5" />
              Save QR
            </a>
          </Button>
        </div>
        <Button asChild size="sm">
          <Link href={guestUrl} target="_blank">
            Open guest view
          </Link>
        </Button>
      </div>
    </div>
  );
}

function SettingsCard({
  revoked,
  shareBusy,
  onToggleShare,
  onRotate,
  initialThreshold,
  onSaveThreshold,
}: {
  revoked: boolean;
  shareBusy: boolean;
  onToggleShare: () => void;
  onRotate: () => void;
  initialThreshold: number;
  onSaveThreshold: (t: number) => Promise<unknown>;
}) {
  const [threshold, setThreshold] = useState(initialThreshold);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const dirty = Math.abs(threshold - initialThreshold) > 0.001;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSaveThreshold(Number(threshold.toFixed(2)));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error("[event] save threshold failed", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-border bg-card rounded-3xl border p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className="bg-primary/10 text-primary grid size-9 place-items-center rounded-xl">
          <Settings2 className="size-4" />
        </div>
        <h3 className="text-sm font-semibold">Event settings</h3>
      </div>

      {/* Match sensitivity */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">Match sensitivity</span>
          <span className="text-muted-foreground tabular-nums">{threshold.toFixed(2)}</span>
        </div>
        <input
          type="range"
          min={0.3}
          max={0.7}
          step={0.01}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
          className="accent-primary mt-2 w-full"
        />
        <div className="text-muted-foreground mt-1 flex justify-between text-[10px]">
          <span>Stricter</span>
          <span>Looser</span>
        </div>
        <p className="text-muted-foreground mt-1.5 text-[11px] leading-relaxed">
          Lower finds only sure matches; higher shows more but may include others.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          onClick={save}
          disabled={!dirty || saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : saved ? (
            <Check className="size-3.5" />
          ) : null}
          {saved ? "Saved" : "Save sensitivity"}
        </Button>
      </div>

      {/* Share controls */}
      <div className="border-border mt-4 border-t pt-4">
        <span className="text-xs font-medium">Guest link</span>
        <div className="mt-2 flex flex-col gap-2">
          <Button size="sm" variant="outline" onClick={onToggleShare} disabled={shareBusy}>
            {revoked ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {revoked ? "Resume sharing" : "Pause sharing"}
          </Button>
          <Button size="sm" variant="outline" onClick={onRotate} disabled={shareBusy}>
            <RotateCw className="size-3.5" />
            Rotate link
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
          Pausing hides the gallery from guests. Rotating issues a new QR and disables the old one.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small XHR helper so we can show real upload progress (fetch doesn't expose
// upload progress events yet). Used only for browser → S3 PUT.
// ---------------------------------------------------------------------------
/** SHA-256 hex of a file for dedupe. Returns undefined without Web Crypto (non-secure context). */
async function sha256Hex(file: File): Promise<string | undefined> {
  try {
    if (!globalThis.crypto?.subtle) return undefined;
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

function putWithProgress(opts: {
  url: string;
  file: File;
  onProgress: (pct: number) => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url);
    xhr.setRequestHeader("content-type", opts.file.type);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`PUT failed with ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.send(opts.file);
  });
}
