"""Photo Dost ML service: face detection + embedding."""

from __future__ import annotations

import hmac
import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from . import face
from .settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)
settings = get_settings()

# Hard cap on uploaded image size to protect the service. 25 MB matches the
# limit we enforce on the web side.
MAX_IMAGE_BYTES = 25 * 1024 * 1024


# -----------------------------------------------------------------------------
# Authentication
#
# The embed endpoints are the entire cost centre of this service, so they are
# gated on a shared secret that the web app and worker send. `/healthz` stays
# open because platform health probes can't carry credentials.
#
# The unset-token case is deliberately asymmetric: a warning locally (so
# `pnpm infra:up` needs no configuration) and a hard startup failure in
# production. Booting an unauthenticated inference service onto the internet
# should not be something a missing env var can do quietly.
# -----------------------------------------------------------------------------
def _auth_configured() -> bool:
    return bool(settings.ml_service_token)


def require_token(authorization: str | None = Header(default=None)) -> None:
    expected = settings.ml_service_token
    if not expected:
        # Startup already refused this in production; in development, allow.
        return

    scheme, _, presented = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not presented:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Constant-time compare so a wrong token can't be recovered by timing.
    if not hmac.compare_digest(presented, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001 - FastAPI signature
    if not _auth_configured():
        if settings.ml_env == "production":
            raise RuntimeError(
                "ML_SERVICE_TOKEN is required when ML_ENV=production. "
                "Refusing to start an unauthenticated inference service. "
                "Generate one with: openssl rand -hex 32"
            )
        logger.warning(
            "ML_SERVICE_TOKEN is not set — /embed endpoints are UNAUTHENTICATED. "
            "Fine locally; never deploy this way."
        )

    logger.info("warming up InsightFace…")
    t0 = time.perf_counter()
    try:
        face.warmup()
        logger.info("InsightFace warm in %.2fs", time.perf_counter() - t0)
    except Exception:
        # Don't crash the process on warmup failure; first /embed call will
        # surface the real error.
        logger.exception("InsightFace warmup failed (continuing)")
    yield


app = FastAPI(
    title="Photo Dost ML",
    version="1.0.0",
    description="Face detection + embedding for the Photo Dost guest selfie experience.",
    lifespan=lifespan,
)


# -----------------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------------
class Health(BaseModel):
    status: str = "ok"
    service: str = "photodost-ml"
    model_pack: str = Field(default_factory=lambda: settings.insightface_model_pack)
    model_loaded: bool = False


@app.get("/healthz", response_model=Health, status_code=status.HTTP_200_OK)
async def healthz() -> Health:
    return Health(model_loaded=face.is_loaded())


# -----------------------------------------------------------------------------
# /embed - returns every face we can lock onto with its embedding.
# -----------------------------------------------------------------------------
class FaceOut(BaseModel):
    bbox: tuple[float, float, float, float]
    embedding: list[float]
    det_score: float
    quality: float


class EmbedResponse(BaseModel):
    model_version: str
    faces: list[FaceOut]
    took_ms: int
    image_bytes: int


@app.post("/embed", response_model=EmbedResponse, dependencies=[Depends(require_token)])
async def embed(image: UploadFile = File(...)) -> EmbedResponse:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Image exceeds {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit",
        )

    t0 = time.perf_counter()
    try:
        faces = face.detect_faces(raw)
    except Exception as exc:  # noqa: BLE001 - surface decode/inference errors as 422
        logger.exception("face detection failed")
        raise HTTPException(status_code=422, detail=f"Image processing failed: {exc}") from exc

    took_ms = int((time.perf_counter() - t0) * 1000)
    return EmbedResponse(
        model_version=settings.insightface_model_pack,
        faces=[
            FaceOut(
                bbox=f.bbox,
                embedding=f.embedding,
                det_score=f.det_score,
                quality=f.quality,
            )
            for f in faces
        ],
        took_ms=took_ms,
        image_bytes=len(raw),
    )


# -----------------------------------------------------------------------------
# /embed/primary - convenience for selfies: returns the single largest face.
# -----------------------------------------------------------------------------
class PrimaryEmbedResponse(BaseModel):
    model_version: str
    face: FaceOut | None
    face_count: int
    took_ms: int


@app.post("/embed/primary", response_model=PrimaryEmbedResponse, dependencies=[Depends(require_token)])
async def embed_primary(image: UploadFile = File(...)) -> PrimaryEmbedResponse:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty image upload")
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large")

    t0 = time.perf_counter()
    try:
        faces = face.detect_faces(raw)
    except Exception as exc:  # noqa: BLE001
        logger.exception("face detection failed")
        raise HTTPException(status_code=422, detail=f"Image processing failed: {exc}") from exc

    primary = face.pick_primary_face(faces)
    took_ms = int((time.perf_counter() - t0) * 1000)
    return PrimaryEmbedResponse(
        model_version=settings.insightface_model_pack,
        face=(
            FaceOut(
                bbox=primary.bbox,
                embedding=primary.embedding,
                det_score=primary.det_score,
                quality=primary.quality,
            )
            if primary
            else None
        ),
        face_count=len(faces),
        took_ms=took_ms,
    )
