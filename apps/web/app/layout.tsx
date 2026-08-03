import type { Metadata } from "next";
import { Noto_Sans_SC, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

/** 字体来自原型实测：正文 Noto Sans SC，数字/代码 JetBrains Mono */
const sans = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "600"], // 实测只用到这三档
  variable: "--font-sans",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkspaceX",
  description: "把一场项目从进场跑到产出——人与 AI 在同一个工作面上",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
