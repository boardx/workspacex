"use client";

import * as React from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConflictPrompt } from "@/lib/mock/knowledge-graph";

/** ISO 时间 → 「9/20」。纯展示格式化，不引入日期库。 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * U-5：矛盾提醒卡（uc-18-6 D）——新说法与「你确认过」的一条冲突时，在当轮回答下方出现。
 * 三个出口：以新的为准 / 两条都留（各写一句适用条件）/ 忽略（不再提醒同一对）。
 * 一轮最多一张（页面层保证 E8）；卡片可折叠、不遮正文。
 *
 * ⚠ 纯前端 mock：选择只切本地状态，不落后端（真实走 resolveConflict）。
 */
export function ConflictPromptCard({ prompt }: { prompt: ConflictPrompt }) {
  const [resolved, setResolved] = React.useState<"keep_new" | "keep_both" | "ignore" | null>(null);
  const [showBoth, setShowBoth] = React.useState(false);
  const [newerCond, setNewerCond] = React.useState("");
  const [olderCond, setOlderCond] = React.useState("");

  if (resolved && !(resolved === "keep_both" && showBoth)) {
    const note =
      resolved === "keep_new" ? "已改成以新的为准" : resolved === "ignore" ? "好的，这处不再提醒" : "两条都留下了";
    return (
      <p className="mt-2 flex items-center gap-1.5 text-10 text-muted-foreground" data-testid="kg-conflict-resolved">
        <Check aria-hidden className="h-3 w-3 text-success" />
        {note}
      </p>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-warning bg-warning-tint p-3" data-testid="kg-conflict-card">
      <p className="flex items-start gap-1.5 text-11 text-warning-tint-foreground">
        <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          这和你 {shortDate(prompt.olderClaim.saidAt)} 说的「{prompt.olderClaim.statement}」不一致。现在你说的是「{prompt.newerClaim.statement}」。
        </span>
      </p>

      {showBoth ? (
        <div className="flex flex-col gap-1.5" data-testid="kg-conflict-both-conditions">
          <label className="flex flex-col gap-0.5 text-10 text-muted-foreground">
            新的这条，什么情况下适用？
            <Input
              value={newerCond}
              onChange={(e) => setNewerCond(e.target.value)}
              placeholder="例如：迁移演练通过后"
              data-testid="kg-conflict-cond-newer"
              className="text-11"
            />
          </label>
          <label className="flex flex-col gap-0.5 text-10 text-muted-foreground">
            原来那条，什么情况下适用？
            <Input
              value={olderCond}
              onChange={(e) => setOlderCond(e.target.value)}
              placeholder="例如：演练未通过则保持原计划"
              data-testid="kg-conflict-cond-older"
              className="text-11"
            />
          </label>
          <Button size="xs" className="self-start" data-testid="kg-conflict-both-save" onClick={() => setShowBoth(false)}>
            保存
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="xs" variant="secondary" data-testid="kg-conflict-keep-new" onClick={() => setResolved("keep_new")}>
            以新的为准
          </Button>
          <Button
            size="xs"
            variant="outline"
            data-testid="kg-conflict-keep-both"
            onClick={() => {
              setResolved("keep_both");
              setShowBoth(true);
            }}
          >
            两条都留
          </Button>
          <Button size="xs" variant="ghost" data-testid="kg-conflict-ignore" onClick={() => setResolved("ignore")}>
            忽略
          </Button>
        </div>
      )}
    </div>
  );
}
