import { env } from "./env.js";

export interface MlFace {
  bbox: [number, number, number, number];
  embedding: number[];
  det_score: number;
  quality: number;
}

export interface MlEmbedResponse {
  model_version: string;
  faces: MlFace[];
  took_ms: number;
  image_bytes: number;
}

export async function embedImage(
  bytes: Uint8Array,
  filename = "image.jpg",
  mime = "image/jpeg",
): Promise<MlEmbedResponse> {
  const form = new FormData();
  // Node 22's global FormData accepts a Blob; build one from the bytes.
  // `new Uint8Array(bytes)` ensures a fresh view (avoids SharedArrayBuffer
  // edge cases on some runtimes).
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mime }), filename);

  const res = await fetch(`${env.ML_SERVICE_URL.replace(/\/$/, "")}/embed`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ML /embed failed: HTTP ${res.status} ${detail}`);
  }
  return (await res.json()) as MlEmbedResponse;
}
