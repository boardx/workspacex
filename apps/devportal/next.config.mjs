/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages（next-on-pages）：无 Node 图像优化服务
  images: { unoptimized: true },
  // 工作区 TS 源码包（Access 共享校验器，D7）需由 Next 转译
  transpilePackages: ["@repo/coord-access"],
};
export default nextConfig;
