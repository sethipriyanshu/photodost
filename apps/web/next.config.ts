import path from "node:path";
import type { NextConfig } from "next";

// `next build` always runs with cwd = apps/web, so the monorepo root is two up.
// Note: `import.meta.dirname` can't be used here — Next compiles this config to
// CommonJS and `import.meta` breaks that step with "exports is not defined".
const MONOREPO_ROOT = path.resolve(process.cwd(), "../..");

type RemotePatterns = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>;

/**
 * Whitelist the host photos are actually served from, derived from
 * `S3_PUBLIC_URL` at build time.
 *
 * This used to be a hardcoded list of R2 hostnames, which meant `next/image`
 * would refuse to load anything once storage moved to Backblaze — surfacing as a
 * runtime "hostname is not configured" error rather than a build failure. Reading
 * it from the same env var the app serves photos from means the two can't drift.
 */
function storageRemotePatterns(): RemotePatterns {
  const patterns: RemotePatterns = [
    // Local MinIO.
    { protocol: "http", hostname: "localhost", port: "9000" },
    { protocol: "http", hostname: "127.0.0.1", port: "9000" },
  ];

  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl) {
    try {
      const { protocol, hostname, port } = new URL(publicUrl);
      patterns.push({
        protocol: protocol.replace(":", "") as "http" | "https",
        hostname,
        ...(port ? { port } : {}),
      });
    } catch {
      // A malformed value shouldn't fail the build — the app surfaces it far more
      // clearly the first time it tries to render a photo.
      console.warn(`[next.config] S3_PUBLIC_URL is not a valid URL: ${publicUrl}`);
    }
  }

  return patterns;
}

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Emits .next/standalone — a minimal server plus only the node_modules actually
  // reached, so the runtime image needs neither the pnpm workspace nor dev deps.
  output: "standalone",
  // `@photodost/db` lives outside apps/web, so tracing has to start at the
  // monorepo root or the standalone bundle omits it.
  outputFileTracingRoot: MONOREPO_ROOT,
  // Note: typedRoutes is not yet supported by Turbopack in Next 15.1.
  // Re-enable once we drop --turbopack from `pnpm dev` or upgrade Next.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: storageRemotePatterns(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
          // Guests submit a selfie — biometric data — so downgrade attacks are
          // worth closing off. No `preload` and no `includeSubDomains` yet:
          // both are hard to walk back, and the production domain isn't final.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
  transpilePackages: ["@photodost/db"],
};

export default config;
