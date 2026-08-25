import type { NextConfig } from "next";

// CSP is set per-request in middleware.ts (nonce-based).
const SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "interest-cohort=()" },
];

const SECRET_HEADERS = [
  ...SECURITY_HEADERS,
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
  { key: "Pragma", value: "no-cache" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/s/:path*", headers: SECRET_HEADERS },
      { source: "/created/:path*", headers: SECRET_HEADERS },
      { source: "/api/:path*", headers: SECRET_HEADERS },
      // Browsers cap service-worker script caching at 24h; no-cache makes an
      // updated worker (and any change to its denylist) take effect on the
      // next visit instead of up to a day later.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate, max-age=0" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
