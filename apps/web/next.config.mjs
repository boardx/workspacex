/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  eslint: { dirs: ["app", "components", "lib"] },
  // 生产门控校验用独立的 dist 目录：否则 `next dev` 与 `next build` 争抢 .next，
  // 会出现 "Cannot find module ./vendor-chunks/..." 这类假故障。
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
