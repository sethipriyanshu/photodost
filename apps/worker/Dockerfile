# PhotoDost worker — face-embed pipeline, derivatives, storage reconciliation,
# billing sweep, retention purge.
#
# Build from the REPO ROOT, not this directory (it needs the workspace lockfile):
#   docker build -f apps/worker/Dockerfile -t photodost-worker .
#
# Debian slim, not Alpine: `sharp` ships prebuilt glibc binaries, and on musl it
# either falls back to a slow build-from-source or fails outright.

# ---------------------------------------------------------------------------
# Stage 1 — install everything and build
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /repo

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Manifests first so a source-only change doesn't re-resolve the whole tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/

# The worker's own deps plus its workspace dependencies. Dev deps are needed
# here — tsup does the build.
RUN pnpm install --frozen-lockfile --filter @photodost/worker...

COPY packages/db packages/db
COPY apps/worker apps/worker

# tsup bundles @photodost/db into dist/index.js, so the runtime stage needs no
# workspace linking at all — see apps/worker/tsup.config.ts for why that matters.
RUN pnpm --filter @photodost/worker build

# Fail loudly here rather than at container start if the bundle didn't emit.
RUN test -f apps/worker/dist/index.js || (echo "build produced no dist/index.js" && exit 1)

# ---------------------------------------------------------------------------
# Stage 2 — production runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/

# Production deps only. `@photodost/db` is already inlined in the bundle, but it
# stays a workspace link target so pnpm can resolve the manifest.
RUN pnpm install --frozen-lockfile --prod --filter @photodost/worker... \
  && pnpm store prune

COPY --from=builder /repo/apps/worker/dist ./apps/worker/dist

# Don't run as root.
USER node

WORKDIR /app/apps/worker

# No EXPOSE / healthcheck: the worker is a queue consumer with no HTTP surface.
# Liveness is "the process is up"; the platform restarts it if it exits.
CMD ["node", "dist/index.js"]
