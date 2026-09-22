import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/newsreader";
import fonts from "./fonts.module.css";
import "./globals.css";
import { NavShell } from "@/components/portal/nav-shell";

// 设计稿字体三件套（DevPortal-Platform.dc.html）：Inter 正文 / JetBrains Mono 数据 /
// Newsreader 斜体叙事。变量喂给 tailwind fontFamily（font-sans/mono/serif），
// 现在由自托管的 @fontsource-variable 提供，见 `fonts.module.css` 的头注。

export const metadata: Metadata = {
  title: "Developer Portal · BoardX",
  description: "BoardX agentic 开发的统一人类入口",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={fonts.variables}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <NavShell>{children}</NavShell>
      </body>
    </html>
  );
}
