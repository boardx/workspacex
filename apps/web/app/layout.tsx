import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-sc";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/bitter";
import fonts from "./fonts.module.css";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

// Keep the existing font families and real variable weights while packaging assets locally.
export const metadata: Metadata = {
  title: "WorkspaceX",
  description: "把一场项目从进场跑到产出——人与 AI 在同一个工作面上",
  /**
   * 品牌 favicon 修复（2026-09-04）：此前 favicon.ico / ms-icon-144x144.png 等资产
   * 只放在 apps/web/ 根目录（既不在 `public/` 下会被 Next.js 当静态资源伺服，也不在
   * `app/` 下走文件约定拾取），且 metadata 里完全没有 `icons` 声明——实际生效的是
   * 浏览器缓存的旧图标/默认图标，形状和颜色都和品牌 X 图形标对不上。
   * 现在资产已移到 `public/`（Next.js 会把 `public/` 下的文件按原路径伺服到站点根），
   * 这里显式声明 `icons` 指向它们，全部从官方位图（workspacex.png）裁切同一个 X
   * 图形标重新生成，颜色与形状与品牌一致。
   */
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/ms-icon-144x144.png", sizes: "144x144", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 主题阻塞脚本：早于 hydration 执行，读 localStorage 定初始 `.dark`，避免刷新闪烁。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${fonts.variables} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
