# PhotoDost ML — face detection + embedding (InsightFace buffalo_l).
#
# Build from the REPO ROOT, not this directory:
#   docker build -f apps/ml/Dockerfile -t photodost-ml .
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    INSIGHTFACE_HOME=/root/.insightface

WORKDIR /app

# Runtime deps for OpenCV (libGL + glib) + curl for healthcheck.
# Build deps (g++, gcc, etc.) are needed because `insightface` 0.7.3 has
# Cython extensions that compile from source on aarch64. We strip them after
# pip install completes to keep the final image lean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libgl1 \
        libglib2.0-0 \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Paths are relative to the REPO ROOT, not apps/ml — the build context is the
# whole repo, matching apps/web and apps/worker (both of which need the
# workspace lockfile and so cannot use a narrower context).
COPY apps/ml/requirements.txt ./
RUN pip install -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# Pre-download the InsightFace model pack so the first user request doesn't
# pay the ~290MB cold start. This step takes a few minutes on first build but
# is fully cached on subsequent builds.
RUN python -c "from insightface.app import FaceAnalysis; \
    app = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'], \
        allowed_modules=['detection','recognition']); \
    app.prepare(ctx_id=-1, det_size=(640,640)); \
    print('Model pack baked into image')"

COPY apps/ml/app ./app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

# Bind dual-stack (`::`) by default, not 0.0.0.0. Railway's private network is
# IPv6-only, so an IPv4-only listener is simply unreachable at
# <service>.railway.internal — and since face matching degrades gracefully to
# "show all photos", that failure is silent rather than loud. On Linux, `::`
# accepts IPv4 connections too, so this is also correct locally.
# Shell form so ML_HOST / ML_PORT are honoured (settings.py already defines them).
CMD ["sh", "-c", "uvicorn app.main:app --host ${ML_HOST:-::} --port ${ML_PORT:-8000}"]
