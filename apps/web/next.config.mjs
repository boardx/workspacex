/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  eslint: { dirs: ["app", "components", "lib"] },
  // 生产门控校验用独立的 dist 目录：否则 `next dev` 与 `next build` 争抢 .next，
  // 会出现 "Cannot find module ./vendor-chunks/..." 这类假故障。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async rewrites() {
    const chatReadApiOrigin = process.env.CHAT_READ_E2E_API_ORIGIN;
    if (!chatReadApiOrigin) return [];

    // #405 的浏览器验收必须穿过真实 API；测试环境使用同源代理，避免把
    // 跨端口 CORS 配置扩张成产品运行时改动。正式 `/chat` 页面本身不被改写。
    return [
      { source: "/auth/:path*", destination: `${chatReadApiOrigin}/auth/:path*` },
      { source: "/identity/:path*", destination: `${chatReadApiOrigin}/identity/:path*` },
      { source: "/chat/projects/:path*", destination: `${chatReadApiOrigin}/chat/projects/:path*` },
      { source: "/chat/threads/:path*", destination: `${chatReadApiOrigin}/chat/threads/:path*` },
    ];
  },
};
