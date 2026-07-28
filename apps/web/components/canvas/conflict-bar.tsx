"use client";
import * as React from "react";
import { GitCompareArrows, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOCK_CONFLICT, type ConflictSide } from "@/lib/mock/projects";

/**
 * 结构性冲突条（UC-7.3 R7 · D-09）——原型「确认缺失」的一屏，本次补画。
 *
 * 关键：**说清两侧各改了什么**。左右两列分别列文档侧 / 画布侧的结构性改动，
 * 出口三选一：并排比较 / 保留文档 / 保留画布——**无论选哪个，另一侧都存为一个版本**（不丢弃）。
 * 顶部常驻横条（非 toast、非 modal），未裁决不消失；裁决前禁止新的结构性写入。
 */
export function ConflictBar({ onResolve }: { onResolve: () => void }) {
  const [outcome, setOutcome] = React.useState<null | "compare" | "keep-doc" | "keep-canvas">(null);

  return (
    <div
      data-testid="canvas-conflict-bar"
      role="alert"
      className="flex flex-col gap-3 border-b border-warning/40 bg-warning/5 px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-0.5">
          <p className="text-12 font-semibold">文档与画布出现结构性冲突，需要你裁决</p>
          <p className="text-11 text-muted-foreground">
            便签级改动已按最后写入生效（LWW）；下面是<strong className="font-medium text-background-foreground">两侧同时改了结构</strong>的部分，不会自动合并。
            裁决前本画布暂停新的结构性写入。
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SideColumn side={MOCK_CONFLICT.doc} testid="canvas-conflict-side-doc" />
        <SideColumn side={MOCK_CONFLICT.canvas} testid="canvas-conflict-side-canvas" />
      </div>

      {outcome ? (
        <div
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
          data-testid="canvas-conflict-result"
        >
          <p className="text-11 text-muted-foreground">
            {outcome === "compare" && "已打开并排差异视图，选定一侧后另一侧仍会存为版本。"}
            {outcome === "keep-doc" && "已采纳文档侧结构。画布侧改动已存为一个可读取的版本，未丢弃。"}
            {outcome === "keep-canvas" && "已采纳画布侧结构。文档侧改动已存为一个可读取的版本，未丢弃。"}
          </p>
          {outcome !== "compare" && (
            <Button variant="ghost" size="sm" onClick={onResolve} data-testid="canvas-conflict-dismiss">
              知道了
            </Button>
          )}
          {outcome === "compare" && (
            <Button variant="ghost" size="sm" onClick={() => setOutcome(null)}>
              返回
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setOutcome("compare")} data-testid="canvas-conflict-compare">
            <GitCompareArrows aria-hidden className="h-3.5 w-3.5" />
            并排比较
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOutcome("keep-doc")} data-testid="canvas-conflict-keep-doc">
            保留文档
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setOutcome("keep-canvas")} data-testid="canvas-conflict-keep-canvas">
            保留画布
          </Button>
          <span className="ml-1 text-11 text-muted-foreground">三选一 · 另一侧都会存为版本</span>
        </div>
      )}
    </div>
  );
}

function SideColumn({ side, testid }: { side: ConflictSide; testid: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2.5" data-testid={testid}>
      <div className="flex items-center justify-between">
        <span className="text-11 font-semibold">{side.origin}侧</span>
        <span className="text-10 text-muted-foreground">{side.by} · {side.at}</span>
      </div>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-11 text-muted-foreground">
        {side.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
