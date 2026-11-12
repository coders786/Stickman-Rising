import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  reactStrictMode: false,
  allowedDevOrigins: ['*.e2b.app'],
  // Arena previews are long-lived URLs. Never let an intermediary preserve
  // an old HTML/RSC module map across builds; hashed static assets remain
  // immutable under Next's own /_next/static policy.
  async headers() {
    return [{
      source: '/((?!_next/static).*)',
      headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0, must-revalidate' }],
    }]
  },
};

export default nextConfig;
