import type { NextConfig } from "next";

/* WHERE THE COMPILER WRITES.
 * `next build` and `next dev` both own `.next/`, and this sandbox runs a dev
 * server for the live preview WHILE a build verifies the tree. The build wipes
 * the dev server's manifests out from under it: the page keeps answering 200
 * from memory, then every chunk under /_next/static 404s and the game is a black
 * screen. That is the "corrupted server" from earlier in this project — it was
 * never the server, it was two processes sharing one output directory.
 * So: verify with `npm run build:iso` (distDir `.next-build`) while dev is up,
 * and keep the plain `build` for CI, where no dev server is running. */
const nextConfig: NextConfig = {
  distDir: process.env.STICKMAN_DIST_DIR || ".next",
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
