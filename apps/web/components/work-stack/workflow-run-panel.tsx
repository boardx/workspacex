"use client";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DeniedState, EmptyState, LoadingSkeleton } from "@/components/work-stack/states";
import {
  APPROVAL,
  WORKFLOW_RUN,
  type PreviewState,
  type RunStage,
  type SseStatus,
  type StageStatus,
} from "@/lib/mock/work-stack";

const STAGE_META: Record<StageStatus, { label: string; tone: "success" | "primary" | "warning" | "danger" | "neutral" | "outline" }> = {
  done: { label: "已完成", tone: "success" },
  running: { label: "运行中", tone: "primary" },
  awaiting_gate_decision: { label: "等待审批", tone: "warning" },
  rejected: { label: "已拒绝", tone: "danger" },
  failed: { label: "失败", tone: "danger" },
  blocked_permission: { label: "权限阻断", tone: "danger" },
  pending: { label: "待运行", tone: "outline" },
};

const SSE_META: Record<SseStatus, { label: string; tone: "success" | "warning" | "neutral" }> = {
  live: { label: "实时", tone: "success" },
  reconnecting: { label: "重连中…", tone: "warning" },
  polling: { label: "降级轮询", tone: "neutral" },
};

/** 依据七态派生本屏的阶段/连接/提示条呈现 */
function deriveRun(state: PreviewState) {
  const base = WORKFLOW_RUN;
  const stages = base.stages.map((s) => ({ ...s }));
  let sse: SseStatus = base.sse;
  let banner: { testid: string; tone: "warning" | "danger"; text: string } | null = null;
  let approvalOpen = false;
  let approvalResult: "none" | "denied" = "none";

  switch (state) {
    case "success": {
      // 全部完成
      for (const s of stages) {
        (s as RunStage & { status: StageStatus }).status = "done";
        s.attempt = Math.max(1, s.attempt);
      }
      break;
    }
    case "invalid": {
      // 等待审批态：门阶段等待，展示审批抽屉
      const gate = stages.find((s) => s.stageId === "gate");
      const tier = stages.find((s) => s.stageId === "tier");
      if (tier) tier.status = "done";
      if (gate) {
        gate.status = "awaiting_gate_decision";
        gate.attempt = 1;
      }
      banner = { testid: "workflow-banner-needs-attention", tone: "warning", text: "有一个副作用等待你审批：写入 CRM（crm.write）。" };
      approvalOpen = true;
      break;
    }
    case "depfail": {
      // 被拒 + 权限阻断
      const gate = stages.find((s) => s.stageId === "gate");
      const tier = stages.find((s) => s.stageId === "tier");
      const write = stages.find((s) => s.stageId === "write");
      if (tier) tier.status = "done";
      if (gate) {
        gate.status = "rejected";
        gate.note = "审批人林经理拒绝：本批线索质量不足，理由已记录";
      }
      if (write) write.status = "blocked_permission";
      banner = {
        testid: "workflow-banner-blocked-permission",
        tone: "danger",
        text: "reasonCode=CAPABILITY_REVOKED：写入权限已变更，需管理员处理，不自动重试。",
      };
      approvalOpen = true;
      approvalResult = "denied";
      break;
    }
    case "default":
    default:
      break;
  }
  return { stages, sse, banner, approvalOpen, approvalResult };
}

function ApprovalDrawer({ result }: { result: "none" | "denied" }) {
  const decided = result === "denied";
  return (
    <aside
      data-testid="workflow-approval-drawer"
      className="flex w-80 shrink-0 flex-col gap-4 border-l border-border bg-card p-4"
    >
      <header>
        <h2 className="text-13 font-bold text-background-foreground">待审批：副作用预览</h2>
        <p className="mt-1 text-11 text-muted-foreground">
          批准前请核对影响范围——这是一次<strong className="text-destructive"> 写入外部系统 </strong>的危险动作。
        </p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-12">
        <dt className="text-muted-foreground">能力分类</dt>
        <dd className="text-background-foreground">{APPROVAL.capability}</dd>
        <dt className="text-muted-foreground">目标系统</dt>
        <dd className="text-background-foreground">{APPROVAL.targetSystem}</dd>
        <dt className="text-muted-foreground">发起人</dt>
        <dd className="text-background-foreground">{APPROVAL.initiator}</dd>
        <dt className="text-muted-foreground">执行 Agent</dt>
        <dd className="text-background-foreground">{APPROVAL.agent}</dd>
      </dl>

      <div className="rounded-control border border-border bg-muted/40 p-3">
        <p className="text-12 font-medium text-background-foreground">{APPROVAL.effectSummary}</p>
        <ul className="mt-2 flex flex-col gap-1">
          {APPROVAL.items.map((it) => (
            <li key={it} className="text-11 text-muted-foreground">• {it}</li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deny-reason">拒绝理由（拒绝时必填）</Label>
        <Textarea
          id="deny-reason"
          data-testid="workflow-deny-reason"
          placeholder="说明拒绝原因，会记入审批事件…"
          disabled={decided}
          defaultValue={decided ? "本批线索质量不足，重新分层后再报。" : ""}
        />
      </div>

      {decided && (
        <p role="alert" className="text-12 text-destructive">
          已由林经理拒绝，操作已关闭。
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" variant="primary" data-testid="workflow-approve" disabled={decided}>
          批准
        </Button>
        <Button size="sm" variant="destructive" data-testid="workflow-deny" disabled={decided}>
          拒绝
        </Button>
      </div>
    </aside>
  );
}

export function WorkflowRunPanel({ state }: { state: PreviewState }) {
  if (state === "denied") {
    return (
      <div data-testid="workflow-run-panel" className="p-6">
        <DeniedState testid="workflow-run-denied" />
      </div>
    );
  }
  if (state === "loading") {
    return (
      <div data-testid="workflow-run-panel" className="p-6">
        <LoadingSkeleton testid="workflow-run-loading" />
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div data-testid="workflow-run-panel" className="p-6">
        <div data-testid="workflow-run-list-empty">
          <EmptyState
            testid="workflow-run-empty"
            message="你还没有运行中的 Workflow。到角色 Agent 或对话里发起一个试试。"
            actionLabel="发起 Workflow"
            actionTestid="workflow-run-entry"
          />
        </div>
      </div>
    );
  }

  const { stages, sse, banner, approvalOpen, approvalResult } = deriveRun(state);
  const run = WORKFLOW_RUN;
  const failedStage = stages.find((s) => s.status === "failed" || s.status === "blocked_permission");

  return (
    <div data-testid="workflow-run-panel" className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <h1 className="text-14 font-bold text-background-foreground">{run.workflowName}</h1>
            <p className="text-11 text-muted-foreground">实例 {run.instanceId}</p>
          </div>
          <Badge tone="outline" data-testid="workflow-pinned-version" className="ml-2">
            {run.pinnedVersion}
          </Badge>
          <div className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1 text-11 text-muted-foreground">
              <Avatar initials="销" tone="ai" size="sm" /> {run.initiatorAgent}
            </span>
            <Badge tone={SSE_META[sse].tone} data-testid="workflow-sse-status">
              {SSE_META[sse].label}
            </Badge>
          </div>
        </header>

        {banner && (
          <div
            data-testid={banner.testid}
            role="alert"
            className={`mx-4 mt-3 rounded-control px-3 py-2 text-12 ${
              banner.tone === "danger"
                ? "bg-destructive/10 text-destructive"
                : "bg-warning/15 text-warning-foreground"
            }`}
          >
            {banner.text}
          </div>
        )}

        <div className="grid flex-1 grid-cols-[1.2fr_1fr] gap-4 p-4">
          {/* 阶段时间线 */}
          <section className="flex flex-col gap-2">
            <h2 className="text-12 font-medium uppercase tracking-wide text-muted-foreground">阶段时间线</h2>
            <ol className="flex flex-col gap-2">
              {stages.map((s) => {
                const meta = STAGE_META[s.status];
                return (
                  <li
                    key={s.stageId}
                    data-testid={`workflow-stage-${s.stageId}`}
                    className={`rounded-lg border px-3 py-2.5 ${
                      s.status === "running" ? "border-primary bg-muted" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-13 font-medium text-background-foreground">{s.name}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      {s.attempt > 1 && <span className="text-10 text-muted-foreground">第 {s.attempt} 次尝试</span>}
                      {(s.status === "failed" || s.status === "blocked_permission") && (
                        <Button
                          size="xs"
                          variant="outline"
                          className="ml-auto"
                          data-testid={`workflow-action-retry-${s.stageId}`}
                        >
                          从该阶段重试
                        </Button>
                      )}
                    </div>
                    {s.pinnedSkills.length > 0 && (
                      <p data-testid={`workflow-stage-skills-${s.stageId}`} className="mt-1 text-10 text-muted-foreground">
                        固定 Skill：{s.pinnedSkills.join("、")}
                      </p>
                    )}
                    {s.note && <p className="mt-1 text-11 text-muted-foreground">{s.note}</p>}
                  </li>
                );
              })}
            </ol>
          </section>

          {/* 实时日志 */}
          <section className="flex flex-col gap-2">
            <h2 className="text-12 font-medium uppercase tracking-wide text-muted-foreground">实时日志</h2>
            <ul data-testid="workflow-event-log" className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
              {run.events.map((e) => (
                <li key={e.seq} className="flex gap-2 text-11">
                  <span className="tabular-nums text-muted-foreground">{e.at}</span>
                  <span className="text-background-foreground">{e.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="flex gap-2 border-t border-border px-4 py-3">
          <Button size="sm" variant="destructive" data-testid="workflow-action-cancel">
            取消运行
          </Button>
          {failedStage && (
            <Button size="sm" variant="outline" data-testid="workflow-action-resume">
              继续
            </Button>
          )}
        </footer>
      </div>

      {approvalOpen && <ApprovalDrawer result={approvalResult} />}
    </div>
  );
}
