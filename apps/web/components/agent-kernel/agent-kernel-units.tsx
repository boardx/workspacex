"use client";
import * as React from "react";
import {
  Check, X, ChevronDown, ChevronRight, FileText, Play, Pause,
  ShieldAlert, History, RefreshCw, AlertTriangle, Loader2, Wifi, ShieldCheck,
  Trash2, GripVertical, CircleDot, Circle, CircleCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  MOCK_PLAN_TODOS, MOCK_PROGRESS_STEPS, MOCK_PERMISSION_REQUEST,
  MOCK_ARTIFACT, MOCK_ERROR, RISK_LABEL,
  type PlanTodo, type TodoRisk, type ProgressStep,
  type AgentKernelArtifactVersionPreview,
} from "@/lib/mock/agent-kernel";
import type { AgentKernelRunStatus } from "@/lib/agent-kernel-stream";
import type { InterjectFn } from "@/lib/agent-kernel-interject";
import { InterjectionComposer } from "./interjection-composer";

// 共享：风险徽标（L0/L1/L2）——颜色语义固定，L2 用 warning
function RiskBadge({ risk }: { risk: TodoRisk }) {
  const tone = risk === "L2" ? "warning" : risk === "L1" ? "primary" : "neutral";
  return (
    <Badge tone={tone} data-testid={`risk-${risk}`} title={RISK_LABEL[risk].hint}>
      {risk} · {RISK_LABEL[risk].text}
    </Badge>
  );
}

// ══ 01 计划确认卡片 ═════════════════════════════════════════════════
export function PlanConfirmationCard() {
  const [todos, setTodos] = React.useState<PlanTodo[]>(() => MOCK_PLAN_TODOS.map((t) => ({ ...t })));
  const [confirmed, setConfirmed] = React.useState(false);

  const removeTodo = (id: string) =>
    setTodos((prev) => prev.filter((t) => t.id !== id));
  const editTodo = (id: string, content: string) =>
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, content } : t)));

  // E2：删除了被别人依赖的前置步骤 → 给出提示而非静默
  const brokenDeps = todos.filter(
    (t) => t.dependsOn && !todos.some((o) => o.id === t.dependsOn),
  );

  if (confirmed) {
    return (
      <Card data-testid="plan-confirmed" className="max-w-xl">
        <CardContent className="flex items-center gap-2 py-4">
          <CircleCheck aria-hidden className="h-4 w-4 text-success" />
          <p data-testid="saved" className="text-13 text-background-foreground transition-opacity duration-slow">
            计划已确认，agent 开始执行（共 {todos.length} 步）
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="plan-confirmation-card" className="max-w-xl">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <CardTitle className="text-14">执行前请先过一下计划</CardTitle>
          <Badge tone="ai">待你确认</Badge>
        </div>
        <CardDescription className="text-12">
          agent 会按下面的步骤执行。你可以改写或删掉某一步，确认后才会真正动手。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ol className="flex flex-col gap-2">
          {todos.map((todo, i) => (
            <li
              key={todo.id}
              data-testid={`plan-todo-${todo.id}`}
              className="group flex items-start gap-2 rounded-card border border-border bg-background p-2 transition-colors duration-base hover:border-input"
            >
              <GripVertical aria-hidden className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="mt-1 w-4 shrink-0 text-center text-12 font-medium text-muted-foreground">{i + 1}</span>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={`todo-input-${todo.id}`} className="sr-only">步骤 {i + 1} 内容</Label>
                <Input
                  id={`todo-input-${todo.id}`}
                  data-testid={`plan-todo-input-${todo.id}`}
                  value={todo.content}
                  onChange={(e) => editTodo(todo.id, e.target.value)}
                  className="h-auto py-1 text-13"
                />
                <RiskBadge risk={todo.risk} />
              </div>
              <Button
                size="icon" variant="ghost"
                aria-label={`删除步骤 ${i + 1}`}
                data-testid={`plan-todo-delete-${todo.id}`}
                className="shrink-0 text-muted-foreground transition-colors duration-base hover:text-destructive"
                onClick={() => removeTodo(todo.id)}
              >
                <Trash2 aria-hidden className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>

        {todos.length === 0 && (
          <div data-testid="empty" className="flex flex-col items-center gap-2 rounded-card border border-dashed border-border py-8 text-center">
            <p className="text-12 text-muted-foreground">计划已被清空。取消任务，或恢复至少一步再确认。</p>
          </div>
        )}

        {brokenDeps.length > 0 && (
          <p role="alert" data-testid="err-plan" className="flex items-start gap-1.5 text-12 text-destructive">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            有步骤的前置已被删除（第 {brokenDeps.map((t) => todos.indexOf(t) + 1).join("、")} 步），
            执行到这里会失败。请补回前置步骤或一并删除。
          </p>
        )}

        <div className="mt-1 flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" data-testid="plan-cancel">取消任务</Button>
          <Button
            variant="primary" data-testid="plan-confirm"
            disabled={todos.length === 0 || brokenDeps.length > 0}
            onClick={() => setConfirmed(true)}
          >
            <Check aria-hidden className="h-4 w-4" /> 确认并执行
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ══ 02 执行进度流 ═══════════════════════════════════════════════════
function StepIcon({ status }: { status: ProgressStep["status"] }) {
  if (status === "done") return <CircleCheck aria-hidden className="h-4 w-4 text-success" />;
  if (status === "running") return <Loader2 aria-hidden className="h-4 w-4 animate-spin text-primary" />;
  if (status === "error") return <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />;
  return <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />;
}

function ProgressStepRow({ step }: { step: ProgressStep }) {
  const [open, setOpen] = React.useState(step.status === "running");
  const canExpand = Boolean(step.diff);
  return (
    <li
      data-testid={`progress-step-${step.id}`}
      className="rounded-card border border-border bg-background transition-colors duration-base hover:border-input"
    >
      <div className="flex items-start gap-2 p-2.5">
        <span className="mt-0.5"><StepIcon status={step.status} /></span>
        <div className="flex flex-1 flex-col gap-1">
          <p className="text-13 text-background-foreground">{step.planningNote}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="outline"><code className="font-mono text-10">{step.tool}</code></Badge>
            <RiskBadge risk={step.risk} />
            {typeof step.durationMs === "number" && (
              <span className="text-10 text-muted-foreground">{step.durationMs}ms</span>
            )}
            {step.status === "running" && <span className="text-10 text-primary">执行中…</span>}
            {step.status === "queued" && <span className="text-10 text-muted-foreground">排队中</span>}
          </div>
          {step.resultSummary && (
            <p className="text-11 text-muted-foreground">→ {step.resultSummary}</p>
          )}
        </div>
        {canExpand && (
          <Button
            size="sm" variant="ghost"
            data-testid={`progress-step-toggle-${step.id}`}
            aria-expanded={open}
            className="shrink-0"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
            diff
          </Button>
        )}
      </div>
      {canExpand && open && step.diff && (
        <div data-testid={`progress-step-diff-${step.id}`} className="border-t border-border px-2.5 py-2">
          <div className="mb-1 flex items-center gap-2 text-11 text-muted-foreground">
            <FileText aria-hidden className="h-3.5 w-3.5" />
            <code className="font-mono text-11">{step.diff.path}</code>
            <span className="text-success">+{step.diff.added}</span>
            <span className="text-destructive">-{step.diff.removed}</span>
          </div>
          <pre className="overflow-x-auto rounded-control bg-muted p-2 text-11 leading-relaxed">
            <code className="font-mono">
              {step.diff.body.split("\n").map((line, i) => (
                <span
                  key={i}
                  className={cn(
                    "block",
                    line.startsWith("+") && "text-success",
                    line.startsWith("-") && "text-destructive",
                    line.startsWith("@@") && "text-muted-foreground",
                  )}
                >
                  {line || " "}
                </span>
              ))}
            </code>
          </pre>
        </div>
      )}
    </li>
  );
}

export function ProgressStream() {
  const steps = MOCK_PROGRESS_STEPS;
  const doneCount = steps.filter((s) => s.status === "done").length;
  return (
    <Card data-testid="progress-stream" className="max-w-xl">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <CardTitle className="text-14">执行进度</CardTitle>
          <Badge tone="primary">running</Badge>
          <span className="ml-auto text-11 text-muted-foreground">{doneCount}/{steps.length} 步已完成</span>
        </div>
        <Progress value={doneCount} max={steps.length} label={`执行进度 ${doneCount}/${steps.length}`} />
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2">
          {steps.map((step) => (
            <ProgressStepRow key={step.id} step={step} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ══ 03 工具权限确认弹层 ═════════════════════════════════════════════

/** issue #2767 —— `ToolPermissionCard` 受控化所需的请求形状。字段与
 *  `lib/mock/agent-kernel.ts` 的 `MOCK_PERMISSION_REQUEST` 逐字一致，供
 *  `/chat` 宿主（`components/chat/chat-host-tool-permission.tsx`）从真实
 *  `call_skill` 的 `{skill_stable_name, task}` 参数派生出同一形状传入。 */
export interface ToolPermissionCardRequest {
  readonly risk: TodoRisk;
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
  /** 缺省回退到 mock（`/preview/agent-kernel` 签核阶段与既有单测的既定行为，
   *  一字不改）。 */
  readonly request?: ToolPermissionCardRequest;
  /** issue #2767 —— 受控态：宿主已经拿到真实裁决结果时传入，卡片据此显示收尾
   *  文案，不再自己管理内部 state。缺省（`undefined`）时组件退回内部 state
   *  自管理（既有 mock/单测行为）。 */
  readonly decided?: ToolPermissionCardDecision | null;
  /** issue #2767 —— 用户点击某个决策按钮时的回调，供宿主把它翻译成真实的
   *  `respond(...)` 调用。缺省时按钮只更新组件内部展示态（既有行为）。 */
  readonly onDecide?: (decision: ToolPermissionCardDecision) => void;
} = {}) {
  const req = request ?? MOCK_PERMISSION_REQUEST;
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

// ══ 04 中途插话入口 ═════════════════════════════════════════════════
// issue #2756 起搬到 `interjection-composer.tsx`（该文件头注说明原因：/chat 路由闭包禁 mock，
// 而本文件整体引了 `@/lib/mock/agent-kernel`）。这里原样再导出，既有 import 路径不变。
export { InterjectionComposer, type InterjectionComposerProps } from "./interjection-composer";

// ══ 05 产出物面板 ═══════════════════════════════════════════════════
export function ArtifactsPanel({ empty = false }: { empty?: boolean }) {
  const art = MOCK_ARTIFACT;
  const [selected, setSelected] = React.useState<number>(art.versions[0]!.version);
  const active = art.versions.find((v) => v.version === selected)!;

  if (empty) {
    return (
      <aside data-testid="artifacts-panel" className="flex w-panel-alt flex-col rounded-container border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border p-3">
          <FileText aria-hidden className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-13 font-semibold">产出物</h2>
        </header>
        <div data-testid="empty" className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <FileText aria-hidden className="h-6 w-6 text-muted-foreground" />
          <p className="text-12 text-muted-foreground">还没有产出物。agent 生成文件后会出现在这里，并保留每次修改的版本。</p>
        </div>
      </aside>
    );
  }

  return (
    <aside data-testid="artifacts-panel" className="flex w-panel-alt flex-col rounded-container border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <FileText aria-hidden className="h-4 w-4 text-primary" />
        <h2 className="text-13 font-semibold">{art.name}</h2>
        <Badge tone="outline" className="ml-auto uppercase">{art.kind}</Badge>
      </header>

      {/* 当前版本预览缩略图 */}
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <div
          data-testid="artifact-preview"
          className="flex aspect-[3/4] w-full items-center justify-center rounded-card border border-border bg-background"
        >
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <FileText aria-hidden className="h-8 w-8" />
            <span className="text-11">{art.name} · {active.label}</span>
            <span className="text-10">{active.sizeKb} KB</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" data-testid="artifact-view" className="flex-1">查看此版本</Button>
          <Button size="sm" variant="primary" data-testid="artifact-continue" className="flex-1">
            <RefreshCw aria-hidden className="h-3.5 w-3.5" /> 基于此继续修改
          </Button>
        </div>
      </div>

      {/* 版本历史 */}
      <div className="flex items-center gap-2 px-3 pb-1 pt-2">
        <History aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-11 font-medium text-muted-foreground">版本历史</span>
      </div>
      <ol className="flex flex-col gap-1 overflow-y-auto p-2">
        {art.versions.map((v) => (
          <li key={v.version}>
            <button
              type="button"
              data-testid={`artifact-version-${v.version}`}
              aria-pressed={v.version === selected}
              onClick={() => setSelected(v.version)}
              className={cn(
                "flex w-full flex-col gap-0.5 rounded-card border p-2 text-left transition-colors duration-base",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                v.version === selected
                  ? "border-primary bg-accent"
                  : "border-border bg-background hover:border-input",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-12 font-medium text-background-foreground">{v.label}</span>
                <span className="ml-auto text-10 text-muted-foreground">{v.createdAt}</span>
              </div>
              <p className="text-11 text-muted-foreground">{v.changeNote}</p>
              <span className="text-10 text-muted-foreground">
                来自 {v.producedByRunId} · step {v.producedByStepId}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  );
}

// ══ 06 错误状态卡片 ═════════════════════════════════════════════════
export function ErrorCard() {
  const err = MOCK_ERROR;
  const [showDetail, setShowDetail] = React.useState(false);
  return (
    <Card data-testid="error-card" role="alert" className="max-w-xl border-destructive/40">
      <CardHeader className="gap-1">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />
          <CardTitle className="text-14">任务没能完成</CardTitle>
          <Badge tone="danger">failed</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p data-testid="error-message" className="text-13 text-background-foreground">{err.message}</p>

        <div className="flex flex-col gap-2">
          {err.suggestedActions.map((a) => (
            <Button
              key={a.kind}
              variant={a.kind === "retry" ? "primary" : "outline"}
              data-testid={`error-action-${a.kind}`}
              className="justify-start h-auto py-2"
            >
              {a.kind === "retry" && <RefreshCw aria-hidden className="h-4 w-4" />}
              <span className="flex flex-col items-start">
                <span className="text-13">{a.label}</span>
                <span className={cn("text-10", a.kind === "retry" ? "text-primary-foreground/80" : "text-muted-foreground")}>{a.hint}</span>
              </span>
            </Button>
          ))}
        </div>

        <div className="border-t border-border pt-2">
          <Button
            variant="ghost" size="sm"
            data-testid="error-detail-toggle"
            aria-expanded={showDetail}
            onClick={() => setShowDetail((v) => !v)}
          >
            {showDetail ? <ChevronDown aria-hidden className="h-3.5 w-3.5" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5" />}
            查看详情（技术信息）
          </Button>
          {showDetail && (
            <div data-testid="error-detail" className="mt-2 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-11 text-muted-foreground">
                <span>错误码 <code className="font-mono">{err.failureCode}</code></span>
                <span>·</span>
                <span>run <code className="font-mono">{err.runId}</code></span>
              </div>
              <pre className="overflow-x-auto rounded-control bg-muted p-2 text-11 leading-relaxed">
                <code className="font-mono text-muted-foreground">{err.stack}</code>
              </pre>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ══ 07 断线重连提示 ═════════════════════════════════════════════════
/**
 * Phase 14 F04 —— `state` 直接对齐契约 `streaming-transport.ts` 的 `ReconnectState`
 * （`reconnecting`/`restored`/`failed`），驱动它的是真实的
 * `lib/agent-kernel-stream.ts`（`useAgentKernelRunStream`）。`data-state` 属性把这个值
 * 原样落到 DOM 上——`contracts/streaming-transport/ui.md` 的 data-testid 表逐字要求它，
 * 不是仅靠文案区分三态。
 *
 * `failed`（重连持续失败）是签核材料 ui.md 第四节标注的缺口：复用本组件的第三个
 * `data-state`，不是独立组件——design-signoff.md 复核项①给出的两个选项里更小的那个
 * （没有新增 data-testid/新组件，只是同一个提示多一种视觉基调），如实记在这里供人类
 * 复核；如需改成独立组件，改动只在这一个函数内。
 */
export function ReconnectToast({ state = "restored" }: { state?: "reconnecting" | "restored" | "failed" }) {
  return (
    <div className="flex max-w-xl flex-col gap-3">
      {/* 上层是继续在跑的进度流，提示浮在其上，轻量、不阻断 */}
      <div className="rounded-card border border-border bg-card p-3 text-12 text-muted-foreground">
        执行进度流（示意）——重连提示出现时进度流不被遮挡、不需要用户操作。
      </div>
      {state === "reconnecting" && (
        <div
          role="status"
          data-testid="reconnect-toast"
          data-state="reconnecting"
          className="flex items-center gap-2 self-start rounded-pill border border-border bg-background/80 px-3 py-1.5 text-12 text-muted-foreground shadow-md backdrop-blur-md"
        >
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-warning" />
          连接中断，正在重连…
        </div>
      )}
      {state === "restored" && (
        <div
          role="status"
          data-testid="reconnect-toast"
          data-state="restored"
          className="flex items-center gap-2 self-start rounded-pill border border-border bg-background/80 px-3 py-1.5 text-12 text-background-foreground shadow-md backdrop-blur-md transition-opacity duration-slow"
        >
          <Wifi aria-hidden className="h-3.5 w-3.5 text-success" />
          连接已恢复，继续显示实时进度
        </div>
      )}
      {state === "failed" && (
        <div
          role="alert"
          data-testid="reconnect-toast"
          data-state="failed"
          className="flex items-center gap-2 self-start rounded-pill border border-destructive/40 bg-background/80 px-3 py-1.5 text-12 text-destructive shadow-md backdrop-blur-md"
        >
          <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
          连接中断，请手动刷新
        </div>
      )}
      <p className="text-10 text-muted-foreground">重连中/已恢复两态自动出现/消失，无需用户操作（02-streaming R8）；重连持续失败（`failed`）需要用户手动刷新，不再自动重试。</p>
    </div>
  );
}

// ══ 08 暂停态 ═══════════════════════════════════════════════════════
export function PausedState({ variant = "user" }: { variant?: "user" | "system" }) {
  const [resumed, setResumed] = React.useState(false);
  if (variant === "user") {
    return (
      <Card data-testid="paused-user" className="max-w-xl">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex items-center gap-2">
            <Pause aria-hidden className="h-4 w-4 text-muted-foreground" />
            <p className="text-13 text-background-foreground">你已暂停这个任务</p>
            <Badge tone="neutral" className="ml-auto">paused · 主动</Badge>
          </div>
          <p className="text-12 text-muted-foreground">
            已完成 3 / 6 步，当前停在「渲染 PDF 报告」之前。进度已保存，随时可以接着跑。
          </p>
          {resumed ? (
            <p data-testid="saved" className="text-12 text-success transition-opacity duration-slow">已恢复执行。</p>
          ) : (
            <Button variant="primary" className="self-start" data-testid="paused-resume" onClick={() => setResumed(true)}>
              <Play aria-hidden className="h-4 w-4" /> 恢复执行
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }
  // 系统保护性暂停：说明原因，不提供直接恢复（需先解除限制条件）
  return (
    <Card data-testid="paused-system" className="max-w-xl border-warning/40">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex items-center gap-2">
          <ShieldAlert aria-hidden className="h-4 w-4 text-warning" />
          <p className="text-13 text-background-foreground">系统为保护你的任务已暂停执行</p>
          <Badge tone="warning" className="ml-auto">paused · 系统保护</Badge>
        </div>
        <div className="flex items-start gap-1.5 rounded-control bg-muted p-2 text-12 text-muted-foreground">
          <CircleDot aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            原因：本组织的模型调用额度即将用尽，继续执行可能中途失败并浪费已生成的中间结果。
            额度将在每日 0 点重置，或由管理员在后台调高。
          </span>
        </div>
        <p className="text-11 text-muted-foreground">
          这是保护性暂停，不能直接恢复——需先解除上面的限制条件。已完成的 3 步进度已保存。
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" data-testid="paused-system-notify">额度恢复后通知我</Button>
          <Button variant="ghost" size="sm" data-testid="paused-system-contact">联系管理员</Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ══ 09 非终态 → 渲染分支（Phase 14 F04，R6 后置条件）═══════════════════
/**
 * 每个非终态各有专属分支，绝不塌缩成"判断为非终态就继续 loading"（domain.md
 * `isTerminalRunStatus` 覆盖三非终态那条不变量的另一半——覆盖只是判断，这里是真的
 * 渲染出对应可交互 UI）。终态（`succeeded`/`failed`/`cancelled`）不在这张表里：
 * 那是调用方另行渲染最终结果/`ErrorCard` 的职责，不是"非终态渲染分支"这件事的范围。
 */
export type AgentKernelNonTerminalBranch =
  | "plan-confirmation" | "tool-permission" | "paused-user" | "paused-system" | "progress";

export function agentKernelNonTerminalBranch(
  status: AgentKernelRunStatus,
  pausedBy?: "user" | "system" | null,
): AgentKernelNonTerminalBranch | null {
  switch (status) {
    case "awaiting_plan_confirmation": return "plan-confirmation";
    case "awaiting_tool_permission": return "tool-permission";
    // R4 E4：`pausedBy` 区分主动/保护性暂停，决定是否提供直接恢复入口——
    // 未知/缺失时保守地当系统保护性处理（不提供一个也许不该出现的恢复按钮）。
    case "paused": return pausedBy === "user" ? "paused-user" : "paused-system";
    case "queued":
    case "running": return "progress";
    default: return null;
  }
}

export function AgentKernelNonTerminalView({
  status, pausedBy = null, runId = null, interject,
}: {
  readonly status: AgentKernelRunStatus;
  readonly pausedBy?: "user" | "system" | null;
  /** Phase 14 F12：有 `runId` 时 `running` 分支下方的插话入口走真实接口。 */
  readonly runId?: string | null;
  readonly interject?: InterjectFn;
}) {
  switch (agentKernelNonTerminalBranch(status, pausedBy)) {
    case "plan-confirmation": return <PlanConfirmationCard />;
    case "tool-permission": return <ToolPermissionCard />;
    case "paused-user": return <PausedState variant="user" />;
    case "paused-system": return <PausedState variant="system" />;
    case "progress":
      // F12（R8）：插话入口与进度流并列，是进度流之下的兄弟节点，不是替换它——
      // 发送插话前后进度流都留在原地（"不打断当前展示的执行进度流"）。
      // `queued` 还没开始执行，契约只对 `running` 开放插话，所以此时不渲染入口。
      return (
        <div className="flex flex-col gap-3">
          <ProgressStream />
          {status === "running" && <InterjectionComposer runId={runId} status={status} interject={interject} />}
        </div>
      );
    default: return null;
  }
}
