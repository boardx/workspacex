"use client";
import * as React from "react";
import { FileAudio, ListChecks, Lightbulb, Package, FolderOpen, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RIGHT_TABS, reviewCount } from "@/lib/mock/rec";

const TAB_ICON: Record<string, LucideIcon> = {
  transcript: FileAudio,
  execution: ListChecks,
  insight: Lightbulb,
  artifact: Package,
  material: FolderOpen,
};

/**
 * 对话右栏五标签外壳（UC-5.1 R8 信息架构）：转录 / 执行 / 洞察 / 产物 / 材料。
 * ⚠ 第五个标签叫「材料」不是「来源」（DECISIONS-FINAL 已定），testid 用 `material`。
 * 除「转录」外四个都带计数徽标，计数为 0 也显示真实空态、不隐藏标签。
 */
export function RightRailNav() {
  const [active, setActive] = React.useState("transcript");
  return (
    <div className="flex h-full flex-col" data-testid="rec-right-rail">
      <div className="flex border-b border-border" role="tablist" aria-label="对话右栏五标签">
        {RIGHT_TABS.map((t) => {
          const Icon = TAB_ICON[t.id]!;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              data-testid={`rec-tab-${t.id}`}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 border-b-2 px-1 py-2 transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "border-primary text-background-foreground" : "border-transparent text-muted-foreground hover:text-background-foreground",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              <span className="flex items-center gap-1 text-10 font-medium">
                {t.label}
                {t.count !== null && (
                  <Badge tone={isActive ? "primary" : "neutral"} data-testid={`rec-tab-count-${t.id}`}>{t.count}</Badge>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {active === "transcript" ? (
          <div className="flex flex-col gap-2" data-testid="rec-tab-panel-transcript">
            <p className="text-11 font-medium">本场转录状态</p>
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2.5 text-11">
              <Row label="状态条计数" value={<Badge tone="warning">逐字稿校对 {reviewCount()}</Badge>} />
              <Row label="正在识别" value="最新一句定稿前不可引述" />
              <Row label="自动跟随" value="随最新一句滚动（可关）" />
              <Row label="常驻时间码" value="每句前绝对时间码，点击跳回音频" />
            </div>
            <p className="text-9 text-muted-foreground">
              转录标签内四个常驻控件在中栏逐字稿区呈现（搜索逐字稿 / 自动跟随 / 正在识别 / 常驻时间码）。
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-8 text-center"
            data-testid={`rec-tab-panel-${active}`}
          >
            <p className="text-11 text-muted-foreground">
              「{RIGHT_TABS.find((t) => t.id === active)?.label}」标签属其他能力域（06-itv / 07-canvas / 10-report）。
            </p>
            <p className="text-9 text-muted-foreground">此处只作五标签外壳占位，计数来自各域，rec 只负责「转录」。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
