"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, ShieldCheck, Cpu, Coins, Database, Pencil, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  dataScopeConstraint,
  dataScopeLine,
  modelLine,
  budgetLine,
  modelPolicyViolation,
  type ApprovalRequest,
  type ApprovalModel,
} from "@/lib/mock/chat";

/**
 * 批准卡 —— 产品最关键的信任控件（UC-8.2 R3 步骤 6 / R7「批准卡」/ V1–V4c）。
 *
 * 硬约束：
 *  · **暂停 → 披露 → 人选 → 转后台** 四段缺一不可；人做出选择前动作绝不执行（AC2）。
 *  · 模型 / token 预算 / 数据范围三项**数据驱动**（D-07 / AC7），不写死文案：
 *    - 「gpt-5.2 ＋ 本地 qwen3-32b」来自 req.models
 *    - 「800k（约 ￥9.6）」来自 req.budget（model registry 供数）
 *    - 「含机密，仅本地模型」由 dataScopeConstraint() 从 dataScope 推导
 *  · 危险动作显式：`批准执行` 走二次确认并列影响范围；`不用了` 为终止动作，与主操作分离。
 *  · 视觉上与普通 AI 消息明确区分（左侧强调条 + 边框 + 已暂停标）。
 *
 * ⚠ 这是**界面投影**：真实的「含机密仅本地模型」由服务端 gateway 强制（V3），
 *   界面切到纯云端模型时展示的拒绝提示只是把服务端判定前置可见，不是权限实现。
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const [view, setView] = React.useState<"idle" | "confirm" | "reparam" | "approved" | "declined">("idle");
  // 「改参数」演示：把本地模型摘掉即可复现「机密数据无本地模型 → 被 gateway 拒绝」
  const [models, setModels] = React.useState<ApprovalModel[]>(request.models);

  const constraint = dataScopeConstraint(request.dataScope);
  const violation = modelPolicyViolation(models, request.dataScope);
  const expired = request.status === "expired";
  const localModels = models.filter((m) => m.hosting === "local");
  const cloudModels = models.filter((m) => m.hosting === "cloud");

  return (
    <section
      data-testid="chat-approval-card"
      aria-label="批准请求"
      className={cn(
        "overflow-hidden rounded-lg border-2 bg-card shadow-md",
        expired ? "border-border" : "border-warning",
      )}
    >
      {/* 标题条 + 状态标（与普通 AI 消息明确区分）*/}
      <header className="flex items-center gap-2 border-b border-border-subtle bg-warning/10 px-3 py-2">
        <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-warning" />
        <h3 className="min-w-0 flex-1 truncate text-13 font-semibold">{request.title}</h3>
        {expired ? (
          <Badge tone="neutral" data-testid="chat-approval-status">已过期 · 未执行</Badge>
        ) : (
          <Badge tone="warning" data-testid="chat-approval-status">已暂停</Badge>
        )}
      </header>

      <div className="flex flex-col gap-2.5 p-3">
        {/* 调用链（可展开）*/}
        <CallChain chain={request.callChain} />

        {/* 三行披露 */}
        <dl className="flex flex-col divide-y divide-border-subtle rounded-md border border-border-subtle">
          <MetaRow icon={Cpu} label="模型" testid="chat-approval-model" editable={!expired} onEdit={() => setView("reparam")}>
            <span className="text-12 text-card-foreground">{modelLine(models)}</span>
          </MetaRow>
          <MetaRow icon={Coins} label="token 预算" testid="chat-approval-budget" editable={!expired} onEdit={() => setView("reparam")}>
            <span className="text-12 text-card-foreground">{budgetLine(request.budget)}</span>
            <span className="ml-1 text-10 text-muted-foreground">· 取自 {request.budget.registrySource}</span>
          </MetaRow>
          <MetaRow icon={Database} label="要读的数据" testid="chat-approval-datascope">
            <span className="text-12 text-card-foreground">{request.dataScope.map((d) => d.label).join(" ＋ ")}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <Badge tone={constraint.localModelOnly ? "warning" : "neutral"} data-testid="chat-approval-datascope-note">
              {constraint.note}
            </Badge>
          </MetaRow>
        </dl>

        {/* 数据范围与模型不匹配时的服务端拒绝前置提示（V3 的界面投影）*/}
        {violation && (
          <p role="alert" data-testid="chat-approval-policy-violation" className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-11 text-destructive">
            {violation}
          </p>
        )}

        {/* 过期态说明（原型确认缺失，本屏补齐）*/}
        {expired && (
          <p className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-11 text-muted-foreground" data-testid="chat-approval-expired-note">
            <Clock aria-hidden className="h-3.5 w-3.5" />
            超时未处理，已自动失效（{request.timeoutHint}）。如仍需执行，请重新发起。
          </p>
        )}

        {/* ── 出口区 ── */}
        {!expired && view === "idle" && (
          <ExitActions
            onApprove={() => setView("confirm")}
            onReparam={() => setView("reparam")}
            onDecline={() => setView("declined")}
          />
        )}

        {/* 危险动作二次确认：列出影响范围（读什么、花多少、去哪）*/}
        {view === "confirm" && (
          <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning/5 p-2.5" data-testid="chat-approval-confirm">
            <p className="text-12 font-medium">确认批准这次执行？影响范围：</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-11 text-muted-foreground">
              <li>将读取：{dataScopeLine(request.dataScope)}</li>
              <li>预计消耗：{budgetLine(request.budget)}（{cloudModels.length > 0 ? "非机密部分走 " + cloudModels.map((m) => m.label).join("、") + "，" : ""}机密部分仅 {localModels.map((m) => m.label).join("、") || "本地模型"}）</li>
              <li>批准后转后台任务，约 {request.etaMinutes} 分钟回到本线程；线程不阻塞</li>
            </ul>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => setView("approved")} data-testid="chat-approval-confirm-yes">确认批准</Button>
              <Button size="sm" variant="ghost" onClick={() => setView("idle")} data-testid="chat-approval-confirm-no">返回</Button>
            </div>
          </div>
        )}

        {/* 改参数再跑：改完生成新卡、原卡存档（不就地改写）*/}
        {view === "reparam" && (
          <ReparamPanel
            models={models}
            onToggleLocal={(next) => setModels(next)}
            onRerun={() => setView("idle")}
            onCancel={() => { setModels(request.models); setView("idle"); }}
          />
        )}

        {view === "approved" && (
          <p className="flex items-center gap-1.5 rounded-md bg-success/10 px-2.5 py-2 text-12 text-success" data-testid="chat-approval-approved">
            <ShieldCheck aria-hidden className="h-3.5 w-3.5" />
            已批准 · 已转后台任务，约 {request.etaMinutes} 分钟回到本线程（本卡已归档为历史）
          </p>
        )}
        {view === "declined" && (
          <p className="rounded-md bg-muted px-2.5 py-2 text-12 text-muted-foreground" data-testid="chat-approval-declined">
            已终止 · 动作不会执行，已记入审计（本卡已归档为历史）
          </p>
        )}

        {/* 脚注 + 看任务队列（常驻，非过期时）*/}
        {!expired && (
          <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-2">
            <p className="text-10 text-muted-foreground">批准后转后台任务，约 {request.etaMinutes} 分钟回到本线程</p>
            <Button size="xs" variant="ghost" asChild data-testid="chat-approval-queue">
              <Link href="/tasks">看任务队列 →</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function CallChain({ chain }: { chain: string[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-testid="chat-approval-callchain-toggle"
        className="inline-flex items-center gap-1 text-11 text-muted-foreground transition-colors duration-200 hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight aria-hidden className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")} />
        调用链 {chain.join(" → ")}
      </button>
      {open && (
        <ol className="ml-4 mt-1 flex flex-col gap-0.5" data-testid="chat-approval-callchain-detail">
          {chain.map((a, i) => (
            <li key={i} className="text-10 text-muted-foreground">
              {i + 1}. {a}
              {i < chain.length - 1 ? ` 调用 ${chain[i + 1]}（互调深度 ${i + 1}，上限 2）` : "（发起本次高影响动作）"}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MetaRow({
  icon: Icon, label, testid, editable, onEdit, children,
}: {
  icon: typeof Cpu;
  label: string;
  testid: string;
  editable?: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5" data-testid={testid}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="w-20 shrink-0 text-11 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center">{children}</span>
      {editable && onEdit && (
        <Button size="xs" variant="ghost" onClick={onEdit} data-testid={`${testid}-edit`}>
          <Pencil aria-hidden className="h-3 w-3" />
          改
        </Button>
      )}
    </div>
  );
}

function ExitActions({
  onApprove, onReparam, onDecline,
}: { onApprove: () => void; onReparam: () => void; onDecline: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="chat-approval-actions">
      {/* 主操作与危险/终止操作分离：批准执行 primary、不用了 destructive 且拉开距离 */}
      <Button size="sm" variant="primary" onClick={onApprove} data-testid="chat-approval-approve">批准执行</Button>
      <Button size="sm" variant="outline" onClick={onReparam} data-testid="chat-approval-reparam">改参数再跑</Button>
      <div className="ml-auto">
        <Button size="sm" variant="destructive" onClick={onDecline} data-testid="chat-approval-decline">不用了</Button>
      </div>
    </div>
  );
}

function ReparamPanel({
  models, onToggleLocal, onRerun, onCancel,
}: {
  models: ApprovalModel[];
  onToggleLocal: (next: ApprovalModel[]) => void;
  onRerun: () => void;
  onCancel: () => void;
}) {
  const hasLocal = models.some((m) => m.hosting === "local");
  const toggleLocal = () => {
    if (hasLocal) {
      onToggleLocal(models.filter((m) => m.hosting !== "local"));
    } else {
      onToggleLocal([...models, { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local", version: "self-hosted@1.4" }]);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-subtle bg-muted p-2.5" data-testid="chat-approval-reparam-panel">
      <p className="text-11 text-muted-foreground">改参数后会生成一张<strong className="font-medium text-background-foreground">新的</strong>批准卡，原卡保留为历史，不就地改写。</p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-11">本地模型（承接机密数据）</span>
        <Button size="xs" variant={hasLocal ? "primary" : "outline"} onClick={toggleLocal} data-testid="chat-approval-toggle-local">
          {hasLocal ? "已启用" : "已移除（改为纯云端）"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" onClick={onRerun} data-testid="chat-approval-reparam-run">生成新卡再跑</Button>
        <Button size="sm" variant="ghost" onClick={onCancel} data-testid="chat-approval-reparam-cancel">取消</Button>
      </div>
    </div>
  );
}
