/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  eslint: { dirs: ["app", "components", "lib"] },
  // 生产门控校验用独立的 dist 目录：否则 `next dev` 与 `next build` 争抢 .next，
  // 会出现 "Cannot find module ./vendor-chunks/..." 这类假故障。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    const fullstackApiOrigin = process.env.FULLSTACK_E2E_API_ORIGIN;
    const apiOrigin = fullstackApiOrigin ?? process.env.CHAT_READ_E2E_API_ORIGIN;
    if (!apiOrigin) return [];
    const brokenFilesRoute = process.env.FULLSTACK_E2E_BREAK_CONTROLLER === "artifacts";
    const prefix = fullstackApiOrigin ? "/__fullstack_api" : "";

    // Browser E2E gates must traverse the real API; the test-only same-origin proxy
    // 跨端口 CORS 配置扩张成产品运行时改动。正式 `/chat` 页面本身不被改写。
    return [
      { source: `${prefix}/auth/:path*`, destination: `${apiOrigin}/auth/:path*` },
      { source: `${prefix}/identity/:path*`, destination: `${apiOrigin}/identity/:path*` },
      { source: `${prefix}/chat/:path*`, destination: `${apiOrigin}/chat/:path*` },
      { source: `${prefix}/projects`, destination: `${apiOrigin}/projects` },
      { source: `${prefix}/projects/:projectId/artifacts`, destination: brokenFilesRoute
        ? `${apiOrigin}/__broken/projects/:projectId/artifacts`
        : `${apiOrigin}/projects/:projectId/artifacts` },
      { source: `${prefix}/projects/:path*`, destination: `${apiOrigin}/projects/:path*` },
      { source: `${prefix}/artifacts/:path*`, destination: `${apiOrigin}/artifacts/:path*` },
      { source: `${prefix}/artifact-versions/:path*`, destination: `${apiOrigin}/artifact-versions/:path*` },
      { source: `${prefix}/artifact-aliases/:path*`, destination: `${apiOrigin}/artifact-aliases/:path*` },
      { source: `${prefix}/export-jobs/:path*`, destination: `${apiOrigin}/export-jobs/:path*` },
    ];
  },
};
