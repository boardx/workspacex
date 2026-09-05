"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { RISK_LABEL, type ToolRiskLevel } from "@/lib/agent-kernel-risk";

/**
 * issue #2767 —— 本组件从 `agent-kernel-units.tsx` 原样搬出（`data-testid`/颜色语义/
 * 文案逐字不变），理由与 `interjection-composer.tsx`/`tool-permission-card.tsx` 头注
 * 同一条：`tool-permission-card.tsx` 要在真实 `/chat` 里渲染同一个风险徽标，但
 * `agent-kernel-units.tsx` 顶部整体 `import` 了 `@/lib/mock/agent-kernel`
 * （`tests/session/chat-dead-mock-cluster.test.ts` #462 机械禁止 `/chat` 路由闭包
 * 出现任何指向 `lib/mock/**` 的边）。`agent-kernel-units.tsx` 改成从这里导入使用，
 * 不是保留一份重复定义。
 */
export function RiskBadge({ risk }: { readonly risk: ToolRiskLevel }) {
  const tone = risk === "L2" ? "warning" : risk === "L1" ? "primary" : "neutral";
  return (
    <Badge tone={tone} data-testid={`risk-${risk}`} title={RISK_LABEL[risk].hint}>
      {risk} · {RISK_LABEL[risk].text}
    </Badge>
  );
}
