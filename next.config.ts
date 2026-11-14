import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  allowedDevOrigins: ['*.e2b.app', '127.0.0.1', 'localhost'],
  // Arena previews are long-lived URLs. In `next dev` (Turbopack), chunk
  // filenames under /_next/static/chunks/ are hashed by module path rather
  // than file contents, so intermediaries and browsers must never serve stale
  // dev chunks across edits or server restarts.
  async headers() {
    return [{
      source: '/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, max-age=0, must-revalidate' }],
    }]
  },
};

export default nextConfig;
