"use client";
import { recordingDisplay, recordingTabKeys } from "./recording-project-display";
import { useI18n } from "@/lib/i18n/provider";
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
  const { t: recT } = useI18n();
  const [active, setActive] = React.useState("transcript");
  return (
    <div className="flex h-full flex-col" data-testid="rec-right-rail">
      <div className="flex border-b border-border" role="tablist" aria-label={recT("rec.project.conversation.side.panel.tabs")}>
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
                {recordingDisplay(recT, recordingTabKeys, t.id, t.label)}
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
            <p className="text-11 font-medium">{recT("rec.project.session.transcription.status")}</p>
            <div className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2.5 text-11">
              <Row label={recT("rec.project.status.count")} value={<Badge tone="warning">{recT("rec.project.transcript.review")} {reviewCount()}</Badge>} />
              <Row label={recT("rec.project.recognizing.135")} value={recT("rec.project.the.latest.sentence.cannot.be.quoted.until")} />
              <Row label={recT("rec.project.autofollow")} value={recT("rec.project.scroll.with.the.latest.sentence.optional")} />
              <Row label={recT("rec.project.persistent.timecodes")} value={recT("rec.project.each.sentence.has.a.timecode.select.it")} />
            </div>
            <p className="text-9 text-muted-foreground">

              {recT("rec.project.four.controls.appear.in.the.transcript.search")}
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-8 text-center"
            data-testid={`rec-tab-panel-${active}`}
          >
            <p className="text-11 text-muted-foreground">
              「{recordingDisplay(recT, recordingTabKeys, active, RIGHT_TABS.find((t) => t.id === active)?.label ?? active)}{recT("rec.project.belongs.to.another.feature.area.06itv")}
            </p>
            <p className="text-9 text-muted-foreground">{recT("rec.project.these.tabs.show.counts.from.their.feature")}</p>
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
