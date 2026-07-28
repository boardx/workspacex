"use client";
import * as React from "react";
import { Plus, Pencil, PlayCircle, ShieldQuestion, Eye, Check, Ban } from "lucide-react";
import { AdminScreen } from "./admin-screen";
import { VisibilityBadge } from "./scope-badges";
import { AdminDrawer, AdminModal, ConfirmDialog, Toast, Field, KV } from "./panel";
import { DisableDialog, type DisableMode } from "./disable-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  AGENTS, AGENT_STATUS_LABEL, MODELS, VISIBILITY_LABEL, AGENT_TRIAL_OUTPUT, inFlightOf,
  type AgentStatus, type AgentRow,
} from "@/lib/mock/admin";
import type { UiState } from "@/lib/ui-state";

const STATUS_TONE: Record<AgentStatus, "primary" | "warning" | "neutral" | "outline"> = {
  running: "primary",
  review: "warning",
  draft: "neutral",
  disabled: "outline",
};

type PanelState = { mode: "add" | "edit" | "view"; agent: AgentRow | null } | null;

export function AgentScreen({ state }: { state: UiState }) {
  const [panel, setPanel] = React.useState<PanelState>(null);
  const [trial, setTrial] = React.useState<AgentRow | null>(null);
  const [approveOf, setApproveOf] = React.useState<AgentRow | null>(null);
  const [approved, setApproved] = React.useState<Set<string>>(new Set());
  const [disabledIds, setDisabledIds] = React.useState<Set<string>>(new Set());
  const [disableOf, setDisableOf] = React.useState<AgentRow | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  return (
    <AdminScreen
      state={state}
      moduleLabel="Agent"
      title="Agent 管理"
      intro="每个 agent = 定义 + skill 挂载 + 工具白名单 + 模型 + 降级策略 + 可见性范围。发布走双重门禁，全程审计。"
      emptyHint="还没有注册任何 agent"
      errors={{ toolWhitelist: "工具白名单校验失败：Forge 申请的 mcp:客户 CRM(query_contact) 超出授权范围，需会签后才能保存" }}
      depFailure="agent 的模型下拉来自模型池（UC-20.1）；模型测试服务不可用，无法确认可用模型。"
      denialReason="Agent 管理仅组织管理员与能力维护者可进入；能力维护者只读，你当前无此角色。"
      successMessage="Agent『Ledger』的可见性范围已更新为仅能源组"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-12 text-muted-foreground">
            共 {AGENTS.length} 个 agent · {AGENTS.filter((a) => a.status === "running").length} 个运行中 · 1 个待审核
          </p>
          <Button size="sm" variant="primary" onClick={() => setPanel({ mode: "add", agent: null })} data-testid="admin-agent-add">
            <Plus aria-hidden className="h-3.5 w-3.5" />
            注册 agent
          </Button>
        </div>

        {/* 可见性范围 vs 授权范围 的界面澄清 —— 只在 agent/skill 出现「可见性范围」 */}
        <p className="rounded-md border border-border-subtle bg-panel px-3 py-2 text-11 text-muted-foreground">
          下表的<strong className="text-background-foreground">「可见性范围」</strong>决定「谁能看到、用这个 agent」，
          取值只有「全组织可用 / 仅某组」。它与 MCP 页的<strong className="text-background-foreground">「授权范围」</strong>
          （谁能调用某台服务器的工具）是<strong className="text-background-foreground">两个不同维度</strong>，两处徽标刻意长得不一样。
        </p>

        <div className="flex flex-col gap-2" data-testid="admin-agent-list">
          {AGENTS.map((a) => {
            const isApproved = approved.has(a.id);
            const isDisabled = disabledIds.has(a.id);
            const isRunning = !isDisabled && (isApproved || a.status === "running");
            return (
              <Card key={a.id} data-testid={`admin-agent-row-${a.id}`}>
                <CardContent className="flex flex-col gap-2 pt-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Avatar initials={a.initials} tone="ai" size="md" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-13 font-medium">{a.name}</span>
                      <span className="text-11 text-muted-foreground">{a.role}</span>
                    </div>
                    <Badge tone={isDisabled ? "outline" : isApproved ? "primary" : STATUS_TONE[a.status]} data-testid={`admin-agent-status-${a.id}`}>
                      {isDisabled ? "已停用" : isApproved ? "运行中" : AGENT_STATUS_LABEL[a.status]}
                    </Badge>
                    <VisibilityBadge scope={a.visibility} team={a.team} data-testid={`admin-agent-visibility-${a.id}`} />
                    <div className="ml-auto flex items-center gap-4 text-11 text-muted-foreground">
                      <span className="font-mono">{a.model}</span>
                      <span>{a.skills} skills</span>
                      <span>{a.callsPerMonth.toLocaleString()} 次/月</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="xs" variant="outline" onClick={() => setPanel({ mode: "edit", agent: a })} data-testid={`admin-agent-edit-${a.id}`}>
                        <Pencil aria-hidden className="h-3 w-3" />
                        编辑
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setTrial(a)} data-testid={`admin-agent-trial-${a.id}`}>
                        <PlayCircle aria-hidden className="h-3 w-3" />
                        试跑
                      </Button>
                      {isRunning && (
                        <Button size="xs" variant="outline" onClick={() => setDisableOf(a)} data-testid={`admin-agent-disable-${a.id}`}>
                          <Ban aria-hidden className="h-3 w-3" />
                          停用
                        </Button>
                      )}
                    </div>
                  </div>

                  {a.blocker && !isApproved && (
                    <div
                      className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5"
                      data-testid={`admin-agent-blocker-${a.id}`}
                    >
                      <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                      <div className="flex flex-col gap-2">
                        <p className="text-12">{a.blocker}</p>
                        <div className="flex gap-1.5">
                          <Button size="xs" variant="primary" onClick={() => setApproveOf(a)} data-testid={`admin-agent-approve-${a.id}`}>批准发布</Button>
                          <Button size="xs" variant="outline" onClick={() => setPanel({ mode: "view", agent: a })} data-testid={`admin-agent-view-${a.id}`}>查看定义</Button>
                        </div>
                      </div>
                    </div>
                  )}
                  {isApproved && !isDisabled && (
                    <p className="inline-flex items-center gap-1 text-11 text-success" data-testid={`admin-agent-approved-${a.id}`}>
                      <Check aria-hidden className="h-3 w-3" /> 已会签放行并发布，越权申请已收回
                    </p>
                  )}
                  {isDisabled && (
                    <p className="inline-flex items-center gap-1 text-11 text-muted-foreground" data-testid={`admin-agent-disabled-${a.id}`}>
                      <Ban aria-hidden className="h-3 w-3" /> 已停用，不再受理新的编排调用
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* 注册 / 编辑 / 查看定义 */}
      {panel && (
        <AgentPanel
          mode={panel.mode}
          agent={panel.agent}
          onClose={() => setPanel(null)}
          onSave={(name) => {
            setPanel(null);
            setToast(panel.mode === "add" ? `已创建 agent 草稿「${name || "未命名"}」，发布前需双重门禁` : `已保存 agent「${name}」的改动，已写审计`);
          }}
        />
      )}

      {/* 试跑 */}
      {trial && (
        <AdminModal testid="admin-agent-trial-modal" width="lg" title={`试跑 · ${trial.name}`} subtitle="沙箱运行一次，不落项目库、不计费" onClose={() => setTrial(null)}>
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border bg-panel p-2.5">
              <p className="text-11 font-medium text-muted-foreground">试跑输入</p>
              <p className="text-12">{AGENT_TRIAL_OUTPUT.input}</p>
            </div>
            <div className="flex flex-col gap-1" data-testid="admin-agent-trial-steps">
              {AGENT_TRIAL_OUTPUT.steps.map((s, i) => (
                <p key={i} className="flex items-center gap-1.5 text-11 text-muted-foreground">
                  <Check aria-hidden className="h-3 w-3 text-success" /> {s}
                </p>
              ))}
            </div>
            <div className="rounded-md border border-ai/20 bg-ai-tint p-2.5" data-testid="admin-agent-trial-output">
              <p className="text-11 font-medium text-ai-tint-foreground">输出</p>
              <p className="text-12 text-ai-tint-foreground">{AGENT_TRIAL_OUTPUT.output}</p>
            </div>
            <p className="text-11 text-muted-foreground">{trial.model} · {AGENT_TRIAL_OUTPUT.tokens} token</p>
          </div>
        </AdminModal>
      )}

      {/* 批准发布（危险动作二次确认 + 会签说明） */}
      {approveOf && (
        <ConfirmDialog
          testid="admin-agent-approve-dialog"
          title={`批准发布 · ${approveOf.name}`}
          tone="primary"
          requireReason
          reasonPlaceholder="例如：越权申请已改为仅读、经安全评审人复核，同意放行。"
          confirmLabel="会签并发布"
          impact={
            <div className="flex flex-col gap-1">
              <p>发布后该 agent 立即对<strong className="text-background-foreground">{VISIBILITY_LABEL[approveOf.visibility]}</strong>可用。</p>
              <p>{approveOf.blocker}</p>
              <p className="text-muted-foreground">这是双重门禁的第二签（安全评审人 + 组织管理员），本次确认写入审计。</p>
            </div>
          }
          onCancel={() => setApproveOf(null)}
          onConfirm={() => {
            setApproved((s) => new Set(s).add(approveOf.id));
            setToast(`Agent「${approveOf.name}」已会签放行并发布`);
            setApproveOf(null);
          }}
        />
      )}

      {/* 停用二选一确认（D-U5）*/}
      {disableOf && (
        <DisableDialog
          testid="admin-agent-disable-dialog"
          verb="停用"
          capabilityName={disableOf.name}
          inFlight={inFlightOf(disableOf.id)}
          interruptEffect={`该 agent 正在跑的 ${inFlightOf(disableOf.id)} 个任务会被立即中断，触发方收到「该能力已被管理员停用」。`}
          drainEffect={`已在跑的 ${inFlightOf(disableOf.id)} 个任务跑完当前一轮，此刻起不再受理新的编排调用。`}
          onCancel={() => setDisableOf(null)}
          onConfirm={(mode: DisableMode) => {
            setDisabledIds((prev) => new Set(prev).add(disableOf.id));
            setToast(
              mode === "interrupt"
                ? `已停用 agent「${disableOf.name}」，并立即中断 ${inFlightOf(disableOf.id)} 个进行中的任务`
                : `已停用 agent「${disableOf.name}」；${inFlightOf(disableOf.id)} 个进行中的任务将跑完当前一轮，新调用即刻被拒`,
            );
            setDisableOf(null);
          }}
        />
      )}

      <Toast message={toast} testid="admin-agent-toast" onDismiss={() => setToast(null)} />
    </AdminScreen>
  );
}

/** 注册 / 编辑 / 查看定义 —— 同一抽屉三态：add 空表单、edit 预填、view 只读。 */
function AgentPanel({
  mode, agent, onClose, onSave,
}: {
  mode: "add" | "edit" | "view";
  agent: AgentRow | null;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const readOnly = mode === "view";
  const [name, setName] = React.useState(agent?.name ?? "");
  const [role, setRole] = React.useState(agent?.role ?? "");
  const enabledModels = MODELS.filter((m) => m.status === "enabled");
  const title = mode === "add" ? "注册 agent" : mode === "edit" ? `编辑 · ${agent?.name}` : `定义 · ${agent?.name}`;

  if (readOnly && agent) {
    return (
      <AdminDrawer testid="admin-agent-panel" title={title} subtitle="只读定义（能力维护者视角）" onClose={onClose}>
        <div className="flex flex-col divide-y divide-border-subtle" data-testid="admin-agent-definition">
          <KV k="名称" v={agent.name} />
          <KV k="职责" v={agent.role} />
          <KV k="模型" v={<span className="font-mono">{agent.model}</span>} />
          <KV k="skill 挂载" v={`${agent.skills} 个`} />
          <KV k="可见性范围" v={VISIBILITY_LABEL[agent.visibility] + (agent.team ? ` · ${agent.team}` : "")} />
          <KV k="本月调用" v={`${agent.callsPerMonth.toLocaleString()} 次`} />
        </div>
        {agent.blocker && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-2.5" data-testid="admin-agent-definition-blocker">
            <ShieldQuestion aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-11">工具白名单待会签：{agent.blocker}</p>
          </div>
        )}
      </AdminDrawer>
    );
  }

  return (
    <AdminDrawer
      testid="admin-agent-panel"
      title={title}
      subtitle={mode === "add" ? "创建为草稿，发布走双重门禁" : "改动写入审计"}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} data-testid="admin-agent-panel-cancel">取消</Button>
          <Button size="sm" variant="primary" onClick={() => onSave(name)} data-testid="admin-agent-panel-save">
            {mode === "add" ? "创建草稿" : "保存改动"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="admin-agent-field-name" label="名称" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="如 Ledger" />
        <Field id="admin-agent-field-role" label="职责" value={role} onChange={(e) => setRole(e.currentTarget.value)} placeholder="如 财务建模" />
        <div className="flex flex-col gap-1">
          <span className="text-11 font-medium text-muted-foreground">模型（仅测试通过的可选）</span>
          <div className="flex flex-wrap gap-1.5" data-testid="admin-agent-field-model">
            {enabledModels.slice(0, 6).map((m) => (
              <Badge key={m.id} tone="outline" className="font-mono">{m.name}</Badge>
            ))}
            <Badge tone="neutral">… 共 {enabledModels.length} 个</Badge>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-1.5">
          <span className="text-11 font-medium text-muted-foreground">可见性范围</span>
          <div className="flex gap-1.5">
            <Badge tone="primary">{VISIBILITY_LABEL.org}</Badge>
            <Badge tone="outline">{VISIBILITY_LABEL.team}</Badge>
          </div>
          <p className="text-11 text-muted-foreground">这是「谁能看到、用它」，与 MCP 的「授权范围」不是一回事。</p>
        </div>
      </div>
    </AdminDrawer>
  );
}
