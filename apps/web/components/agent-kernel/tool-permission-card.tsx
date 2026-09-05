"use client";
import * as React from "react";
import { Check, X, ShieldAlert, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * issue #2774 —— 本组件从 `agent-kernel-units.tsx` 原样搬出（data-testid、四档决策的
 * 展示文案逐字不变），理由与 `interjection-composer.tsx`（issue #2756）一模一样：
 * `agent-kernel-units.tsx` 顶部整体 `import` 了 `@/lib/mock/agent-kernel`，而
 * `tests/session/chat-dead-mock-cluster.test.ts`（#462）机械禁止 `/chat` 路由闭包出现
 * 任何指向 `lib/mock/**` 的边——`/chat` 宿主（`chat-host-tool-permission.tsx`）要真实
 * 渲染这张卡，本文件因此不能带着 mock 导入。
 *
 * ## 与原型版本的唯一行为差异：`request` 从"无参数、内部读 mock"变成"必填 prop"
 *
 * 原型版本 `ToolPermissionCard()` 零参数，内部直接用 `MOCK_PERMISSION_REQUEST`。
 * 这里把它提升成 `request` prop——不给默认值：默认值只能是"再造一份 mock 文案"或
 * "从 lib/mock 导入"，前者是同一份文案两处声明（本仓已经因为这类重复漂移过五次，
 * 见 AGENTS.md），后者违反上一段的 mock 隔离。两个既有零参数调用点
 * （`agent-kernel-units.tsx` 内部签核原型的 switch、`app/preview/agent-kernel/page.tsx`）
 * 已相应改为显式传 `MOCK_PERMISSION_REQUEST`，行为逐字节未变。
 *
 * ## `onDecide`：真实决策才接进来的第二个可选 prop
 *
 * 缺省（`/preview` 签核原型 + F08 自己的回归测试）时行为与本次改动前逐字节相同——
 * 点击按钮立刻本地 `setDecision`，不发任何请求。`/chat` 宿主传入真实的
 * `decideToolPermission` 封装后：
 * - 点击先禁用四个按钮、不立刻展示"已允许/已拒绝"（那是在请求成功之前就假装决定
 *   生效——`copilotkit-v2-approval-dialog.tsx` 那份文件的 DA-19g/#1996/#2075 系列教训
 *   反复写过这条纪律，这里延续，不是重新发明）；
 * - 请求成功后才展示对应结果说明（此时 `data-testid=saved` 出现，卡片本身仍然挂载——
 *   实际收起由宿主观察 run 状态离开 `awaiting_tool_permission` 后自然完成，见
 *   `chat-host-tool-permission.tsx`）；
 * - 请求失败：展示 `perm-error`，保留原始 `request` 展示（拒绝/失败都不清空上下文，
 *   同旧弹窗"拒绝后仍展示原始命令"的既有纪律），按钮重新可点，允许重试。
 */

export interface ToolPermissionCardRequest {
  readonly tool: string;
  /** 契约 `ToolPermissionRequest.risk` 是 `z.literal("L2")`——本卡只服务 L2，不是四档risk。 */
  readonly risk: "L2";
  /** agent 想做什么。 */
  readonly intent: string;
  /** 为什么。 */
  readonly rationale: string;
  /** 完整命令/入参内容（R6 后置条件：不是截断摘要）。 */
  readonly command: string;
  /** 影响范围一句话说明。 */
  readonly affects: string;
}

/** 本组件内部展示态用的四档；契约枚举用 "forever"，这里 "always" 只是文案层命名
 *  （同 F08 测试文件头注："本组件 data-testid 用 perm-always 承载 forever，不是新枚举"）。 */
export type ToolPermissionCardDecision = "once" | "run" | "always" | "deny";

/** `onDecide` 收到的是契约本身的枚举值——宿主不需要再做一次 "always"→"forever" 映射。 */
export type ToolPermissionDecisionKind = "once" | "run" | "forever" | "deny";

function toContractDecision(d: ToolPermissionCardDecision): ToolPermissionDecisionKind {
  return d === "always" ? "forever" : d;
}

export interface ToolPermissionCardProps {
  readonly request: ToolPermissionCardRequest;
  /** 缺省 = 纯本地展示（签核原型 / F08 回归测试的既有行为）。 */
  readonly onDecide?: (decision: ToolPermissionDecisionKind) => void | Promise<void>;
}

export function ToolPermissionCard({ request: req, onDecide }: ToolPermissionCardProps) {
  const [decision, setDecision] = React.useState<null | ToolPermissionCardDecision>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(() => () => { mounted.current = false; }, []);

  const decide = (next: ToolPermissionCardDecision): void => {
    if (pending) return;
    if (onDecide === undefined) {
      // 没有真实决策通道（签核原型 / 既有回归测试）——与本次改动前逐字节相同的
      // 纯本地展示，不发任何请求。
      setDecision(next);
      return;
    }
    setError(null);
    setPending(true);
    void Promise.resolve(onDecide(toContractDecision(next)))
      .then(() => {
        if (!mounted.current) return;
        // 只有请求真的成功才展示结果说明——不在网络往返完成之前假装决定生效。
        setDecision(next);
      })
      .catch((e: unknown) => {
        if (!mounted.current) return;
        setError(e instanceof Error ? e.message : "提交失败，请重试");
      })
      .finally(() => {
        if (mounted.current) setPending(false);
      });
  };

  return (
    <Card data-testid="tool-permission-card" className="max-w-lg border-warning/40 shadow-lg">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
          <CardTitle className="text-14">agent 请求执行一个高风险操作</CardTitle>
          <Badge tone="warning" data-testid="risk-l2" title="不可逆或外发，执行前需你确认">
            {req.risk} · 高风险
          </Badge>
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
          <span>影响范围：{req.affects}</span>
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

        {error && (
          <p role="alert" data-testid="perm-error" className="flex items-start gap-1.5 text-12 text-destructive">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:justify-end sm:flex-wrap">
          <Button variant="outline" data-testid="perm-once" disabled={pending} onClick={() => decide("once")}>
            {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Check aria-hidden className="h-4 w-4" />}
            仅本次允许
          </Button>
          <Button variant="outline" data-testid="perm-run" disabled={pending} onClick={() => decide("run")}>
            本 run 内都允许
          </Button>
          <Button variant="outline" data-testid="perm-always" disabled={pending} onClick={() => decide("always")}>
            以后都允许
          </Button>
          <Button variant="destructive" data-testid="perm-deny" disabled={pending} onClick={() => decide("deny")}>
            <X aria-hidden className="h-4 w-4" /> 拒绝
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
