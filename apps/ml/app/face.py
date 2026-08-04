"""InsightFace wrapper.

We keep the heavy `FaceAnalysis` instance as a module-global so the ONNX
sessions are loaded once at process start (uvicorn worker boot), not per
request. Loading buffalo_l on CPU takes ~3-8s; embedding a single image is
~150-500ms depending on size and face count.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from threading import Lock
from typing import Optional

import numpy as np
from insightface.app import FaceAnalysis
from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

from .settings import get_settings

# Registers a Pillow opener for HEIC/HEIF, so phone uploads (iPhone default)
# decode the same way as JPEG/PNG.
register_heif_opener()

logger = logging.getLogger(__name__)

_face_app: Optional[FaceAnalysis] = None
_lock = Lock()


@dataclass(frozen=True)
class DetectedFace:
    bbox: tuple[float, float, float, float]
    embedding: list[float]
    det_score: float
    quality: float


def _build_face_app() -> FaceAnalysis:
    settings = get_settings()
    pack = settings.insightface_model_pack
    logger.info("Loading InsightFace model pack: %s", pack)
    app = FaceAnalysis(
        name=pack,
        providers=["CPUExecutionProvider"],
        allowed_modules=["detection", "recognition"],
    )
    # ctx_id=-1 forces CPU. det_size is the square the detector resizes to;
    # 640 is a solid CPU sweet spot.
    app.prepare(ctx_id=-1, det_size=(640, 640))
    logger.info("InsightFace ready (pack=%s, det_size=640)", pack)
    return app


def get_face_app() -> FaceAnalysis:
    global _face_app
    if _face_app is None:
        with _lock:
            if _face_app is None:
                _face_app = _build_face_app()
    return _face_app


def is_loaded() -> bool:
    return _face_app is not None


def warmup() -> None:
    """Kick off model load. Called on application startup so the first user
    request doesn't pay the cold-start cost."""
    get_face_app()


def detect_faces(image_bytes: bytes) -> list[DetectedFace]:
    """Decode an image (any common format), run detection + embedding, and
    return zero-or-more faces. Caller decides what to do with multiple faces
    (e.g. for selfies pick the largest)."""
    app = get_face_app()

    pil = Image.open(io.BytesIO(image_bytes))
    # Honour EXIF orientation so phone selfies aren't rotated wrong.
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    arr = np.array(pil)
    # InsightFace wants BGR (legacy OpenCV convention).
    bgr = arr[:, :, ::-1].copy()

    faces = app.get(bgr)

    out: list[DetectedFace] = []
    for f in faces:
        emb = f.normed_embedding
        if emb is None:
            # Skip faces where recognition step couldn't produce an embedding
            # (e.g. extreme angles, blur). Detection-only faces aren't useful
            # for similarity search.
            continue
        bbox = tuple(float(x) for x in f.bbox.tolist())
        det_score = float(getattr(f, "det_score", 0.0))
        # No native quality score in InsightFace; approximate with face area
        # relative to det_size, capped at 1.0. Larger faces tend to embed
        # better.
        x1, y1, x2, y2 = bbox
        area = max(0.0, (x2 - x1)) * max(0.0, (y2 - y1))
        quality = float(min(1.0, area / (640.0 * 640.0) * 4.0))
        out.append(
            DetectedFace(
                bbox=bbox,
                embedding=[float(v) for v in emb.tolist()],
                det_score=det_score,
                quality=quality,
            )
        )
    return out


def pick_primary_face(faces: list[DetectedFace]) -> DetectedFace | None:
    """For selfies the user took: assume the biggest face is them."""
    if not faces:
        return None
    return max(
        faces,
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
    )
