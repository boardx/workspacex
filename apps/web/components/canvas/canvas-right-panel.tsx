"use client";
import * as React from "react";
import { MousePointer2, MapPin, Ban, Sparkles, Camera, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { MOCK_AI_ACTIVITY } from "@/lib/mock/projects";

/**
 * 画布右栏三区（原型四节 · D-08 / D-10）——**客户端组件**：AI 落笔开关与「回退」确认是交互。
 * ① 选中对象 ② 导出规则（含**坐标不写回**，显眼）③ AI 在这张画布上（默认直接落笔，可切建议模式）。
 */
export function CanvasRightPanel() {
  const [directWrite, setDirectWrite] = React.useState(MOCK_AI_ACTIVITY.defaultDirectWrite);
  const [rollbackConfirm, setRollbackConfirm] = React.useState(false);

  return (
    <div className="flex flex-col gap-4 p-3" data-testid="canvas-right-panel">
      {/* ① 选中对象 */}
      <section className="flex flex-col gap-2" data-testid="canvas-selected">
        <RightLabel icon={MousePointer2}>选中对象</RightLabel>
        <div className="rounded-md border border-border bg-card p-2.5">
          <p className="text-12 font-medium">节点：致命假设：EMC 可复制</p>
          <p className="mt-1 text-11 text-muted-foreground">连线数 1 · 标签可改</p>
          <p className="mt-2 text-10 text-muted-foreground">
            点选一个节点可改标签、看连线数。按住 shift 选两个再点「连线」。
          </p>
        </div>
      </section>

      {/* ② 导出规则 */}
      <section className="flex flex-col gap-2">
        <RightLabel icon={MapPin}>导出规则</RightLabel>
        <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-2.5" data-testid="canvas-rule-geometry">
          <p className="text-11 font-medium">便签按几何归区</p>
          <p className="text-11 text-muted-foreground">
            拖进哪个分区框，导出就归到那个 <code className="font-mono text-10">##</code> 段落；落框外的归最近的框。
          </p>
        </div>

        {/* 坐标不写回——显眼（否则实现者会以为可以存坐标）*/}
        <div
          className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2.5"
          data-testid="canvas-rule-nocoord"
        >
          <p className="flex items-center gap-1 text-11 font-semibold">
            <Ban aria-hidden className="h-3.5 w-3.5 text-warning" />
            坐标不写回 Markdown
          </p>
          <p className="text-11 text-muted-foreground">
            mermaid 语法里没有坐标位。写回只保留结构，重新渲染时由 mermaid 自动布局。
            「重开后位置变了」不是 bug。
          </p>
          <Button variant="outline" size="xs" className="mt-1 self-start" data-testid="canvas-save-layout">
            <Camera aria-hidden className="h-3 w-3" /> 另存布局快照
          </Button>
        </div>
      </section>

      {/* ③ AI 在这张画布上 */}
      <section className="flex flex-col gap-2">
        <RightLabel icon={Sparkles}>AI 在这张画布上</RightLabel>
        <div className="flex flex-col gap-2 rounded-md border border-ai/20 bg-ai-tint p-2.5" data-testid="canvas-ai-changes">
          <p className="text-11 text-ai-tint-foreground">
            <Badge tone="ai" className="mr-1">AVA</Badge>
            Ava 补了 {MOCK_AI_ACTIVITY.stickiesAdded} 张便签、改了 {MOCK_AI_ACTIVITY.edgeLabelsChanged} 条连线标签，都带 AVA 角标。
          </p>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" data-testid="canvas-ai-view">看改动</Button>
            {!rollbackConfirm ? (
              <Button variant="ghost" size="xs" onClick={() => setRollbackConfirm(true)} data-testid="canvas-ai-rollback">
                <Undo2 aria-hidden className="h-3 w-3" /> 回退
              </Button>
            ) : (
              <span className="flex items-center gap-1" data-testid="canvas-ai-rollback-confirm">
                <span className="text-10 text-muted-foreground">回退 AVA 全部改动？</span>
                <Button variant="destructive" size="xs" onClick={() => setRollbackConfirm(false)} data-testid="canvas-ai-rollback-submit">确认</Button>
                <Button variant="ghost" size="xs" onClick={() => setRollbackConfirm(false)} data-testid="canvas-ai-rollback-cancel">取消</Button>
              </span>
            )}
          </div>
        </div>

        {/* D-10：默认直接落笔，可切「提交建议待接受」*/}
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-2.5">
          <div className="flex flex-col">
            <label htmlFor="canvas-ai-mode" className="text-11 font-medium">AI 直接落笔</label>
            <span className="text-10 text-muted-foreground">
              {directWrite ? "默认：带角标、可一键回退" : "已切为「提交建议待接受」，需人确认才落到画布"}
            </span>
          </div>
          <Toggle
            id="canvas-ai-mode"
            checked={directWrite}
            onCheckedChange={setDirectWrite}
            label="AI 直接落笔"
            data-testid="canvas-ai-mode-toggle"
          />
        </div>
      </section>
    </div>
  );
}

function RightLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-11 font-semibold">
      <Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
      {children}
    </h3>
  );
}
