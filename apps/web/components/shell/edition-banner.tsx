"use client";

/**
 * 版次标识条 —— 本地版的**常驻、全断点**标识，加一个「这里做不到什么」的清单。
 *
 * ## 为什么再加一条，而不是改顶栏那句话
 *
 * 顶栏原有的本地提示（`top-bar.tsx` 的 `topbar-local-banner`）说的是**组织**的隔离承诺
 * （`personal-local` 组织，云端部署里同样存在），而且它是 `text-10` + `hidden lg:block`：
 * 在笔记本以下的宽度上根本不渲染。人类 2026-09-22 的原话是「整个界面需要有明显的变化」。
 * 这条说的是**版次**（这份程序装在哪），两件事正交（见 `@repo/contracts/deployment` 头注），
 * 所以是新增一条而不是改那一条——把两个事实塞进同一句话正是本仓的头号病。
 *
 * ## 不画成可关闭的提示
 *
 * 它不是通知，是**当前处境**：能力矩阵与故障纪律都因它而不同。可关掉的标识等于没有标识。
 */
import * as React from "react";
import { HardDrive, Info } from "lucide-react";
import { CAPABILITY_AVAILABILITY_LABEL } from "@repo/contracts/deployment";
import { DEPLOYMENT_EDITION_LABEL, useEdition, useMissingCapabilities } from "@/lib/edition";
import { cn } from "@/lib/utils";

export function EditionBanner({ className }: { className?: string }): React.ReactElement | null {
  const edition = useEdition();
  const missing = useMissingCapabilities();
  const [open, setOpen] = React.useState(false);
  // 在线版不挂任何标识：在线是默认处境，给默认处境加一条常驻横幅只是噪音。
  if (edition !== "local") return null;
  return (
    <div
      data-testid="edition-banner"
      data-edition={edition}
      className={cn(
        "flex shrink-0 flex-col border-b border-ai-tint-foreground/20 bg-ai-tint text-ai-tint-foreground",
        className,
      )}
    >
      <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <HardDrive aria-hidden className="h-3.5 w-3.5 shrink-0" />
        <span className="text-11 font-semibold" data-testid="edition-banner-label">
          {DEPLOYMENT_EDITION_LABEL[edition]}
        </span>
        <span className="text-11">模型与数据都在这台电脑上，请求不出网</span>
        <button
          type="button"
          data-testid="edition-banner-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex items-center gap-1 rounded-control px-1.5 py-0.5 text-11 font-medium underline-offset-2 transition-colors hover:bg-ai-tint-foreground/10 hover:underline"
        >
          <Info aria-hidden className="h-3 w-3" />
          与在线版有 {missing.length} 项能力不同
        </button>
      </div>
      {open && (
        <ul data-testid="edition-capability-gaps" className="border-t border-ai-tint-foreground/20 px-3 py-2">
          {missing.map((row) => (
            <li key={row.id} data-testid={`edition-capability-gap-${row.id}`} className="py-0.5 text-11">
              <span className="font-medium">{row.capability}</span>
              <span className="mx-1 opacity-70">·</span>
              <span data-testid={`edition-capability-state-${row.id}`}>
                本地版{CAPABILITY_AVAILABILITY_LABEL[row.local]}
              </span>
              {/* 原因逐字来自契约：界面不许自己编一句更好听的说法，也不许留空 */}
              <span className="ml-1 opacity-80">{row.why}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
