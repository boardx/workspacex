"use client";
import * as React from "react";
import { ChevronLeft, Users, Bot, Eye } from "lucide-react";
import { StateShell, StatePreviewSwitcher } from "@/components/state/state-shell";
import type { UiState } from "@/lib/ui-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import type { ProjectRole } from "@/lib/identity";
import { CanvasToolbar, ZOOM_MIN, ZOOM_MAX, type CanvasTool } from "./canvas-toolbar";
import { CanvasStage } from "./canvas-stage";
import { ConflictBar } from "./conflict-bar";

/** 源码视图内容（D-08 数据链的「可查看可手改」）——静态 mock 文本 */
const SOURCE_MD = `# 谁在买储能 · 假设风暴 (hmw)

## 谁
- 工商业园区业主：自投自用
- 第三方投资商 EMC 模式

## 痛点
- 回本周期看不清，不敢投
- 并网审批流程各州不一

## 我们可以怎样
- 怎样把回本测算做进销售话术   <!-- AVA -->
- 怎样用标准化 EMC 合同降门槛   <!-- AVA -->

\`\`\`mermaid
flowchart LR
  n1["致命假设：EMC 可复制"] -->|需验证| n2["验证：3 个园区试点"]
\`\`\``;

const ZOOM_STEP = 0.1;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));

/**
 * 画布中栏主体（UC-7.3 R8 · 原型四节）——**客户端组件**：
 * 工具选中、画布/源码切换、缩放、冲突条裁决都是交互；服务端组件不能传函数 props。
 * 七态经 StateShell；冲突条作为「一种可展示的状态」由预览开关控制（原型确认缺失，本次补画）。
 */
export function CanvasMain({
  state, previewRole, initialConflict,
}: {
  state: UiState;
  previewRole: ProjectRole | null;
  initialConflict: boolean;
}) {
  const [tool, setTool] = React.useState<CanvasTool>("select");
  const [mode, setMode] = React.useState<"canvas" | "source">("canvas");
  const [conflict, setConflict] = React.useState(initialConflict);
  const [zoom, setZoom] = React.useState(1);
  const readOnly = previewRole === "observer";

  return (
    <div className="flex h-full flex-col" data-testid="canvas-main">
      {/* 面包屑 + 标题区（原型：从议程进）*/}
      <div className="flex flex-col gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2 text-11 text-muted-foreground">
          <ChevronLeft aria-hidden className="h-3.5 w-3.5" />
          <span>回到议程 · 议程环节 3</span>
          <span aria-hidden>｜</span>
          <span>画布来自 欧洲储能进入策略 · 假设风暴</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-14 font-semibold tracking-tight">第 2 组 · 采购比选旅程</h1>
            <Badge tone="neutral" className="font-mono">```mermaid · flowchart LR</Badge>
            <Badge tone="warning" data-testid="canvas-sync-status">待同步</Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              <Avatar initials="高" size="sm" tone="human" />
              <Avatar initials="郑" size="sm" tone="human" />
              <Avatar initials="AV" size="sm" tone="ai" />
            </div>
            <span className="flex items-center gap-1 text-11 text-muted-foreground">
              <Users aria-hidden className="h-3.5 w-3.5" /> 3
              <Bot aria-hidden className="ml-1 h-3.5 w-3.5" /> 1
            </span>
          </div>
        </div>
      </div>

      {/* 预览控制：状态切换 + 冲突条开关（冲突条是「一种状态」）*/}
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-3 py-1.5">
        <StatePreviewSwitcher current={state} />
        <Button
          variant={conflict ? "secondary" : "ghost"}
          size="xs"
          onClick={() => setConflict((v) => !v)}
          data-testid="canvas-conflict-toggle"
        >
          {conflict ? "隐藏冲突条" : "模拟结构性冲突"}
        </Button>
      </div>

      {readOnly && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5"
          data-testid="canvas-readonly-notice"
        >
          <Eye aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-11 text-muted-foreground">
            观察者视角：只读查看，工具条写操作已禁用。（视角切换仅为预览，真实权限在服务端。）
          </p>
        </div>
      )}

      <div className="min-h-0 flex-1 p-3">
        <StateShell
          state={state}
          skeletonRows={5}
          emptyHint="这张画布只有模板骨架，还没有便签。选 ＋便签 开始，或运行「语音转便签」。"
          errors={{ template: "画布绑定的模板版本已失效，请回到议程重新绑定" }}
          depFailure={{
            what: "实时通道不可用，已降级为轮询并标「非实时」；本地未提交的改动已保留，未伪装已同步",
            retry: () => window.location.reload(),
          }}
          denial={{ layer: "project", reason: "你不在这一组，别组画布对你是只读且不可见原始内容" }}
          successMessage="已保存为新版本，并写回 mermaid 源码 .md（坐标不写回）"
          className="h-full"
        >
          <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
            {conflict && <ConflictBar onResolve={() => setConflict(false)} />}
            <CanvasToolbar
              tool={tool}
              onToolChange={setTool}
              mode={mode}
              onModeChange={setMode}
              readOnly={readOnly}
              zoom={zoom}
              onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
              onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
              onZoomFit={() => setZoom(1)}
            />
            {mode === "canvas" ? (
              <CanvasStage readOnly={readOnly} tool={tool} zoom={zoom} />
            ) : (
              <SourceView />
            )}
          </div>
        </StateShell>
      </div>
    </div>
  );
}

function SourceView() {
  return (
    <div className="flex-1 overflow-auto bg-card p-3" data-testid="canvas-source-view">
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="outline" className="font-mono">Markdown ⇄ mermaid ⇄ 画布</Badge>
        <span className="text-10 text-muted-foreground">三段每段可查看可手改（D-08）；坐标不在这份文本里</span>
      </div>
      <pre className="overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-11 leading-relaxed text-card-foreground">
        {SOURCE_MD}
      </pre>
    </div>
  );
}
