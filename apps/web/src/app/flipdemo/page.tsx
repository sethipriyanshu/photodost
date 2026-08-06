import { notFound } from "next/navigation";
import { Flipbook, type FlipbookPage } from "@/components/flipbook";

/**
 * Development-only preview for iterating on the flipbook's look, using generated
 * SVGs so it needs no uploads. Hidden in production — it would otherwise be a
 * public route on the live site — and removed once the real album route lands.
 */
export const dynamic = "force-dynamic";

function svg(body: string, w: number, h: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`,
  )}`;
}

function cover(): string {
  return svg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
       <stop offset="0" stop-color="#1b1b2e"/><stop offset="1" stop-color="#3b2f5e"/>
     </linearGradient></defs>
     <rect width="800" height="800" fill="url(#g)"/>
     <text x="400" y="380" font-family="Georgia,serif" font-size="54" fill="#e8e4f5"
       text-anchor="middle" letter-spacing="6">AARAV</text>
     <text x="400" y="440" font-family="Georgia,serif" font-size="26" fill="#a89ecb"
       text-anchor="middle" letter-spacing="10">&amp;  MEERA</text>
     <rect x="330" y="470" width="140" height="1" fill="#7d72a8"/>
     <text x="400" y="510" font-family="Georgia,serif" font-size="16" fill="#8d84b3"
       text-anchor="middle" letter-spacing="4">NOVEMBER 2026</text>`,
    800,
    800,
  );
}

function back(): string {
  return svg(
    `<rect width="800" height="800" fill="#1b1b2e"/>
     <text x="400" y="410" font-family="Georgia,serif" font-size="20" fill="#6b6390"
       text-anchor="middle" letter-spacing="6">PHOTODOST</text>`,
    800,
    800,
  );
}

/** A wide spread: two visually distinct halves so the fold is obvious. */
function spread(n: number, a: string, b: string): string {
  return svg(
    `<rect width="1600" height="800" fill="#faf8f5"/>
     <rect x="40" y="60" width="680" height="680" fill="${a}"/>
     <rect x="880" y="60" width="680" height="400" fill="${b}"/>
     <rect x="880" y="500" width="330" height="240" fill="${b}" opacity="0.75"/>
     <rect x="1230" y="500" width="330" height="240" fill="${b}" opacity="0.5"/>
     <text x="380" y="770" font-family="Georgia,serif" font-size="18" fill="#8a8378"
       text-anchor="middle">spread ${n} · left</text>
     <text x="1220" y="770" font-family="Georgia,serif" font-size="18" fill="#8a8378"
       text-anchor="middle">spread ${n} · right</text>`,
    1600,
    800,
  );
}

const PALETTE: [string, string][] = [
  ["#c9b8a8", "#8a9a8b"],
  ["#a8b5c9", "#c9a8a8"],
  ["#b5a8c9", "#c9c3a8"],
  ["#98a8a0", "#c4b0a0"],
  ["#c0a8b5", "#a0b0c4"],
];

const pages: FlipbookPage[] = [
  { kind: "cover", url: cover() },
  ...PALETTE.map((p, i) => ({ kind: "spread" as const, url: spread(i + 1, p[0], p[1]) })),
  { kind: "back", url: back() },
];

export default function FlipDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="min-h-dvh bg-neutral-950 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-center text-lg font-semibold text-neutral-100">
          Aarav &amp; Meera
        </h1>
        <p className="mb-8 text-center text-xs text-neutral-400">Wedding album · 5 spreads</p>
        <Flipbook pages={pages} />
      </div>
    </div>
  );
}
