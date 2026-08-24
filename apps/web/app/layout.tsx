import type { Metadata } from "next";
import { Noto_Sans_SC, JetBrains_Mono, Bitter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

/**
 * 字体来自原型实测：正文 Noto Sans SC，数字/代码 JetBrains Mono。
 * F19（契约束 visual-identity-refresh）新增 700：字重层级要求标题类文案（区块标题、
 * 弹层标题）用真实 700，此前只加载到 600、Tailwind 的 `font-bold` 会退化成
 * 浏览器合成粗体（假粗），新增这一档让 `font-bold` 消费到真实字重文件。
 */
const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});
/**
 * F19 品牌锚点（契约束 visual-identity-refresh）：左侧导航栏顶部 wordmark 用衬线体，
 * 与正文 Noto Sans SC 拉开台阶，制造"这是一个品牌标记，不是又一行正文"的区分。
 * 只这一处消费，不做正文字体候选。
 */
const display = Bitter({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkspaceX",
  description: "把一场项目从进场跑到产出——人与 AI 在同一个工作面上",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 主题阻塞脚本：早于 hydration 执行，读 localStorage 定初始 `.dark`，避免刷新闪烁。 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} ${display.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
