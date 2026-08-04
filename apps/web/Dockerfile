# PhotoDost web — Next.js 15 app (dashboard, guest gallery, all HTTP APIs).
#
# Build from the REPO ROOT, not this directory (it needs the workspace lockfile):
#   docker build -f apps/web/Dockerfile -t photodost-web .
#
# Debian slim, not Alpine: `sharp` (Next's image optimizer) ships prebuilt glibc
# binaries and on musl either builds from source slowly or fails.

# ---------------------------------------------------------------------------
# Stage 1 — install + build
# ---------------------------------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /repo

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Manifests first so a source-only change doesn't re-resolve the whole tree.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile --filter @photodost/web...

COPY packages/db packages/db
COPY apps/web apps/web

# `next.config.ts` reads S3_PUBLIC_URL at BUILD time to whitelist the photo host
# for next/image. It must therefore be present as a build arg, not only at
# runtime, or images 404 with "hostname is not configured".
ARG S3_PUBLIC_URL
ENV S3_PUBLIC_URL=$S3_PUBLIC_URL

# Env only needed to satisfy module-load-time validation in lib/env.ts. Neither
# value is baked into the output — the build never connects to anything.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build"
ENV BETTER_AUTH_SECRET="build-time-placeholder-not-used-at-runtime"
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @photodost/web build

RUN test -f apps/web/.next/standalone/apps/web/server.js \
  || (echo "standalone build missing server.js — is output:'standalone' set?" && exit 1)

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Dual-stack, not 0.0.0.0 — platform proxies and private networking on Railway
# reach services over IPv6, and an IPv4-only listener is unreachable there. On
# Linux `::` accepts IPv4 too, so this stays correct locally.
ENV HOSTNAME=::

# Next's standalone output already contains the traced node_modules, so there is
# no pnpm install here at all.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /repo/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

# The healthcheck hits ?deep=0: deep checks would mark the container unhealthy
# during a transient Postgres blip and get it killed, when the app itself is fine.
# The platform's own probe should use the deep variant for routing decisions.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/healthz?deep=0').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
