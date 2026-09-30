"use client";
/**
 * WF08 —— 审批抽屉（面板与「待我审批」列表共用）。
 * 裁决后不本地预测结果：只发请求，结果由服务端回包 / projection 权威更新。
 */
import * as React from "react";
import { useState } from "react";
import {
  approveWorkflowGate,
  denyWorkflowGate,
  getWorkflowInstance,
  workflowErrorCode,
  type WorkflowGateView,
} from "@/lib/workflow-runtime-api";
import { describeWorkflowError } from "./workflow-copy";
import { useOptionalSession } from "@/components/session/session-provider";
import { capabilityCopy, targetSystemText } from "@/lib/workflow-capability-grant-copy";
import { memberLabel, useOrgMemberNames } from "@/lib/use-org-member-names";
import { gateDisplayTitle } from "@/lib/workflow-display-copy";
import { Button } from "@/components/ui/button";

export interface WorkflowApprovalDrawerProps {
  readonly instanceId: string;
  readonly gate: WorkflowGateView;
  /** 缺省（列表场景：契约列表项不带 stateVersion）时，裁决前先读一次 projection 取当前值。 */
  readonly expectedStateVersion?: number;
  readonly initiatorUserId?: string;
  readonly agentId?: string;
  /** 所属工作流 key（标题显示中文名用）。 */
  readonly workflowKey?: string;
  /** 实例已取消 / 终态时抽屉只读。 */
  readonly readOnly?: boolean;
  readonly onDecided?: (gate: WorkflowGateView) => void;
}

export function WorkflowApprovalDrawer(props: WorkflowApprovalDrawerProps) {
  const { gate } = props;
  const session = useOptionalSession();
  const names = useOrgMemberNames(session?.session?.currentOrgId ?? null);
  const me = session?.session?.userId ?? null;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "approve" | "deny">("idle");
  const [decided, setDecided] = useState<WorkflowGateView | null>(gate.decision ? gate : null);
  const shown = decided ?? gate;
  const locked = busy || shown.decision !== null || props.readOnly === true || !gate.viewerCanDecide;

  async function decide(kind: "approve" | "deny") {
    if (kind === "deny" && reason.trim() === "") {
      setError(describeWorkflowError("deny_reason_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const expectedStateVersion = props.expectedStateVersion ?? (await getWorkflowInstance(props.instanceId)).stateVersion;
      const base = { instanceId: props.instanceId, gateId: gate.gateId, expectedStateVersion };
      const res = kind === "approve" ? await approveWorkflowGate(base) : await denyWorkflowGate({ ...base, reason: reason.trim() });
      setDecided(res.gate);
      props.onDecided?.(res.gate);
    } catch (err) {
      const code = workflowErrorCode(err);
      setError(describeWorkflowError(code));
      if (code === "gate_already_decided") {
        const body = (err as { raw?: { decidedGate?: WorkflowGateView } }).raw;
        if (body?.decidedGate) setDecided(body.decidedGate);
      }
    } finally {
      setBusy(false);
    }
  }

  const p = shown.effectPreview;
  const title = gateDisplayTitle({ stageId: gate.stageId, summary: p.summary }, props.workflowKey);
  const sections = previewSections(p.payloadPreview);
  const busyText = busy ? "提交中…" : null;
  return (
    <aside
      data-testid="workflow-approval-drawer"
      data-gate-id={gate.gateId}
      aria-labelledby={`workflow-approval-title-${gate.gateId}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 text-13 shadow-sm"
    >
      <header className="flex flex-col gap-1">
        <p className="text-12 text-muted-foreground">{shown.decision === null ? "等待审批" : "审批已完成"}</p>
        <h3 id={`workflow-approval-title-${gate.gateId}`} data-testid="workflow-approval-title" className="text-16 font-semibold">
          {title.stage}
        </h3>
        {title.workflow ? <p className="text-12 text-muted-foreground" data-testid="workflow-approval-workflow">所属工作流：{title.workflow}</p> : null}
      </header>

      <section aria-label="审批概要" className="rounded-control border border-border bg-background p-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">操作对象</dt>
          <dd data-testid="workflow-approval-target">{targetSystemText(p.targetSystem)}</dd>
          <dt className="text-muted-foreground">需要的能力</dt>
          <dd data-testid="workflow-approval-capability">{capabilityCopy(p.capabilityCategory).label}</dd>
          {props.initiatorUserId ? (<><dt className="text-muted-foreground">发起人</dt><dd data-testid="workflow-approval-initiator">{memberLabel(props.initiatorUserId, me, names)}</dd></>) : null}
          {props.agentId ? (<><dt className="text-muted-foreground">执行者</dt><dd data-testid="workflow-approval-agent">本工作流的智能体</dd></>) : null}
        </dl>
      </section>

      {sections.length > 0 ? (
        <section aria-label="批准后会发生什么" data-testid="workflow-approval-preview" className="flex flex-col gap-1.5">
          <h4 className="text-12 font-medium text-muted-foreground">批准后会发生什么</h4>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            {sections.map((row) => (
              <React.Fragment key={row.key}>
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="whitespace-pre-wrap break-words">{row.value}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ) : null}

      {shown.decision !== null ? (
        <p
          data-testid="workflow-approval-result"
          data-decision={shown.decision}
          role="status"
          className={shown.decision === "approved"
            ? "rounded-control border border-success bg-success-tint px-3 py-2 text-success-tint-foreground"
            : "rounded-control border border-destructive px-3 py-2"}
        >
          {shown.decision === "approved" ? "已批准" : "已驳回"}
          {shown.decidedBy ? `（${memberLabel(shown.decidedBy, me, names)}）` : ""}
          {shown.reason ? `：${shown.reason}` : ""}
        </p>
      ) : null}

      {mode === "deny" && !locked ? (
        <label className="flex flex-col gap-1">
          <span className="text-12 font-medium">驳回理由（必填，会告知发起人）</span>
          <textarea
            data-testid="workflow-deny-reason"
            aria-label="驳回理由"
            placeholder="说明需要怎样修改，发起人会看到这段话"
            value={reason}
            disabled={busy}
            rows={3}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-control border border-border bg-background p-2 text-13 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      ) : null}
      {mode === "approve" && !locked ? (
        <p data-testid="workflow-approve-confirm-text" className="rounded-control border border-border bg-muted px-3 py-2 text-12">
          确认批准后，工作流会立即执行「{title.stage}」这一步，且无法撤回。
        </p>
      ) : null}

      {error ? <p role="alert" data-testid="workflow-approval-error" className="text-12 text-destructive">{error}</p> : null}
      {!gate.viewerCanDecide && shown.decision === null ? (
        <p className="text-12 text-muted-foreground" data-testid="workflow-approval-not-approver">你不是这一步的指定审批人，只能查看。</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "idle" || locked ? (
          <>
            <Button size="sm" variant="primary" data-testid="workflow-approve" disabled={locked} onClick={() => { setError(null); setMode("approve"); }}>批准</Button>
            <Button size="sm" variant="outline" data-testid="workflow-deny" disabled={locked} onClick={() => { setError(null); setMode("deny"); }}>驳回</Button>
          </>
        ) : mode === "approve" ? (
          <>
            <Button size="sm" variant="primary" data-testid="workflow-approve-confirm" disabled={busy} aria-busy={busy} onClick={() => void decide("approve")}>
              {busyText ?? "确认批准"}
            </Button>
            <Button size="sm" variant="ghost" data-testid="workflow-decision-cancel" disabled={busy} onClick={() => setMode("idle")}>取消</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="destructive" data-testid="workflow-deny-confirm" disabled={busy} aria-busy={busy} onClick={() => void decide("deny")}>
              {busyText ?? "确认驳回"}
            </Button>
            <Button size="sm" variant="ghost" data-testid="workflow-decision-cancel" disabled={busy} onClick={() => { setMode("idle"); setReason(""); }}>取消</Button>
          </>
        )}
      </div>

      <details data-testid="workflow-approval-tech-details" className="rounded-control border border-border px-3 py-2 text-12 text-muted-foreground">
        <summary className="cursor-pointer select-none rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">技术详情</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt>审批门</dt><dd><code>{gate.gateId}</code></dd>
          <dt>摘要</dt><dd><code>{p.summary}</code></dd>
          <dt>目标系统</dt><dd><code data-testid="workflow-approval-target-raw">{p.targetSystem}</code></dd>
          <dt>能力分类</dt><dd><code data-testid="workflow-approval-capability-raw">{p.capabilityCategory}</code></dd>
          {props.initiatorUserId ? (<><dt>发起人 ID</dt><dd><code data-testid="workflow-approval-initiator-raw">{props.initiatorUserId}</code></dd></>) : null}
          {props.agentId ? (<><dt>Agent ID</dt><dd><code data-testid="workflow-approval-agent-raw">{props.agentId}</code></dd></>) : null}
        </dl>
        <pre data-testid="workflow-approval-preview-raw" className="mt-2 max-h-48 overflow-auto rounded-control bg-muted p-2">
          {JSON.stringify(p.payloadPreview, null, 2)}
        </pre>
      </details>
    </aside>
  );
}

const PREVIEW_LABEL: Record<string, string> = {
  to: "收件人", recipients: "收件人", cc: "抄送", subject: "主题", topic: "主题", title: "标题",
  text: "内容", body: "内容", content: "内容", message: "内容", channel: "发送渠道", audience: "接收范围",
  fileName: "文件名", documentTitle: "文档标题", project: "项目", board: "看板", count: "数量",
};

const SIDE_EFFECT_TEXT: Record<string, string> = {
  none: "不改动任何数据",
  read: "只读取数据，不做改动",
  write: "会在本组织内新建或修改内容",
  external_send: "会把内容发送或分享到组织外部",
};

interface PreviewRow { readonly key: string; readonly label: string; readonly value: string }

function stringify(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === "string" || typeof x === "number")) return v.join("、");
  return null;
}

/** 把副作用预览的 payload 变成可读的「标签 → 值」行；认不出的结构只留在技术详情的原始 JSON 里。 */
export function previewSections(payload: Record<string, unknown>): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const [key, raw] of Object.entries(payload)) {
    if (key === "stageId") continue; // 已是标题
    if (key === "sideEffect") {
      const text = typeof raw === "string" ? SIDE_EFFECT_TEXT[raw] : undefined;
      if (text) rows.push({ key, label: "影响范围", value: text });
      continue;
    }
    const value = stringify(raw);
    if (value === null) continue;
    rows.push({ key, label: PREVIEW_LABEL[key] ?? "附加信息", value });
  }
  return rows;
}
