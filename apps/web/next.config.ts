import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Note: typedRoutes is not yet supported by Turbopack in Next 15.1.
  // Re-enable once we drop --turbopack from `pnpm dev` or upgrade Next.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Local MinIO (Phase 2+)
      { protocol: "http", hostname: "localhost", port: "9000" },
      { protocol: "http", hostname: "127.0.0.1", port: "9000" },
      // Cloudflare R2 (Phase 6) - replace <account> with your real account hash
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.r2.dev" },
    ],
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
        ],
      },
    ];
  },
  transpilePackages: ["@photodost/db"],
};

export default config;
