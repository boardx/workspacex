"use client";
import * as React from "react";
import { Check, X, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ToolRiskLevel } from "@/lib/agent-kernel-risk";
import { RiskBadge } from "./risk-badge";

/**
 * issue #2767 —— 本组件从 `agent-kernel-units.tsx` 原样搬出（`data-testid`/文案/交互
 * 逐字不变），理由与 `interjection-composer.tsx` 头注同一条：`/chat` 宿主
 * （`chat-host-tool-permission.tsx`）要真实渲染 F08 签核的这张卡片，而
 * `agent-kernel-units.tsx` 顶部整体 `import` 了 `@/lib/mock/agent-kernel`（其余签核
 * 原型单元的 mock 数据）——`tests/session/chat-dead-mock-cluster.test.ts`（#462）
 * 机械禁止 `/chat` 路由闭包里出现任何指向 `lib/mock/**` 的边。
 *
 * 与 `InterjectionComposer` 唯一的不同：那个组件本来就不依赖任何 mock 常量，原样
 * 搬家即可；这个组件此前依赖 `agent-kernel-units.tsx` 的内部 helper `RiskBadge`
 * （其 `RISK_LABEL` 来自 mock 文件）与缺省参数 `MOCK_PERMISSION_REQUEST`——两者都
 * 不能带过来：`RiskBadge` 改从 `./risk-badge`（同一次改动搬出，见该文件头注）导入，
 * `request` 在本文件里是**必填** prop（不提供 mock 缺省）。`agent-kernel-units.tsx`
 * 保留一层薄包装补上 mock 缺省，供 `/preview/agent-kernel` 签核页与既有单测
 * `<ToolPermissionCard />` 不传参数就能看到内容的既定行为不变。
 */

/** issue #2767 —— `ToolPermissionCard` 受控化所需的请求形状。字段与
 *  `lib/mock/agent-kernel.ts` 的 `MOCK_PERMISSION_REQUEST` 逐字一致，供
 *  `/chat` 宿主（`components/chat/chat-host-tool-permission.tsx`）从真实
 *  `call_skill` 的 `{skill_stable_name, task}` 参数派生出同一形状传入。 */
export interface ToolPermissionCardRequest {
  readonly risk: ToolRiskLevel;
  readonly intent: string;
  readonly rationale: string;
  readonly command: string;
  readonly affects: string;
}

/** 四选一决策的字面量——data-testid 用 `perm-always` 承载 `forever`
 *  语义（文案层命名，不是新枚举），契约 `ToolPermissionDecisionKind`
 *  才是这四档在网络上真正传输的名字（once/run/forever/deny）。 */
export type ToolPermissionCardDecision = "once" | "run" | "always" | "deny";

export function ToolPermissionCard({
  request,
  decided,
  onDecide,
}: {
  readonly request: ToolPermissionCardRequest;
  /** issue #2767 —— 受控态：宿主已经拿到真实裁决结果时传入，卡片据此显示收尾
   *  文案，不再自己管理内部 state。缺省（`undefined`）时组件退回内部 state
   *  自管理（既有 mock/单测行为）。 */
  readonly decided?: ToolPermissionCardDecision | null;
  /** issue #2767 —— 用户点击某个决策按钮时的回调，供宿主把它翻译成真实的
   *  `respond(...)` 调用。缺省时按钮只更新组件内部展示态（既有行为）。 */
  readonly onDecide?: (decision: ToolPermissionCardDecision) => void;
}) {
  const req = request;
  const [localDecision, setLocalDecision] = React.useState<ToolPermissionCardDecision | null>(null);
  const decision = decided !== undefined ? decided : localDecision;
  const handleDecide = (next: ToolPermissionCardDecision): void => {
    if (onDecide) onDecide(next);
    else setLocalDecision(next);
  };

  return (
    <Card data-testid="tool-permission-card" className="max-w-lg border-warning/40 shadow-lg">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
          <CardTitle className="text-14">agent 请求执行一个高风险操作</CardTitle>
          <RiskBadge risk={req.risk} />
        </div>
        <CardDescription className="text-12">
          这类操作不可逆或会外发，未经你同意不会执行。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">想做什么</span>
          <p data-testid="perm-intent" className="text-13 text-background-foreground">{req.intent}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">为什么</span>
          <p data-testid="perm-rationale" className="text-13 text-background-foreground">{req.rationale}</p>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">具体命令（完整，未截断）</span>
          <pre data-testid="perm-command" className="overflow-x-auto rounded-control bg-muted p-2 text-11">
            <code className="font-mono">{req.command}</code>
          </pre>
        </div>
        <div className="flex items-start gap-1.5 rounded-control bg-muted p-2 text-11 text-muted-foreground">
          <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {/* issue #2767 -- 补一个独立 testid：`chat-task-workbench-approval.spec.ts`
              TW-P0-6② 记录过"审批弹窗没有披露影响面"这个差距，这行内容本来就有，只是
              此前没有可寻址的锚点。 */}
          <span data-testid="perm-affects">影响范围：{req.affects}</span>
        </div>

        {decision && (
          <p
            role="status"
            data-testid="saved"
            className="text-12 text-success transition-opacity duration-slow"
          >
            {decision === "once" && "已允许本次执行，agent 继续。"}
            {decision === "run" && "本次 run 内同类操作将不再打断你。"}
            {decision === "always" && "已记为长期允许，本组织同类操作以后不再询问（可在下次弹出时改选拒绝以撤销）。"}
            {decision === "deny" && "已拒绝。agent 会据此调整后续计划，而不是直接失败。"}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end sm:flex-wrap">
          <Button variant="outline" data-testid="perm-once" onClick={() => handleDecide("once")}>
            <Check aria-hidden className="h-4 w-4" /> 仅本次允许
          </Button>
          <Button variant="outline" data-testid="perm-run" onClick={() => handleDecide("run")}>
            本 run 内都允许
          </Button>
          <Button variant="outline" data-testid="perm-always" onClick={() => handleDecide("always")}>
            以后都允许
          </Button>
          <Button variant="destructive" data-testid="perm-deny" onClick={() => handleDecide("deny")}>
            <X aria-hidden className="h-4 w-4" /> 拒绝
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
