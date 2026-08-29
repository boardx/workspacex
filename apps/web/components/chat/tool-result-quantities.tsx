"use client";
import * as React from "react";
import { Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatToolResultQuantities, type ToolResultSummary } from "@/lib/tool-result-summary";

/**
 * Phase 14 · 需求 2 —— 工具调用记录旁的量化信息展示行（如「读取 41,208 行 · 8.4 MB」）。
 *
 * 两个落点共用同一个渲染（`agent-tool-chain.tsx` 折叠面板的 per-step 卡片、
 * `copilotkit-v2-tool-renderers.tsx` 的 per-tool 卡片），保证两处量化信息视觉一致。
 *
 * ## 优雅回退（需求 2 硬要求）
 * `summary` 缺失或三字段全空时 `formatToolResultQuantities` 返回 `[]`，本组件直接
 * `return null`——什么都不渲染，交由调用方原有的纯文字结果行兜底。**绝不**因为没有摘要
 * 就报错、留白、或印一个「0 行」的假数字。
 */
export function ToolResultQuantities({
  summary,
  className,
  "data-testid": testId,
}: {
  summary: ToolResultSummary | null | undefined;
  className?: string;
  "data-testid"?: string;
}): React.JSX.Element | null {
  const chips = formatToolResultQuantities(summary);
  if (chips.length === 0) return null;
  return (
    <div
      className={"mt-1 flex flex-wrap items-center gap-1 " + (className ?? "")}
      data-testid={testId ?? "tool-result-quantities"}
    >
      <Sigma aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
      {chips.map((chip, i) => (
        <Badge key={i} tone="primary" data-testid={`tool-result-quantity-${i}`}>
          {chip}
        </Badge>
      ))}
    </div>
  );
}
