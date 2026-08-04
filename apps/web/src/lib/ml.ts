import "server-only";
import { env } from "./env";

export interface MlPrimaryFace {
  bbox: [number, number, number, number];
  embedding: number[];
  det_score: number;
  quality: number;
}

export interface MlPrimaryResponse {
  model_version: string;
  face: MlPrimaryFace | null;
  face_count: number;
  took_ms: number;
}

/**
 * Sends an image (already a Blob/File from the browser) to the ML service
 * and returns the single largest face. Designed for selfies.
 */
export async function embedPrimaryFace(image: Blob | File): Promise<MlPrimaryResponse> {
  const form = new FormData();
  form.append("image", image, image instanceof File ? image.name : "selfie.jpg");

  const url = `${env.ML_SERVICE_URL.replace(/\/$/, "")}/embed/primary`;
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ML /embed/primary failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as MlPrimaryResponse;
}
