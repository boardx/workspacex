"use client";
import * as React from "react";
import { Check, Loader2, Clock, UserCheck, Lock, AlertTriangle, ShieldCheck, RotateCw, FileDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "./overlay";
import { TRASH_TASKS, type TrashTask, type TrashStepState } from "@/lib/mock/files";

/**
 * 待删除队列（UC-22.4 R3.c/d / R5）—— **合规负责人专属屏**。
 * 唯一能看到「已从浏览器消失但尚未物理删除」对象的角色。
 * 每个任务按**五步流程**呈现当前步与时间戳；含 legal hold、超时升级、
 * 🔴 **部分失败**（本 UC 最危险的态：半完成的删除比不删更危险，不标完成、不出回执）。
 */
export function TrashQueue({ canView, onToast }: { canView: boolean; onToast: (msg: string) => void }) {
  if (!canView) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-muted py-12 text-center" data-testid="files-trash-denied">
        <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
        <p className="text-13 font-medium">待删除队列仅合规负责人可见</p>
        <p className="text-12 text-muted-foreground">项目层限制：你在本项目中不是合规负责人。用顶部视角切换器切到合规视角预览。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-1" data-testid="files-trash-queue">
      <div>
        <h1 className="text-18 font-semibold">待删除队列</h1>
        <p className="mt-0.5 text-12 text-muted-foreground">
          两级 SLA（D-15）：逻辑失效 ≤5 分钟，物理删除 ≤30 天并出回执。留存宽限期 30 天（O-01，可项目级覆盖）。
        </p>
      </div>

      {TRASH_TASKS.map((task) => <TaskCard key={task.id} task={task} onToast={onToast} />)}
    </div>
  );
}

const STEP_ICON: Record<TrashStepState, React.ReactNode> = {
  done: <Check aria-hidden className="h-3 w-3 text-success" />,
  active: <Loader2 aria-hidden className="h-3 w-3 animate-spin text-primary" />,
  pending: <Clock aria-hidden className="h-3 w-3 text-muted-foreground" />,
  human: <UserCheck aria-hidden className="h-3 w-3 text-ai" />,
};

function TaskCard({ task, onToast }: { task: TrashTask; onToast: (msg: string) => void }) {
  const [holdReleased, setHoldReleased] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [receiptOpen, setReceiptOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4" data-testid="files-trash-task">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-13 font-semibold">{task.fileName}</p>
          <p className="text-11 text-muted-foreground">{task.reason}</p>
          <p className="mt-0.5 text-11 text-muted-foreground">
            发起：{task.requestedBy} · {task.requestedAt} · 物理删除截止：{task.physicalDeleteDue}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {task.legalHold && <Badge tone="danger" data-testid="files-trash-legalhold"><Lock aria-hidden className="h-2.5 w-2.5" /> legal hold</Badge>}
          {task.overdue && <Badge tone="warning" data-testid="files-trash-overdue"><AlertTriangle aria-hidden className="h-2.5 w-2.5" /> 超时 · 可升级</Badge>}
          {task.partialFailure && <Badge tone="danger" data-testid="files-trash-partial-badge">部分失败</Badge>}
        </div>
      </div>

      {/* 五步流程 */}
      <ol className="flex flex-col gap-1.5" data-testid="files-trash-steps">
        {task.steps.map((s) => (
          <li key={s.no} className="flex items-center gap-2" data-testid="files-trash-step">
            <span className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
              s.state === "done" ? "border-success bg-success/10"
                : s.state === "active" ? "border-primary bg-primary/10"
                : s.state === "human" ? "border-ai bg-ai-tint"
                : "border-border bg-muted",
            )}>
              {STEP_ICON[s.state]}
            </span>
            <span className={cn("text-11", s.state === "pending" ? "text-muted-foreground" : "text-background-foreground")}>{s.label}</span>
            <span className="ml-auto shrink-0 text-10 text-muted-foreground">{s.sla}</span>
          </li>
        ))}
      </ol>

      {/* 部分失败：不标完成、不出回执、告警、可重试 */}
      {task.partialFailure && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5" data-testid="files-trash-partial">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-11">{task.partialFailure}</p>
            <Button size="xs" variant="outline" className="mt-1.5" onClick={() => onToast(`已重排「${task.fileName}」的级联删除重试；成功前不标完成、不出回执。`)} data-testid="files-trash-retry"><RotateCw aria-hidden className="h-3 w-3" /> 重试级联</Button>
          </div>
        </div>
      )}

      {/* 合规动作 */}
      <div className="flex flex-wrap items-center gap-2">
        {task.legalHold
          ? (holdReleased
              ? <span role="status" className="inline-flex items-center gap-1 text-11 text-success" data-testid="files-trash-hold-released"><ShieldCheck aria-hidden className="h-3 w-3" /> 已解除 legal hold，任务恢复五步流程。</span>
              : <Button size="xs" variant="outline" onClick={() => { setHoldReleased(true); onToast(`已解除「${task.fileName}」的 legal hold（仅合规负责人可操作，已写审计）。`); }} data-testid="files-trash-release-hold"><ShieldCheck aria-hidden className="h-3 w-3" /> 解除 legal hold</Button>)
          : (revoked
              ? <span role="status" className="inline-flex items-center gap-1 text-11 text-success" data-testid="files-trash-revoked"><ShieldCheck aria-hidden className="h-3 w-3" /> 已在宽限期内撤销删除，对象恢复可见。</span>
              : <Button size="xs" variant="outline" onClick={() => { setRevoked(true); onToast(`已撤销「${task.fileName}」的删除：宽限期内对象恢复、引用重新生效。`); }} data-testid="files-trash-revoke">撤销删除（宽限期内）</Button>)}
        <Button size="xs" variant="ghost" onClick={() => setReceiptOpen(true)} data-testid="files-trash-receipt"><FileDown aria-hidden className="h-3 w-3" /> 查看 / 补发回执</Button>
      </div>

      {receiptOpen && (
        <Modal testid="files-trash-receipt-modal" title="删除回执" subtitle={task.fileName} onClose={() => setReceiptOpen(false)}
          footer={<Button size="sm" variant="primary" onClick={() => { setReceiptOpen(false); onToast("回执已补发给受访者（含删除范围与时间戳）。"); }} data-testid="files-trash-receipt-resend">补发给受访者</Button>}>
          <div className="flex flex-col gap-2 text-12" data-testid="files-trash-receipt-body">
            <p>发起：{task.requestedBy} · {task.requestedAt}</p>
            <p>原因：{task.reason}</p>
            <p>物理删除截止：{task.physicalDeleteDue}</p>
            {task.partialFailure
              ? <p className="text-destructive">当前为部分失败，尚未出正式回执——半完成的删除不出回执，先修复再补发。</p>
              : <p className="text-muted-foreground">回执范围：原件 + 全部版本 + 全部派生物；引述退出检索、报告段落标「证据已撤回」均已如实记录。</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
