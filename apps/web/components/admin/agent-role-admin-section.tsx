"use client";

/**
 * AG04（契约束 agent-role UC-4，requirements 03-agent-role.md R8）—— 管理详情页新增的
 * 「角色」区块。挂在 `capability-edit-page.tsx` 的 `renderEditExtra` 注入点，与
 * `agent-capability-graph.tsx`（同一注入点的另一块）完全同一条路由/鉴权路径，
 * 不新开第二条。
 *
 * R8 列的五样这里都给：头像（选择，illustration key，非官方可改）、分类
 * （roleCategory，非官方可改）、Workflow 白名单（官方只读、组织自建可编辑）、
 * 能力就绪性清单（`capabilityReadiness`，只读——就绪与否是服务端判定，不是这里能
 * 编的东西）、委派/升级策略（`delegationPolicy`/`escalationPolicy`/`kpi`：本轮只读
 * 展示，编辑器留给后续 design-delta——这三个字段结构比前面复杂得多，硬塞进本轮会议
 * 挤占「能不能先把可见性做对」这个更紧迫的缺口，草稿字段本身已经在 PATCH 里可传，
 * UI 表单不是本轮阻塞项）。
 *
 * 官方 Agent（`catalogSource === "official"`）锁：`view.editable === false`，
 * 所有可编辑控件禁用，同服务端 `OFFICIAL_ROLE_FIELDS_LOCKED` 的纪律（R5）。
 */
import * as React from "react";
import { agentRole } from "@repo/contracts";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { AVATAR_KEYS } from "@/lib/interview-expert-avatar";
import {
  getAgentRoleAdmin,
  updateAgentRoleDraft,
  type AgentRoleAdminView,
} from "@/lib/agent-role-admin";

const ROLE_CATEGORY_LABEL: Record<string, string> = {
  research: "研究", product: "产品", sales: "销售", design: "设计", general: "通用",
};
const ROLE_CATEGORY_OPTIONS = agentRole.AgentRoleCategory.options.map((c) => ({ value: c, label: ROLE_CATEGORY_LABEL[c] ?? c }));
const AVATAR_OPTIONS = [{ value: "", label: "无（回退首字母）" }, ...AVATAR_KEYS.map((k) => ({ value: k, label: k }))];

const READINESS_LABEL: Record<string, { text: string; tone: "success" | "warning" | "neutral" }> = {
  ready: { text: "就绪", tone: "success" },
  missing: { text: "缺失", tone: "warning" },
  unknown: { text: "无法判定", tone: "neutral" },
};

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly view: AgentRoleAdminView };

export function AgentRoleAdminSection({ agentId }: { agentId: string }) {
  const [state, setState] = React.useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [workflowDraft, setWorkflowDraft] = React.useState("");

  const load = React.useCallback(() => {
    setState({ kind: "loading" });
    getAgentRoleAdmin(agentId).then(
      (view) => setState({ kind: "ready", view }),
      (error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setState({ kind: "denied" });
          return;
        }
        setState({ kind: "error", message: error instanceof Error ? error.message : "加载失败" });
      },
    );
  }, [agentId]);

  React.useEffect(() => { load(); }, [load]);

  const applyPatch = React.useCallback(
    async (patch: Parameters<typeof updateAgentRoleDraft>[0]["patch"]) => {
      if (state.kind !== "ready") return;
      setSaving(true);
      setSaveError(null);
      try {
        const view = await updateAgentRoleDraft({ agentId, expectedVersion: state.view.version, patch });
        setState({ kind: "ready", view });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "保存失败");
      } finally {
        setSaving(false);
      }
    },
    [agentId, state],
  );

  if (state.kind === "loading") {
    return <div data-testid="agent-role-admin-loading" className="h-24 animate-pulse rounded-lg bg-muted" />;
  }
  if (state.kind === "denied") {
    return (
      <div data-testid="agent-role-admin-denied" className="rounded-lg border border-border p-4 text-13 text-muted-foreground">
        无权查看该 Agent 的角色区块。
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div data-testid="agent-role-admin-error" className="rounded-lg border border-border p-4 text-13 text-destructive">
        角色区块加载失败：{state.message}
        <Button size="sm" variant="secondary" className="ml-2" onClick={load}>重试</Button>
      </div>
    );
  }

  const { view } = state;
  const draft = view.draft;
  const disabled = !view.editable || saving;

  return (
    <section data-testid="agent-role-admin-section" className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <header className="flex items-center justify-between">
        <h3 className="text-13 font-bold text-background-foreground">角色</h3>
        {!view.editable && <Badge tone="neutral" data-testid="agent-role-admin-locked">官方角色字段只读</Badge>}
      </header>

      <div className="flex items-center gap-4">
        <Avatar
          data-testid="agent-role-admin-avatar-preview"
          initials="?"
          avatarKey={draft.avatar?.key ?? null}
          tone="ai"
          size="lg"
        />
        <div className="flex flex-col gap-1">
          <label className="text-11 text-muted-foreground" htmlFor="agent-role-avatar-select">头像</label>
          <Select
            data-testid="agent-role-admin-avatar-select"
            options={AVATAR_OPTIONS}
            value={draft.avatar?.key ?? ""}
            disabled={disabled}
            onValueChange={(key) => {
              void applyPatch({
                avatar: key === "" ? null : { kind: "illustration", key: key as (typeof AVATAR_KEYS)[number], alt: draft.roleCategory ?? "agent" },
              });
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-11 text-muted-foreground" htmlFor="agent-role-category-select">分类</label>
        <Select
          data-testid="agent-role-admin-category-select"
          options={ROLE_CATEGORY_OPTIONS}
          value={draft.roleCategory ?? undefined}
          placeholder="未分类"
          disabled={disabled}
          onValueChange={(roleCategory) => void applyPatch({ roleCategory: roleCategory as typeof draft.roleCategory })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-11 text-muted-foreground">可发起 Workflow 白名单</span>
        <div data-testid="agent-role-admin-workflow-allowlist" className="flex flex-wrap gap-1.5">
          {draft.workflowAllowlist.length === 0 && <span className="text-12 text-muted-foreground">空</span>}
          {draft.workflowAllowlist.map((stableId) => (
            <Badge key={stableId} tone="neutral" data-testid={`agent-role-admin-workflow-${stableId}`}>
              {stableId}
              {view.editable && (
                <button
                  type="button"
                  aria-label={`移除 ${stableId}`}
                  className="ml-1"
                  disabled={saving}
                  onClick={() => void applyPatch({ workflowAllowlist: draft.workflowAllowlist.filter((id) => id !== stableId) })}
                >
                  ×
                </button>
              )}
            </Badge>
          ))}
        </div>
        {view.editable && (
          <div className="flex items-center gap-2">
            <Input
              data-testid="agent-role-admin-workflow-input"
              placeholder="W001"
              value={workflowDraft}
              onChange={(e) => setWorkflowDraft(e.target.value)}
              className="w-32"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={saving || !/^W\d{3}$/.test(workflowDraft)}
              onClick={() => {
                const next = [...draft.workflowAllowlist, workflowDraft];
                setWorkflowDraft("");
                void applyPatch({ workflowAllowlist: next });
              }}
            >
              添加
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-11 text-muted-foreground">能力就绪状态（只读，服务端判定）</span>
        <div data-testid="agent-role-admin-capability-readiness" className="flex flex-col gap-1">
          {view.capabilityReadiness.length === 0 && <span className="text-12 text-muted-foreground">无声明的能力分类</span>}
          {view.capabilityReadiness.map((entry) => {
            const label = READINESS_LABEL[entry.status] ?? { text: entry.status, tone: "neutral" as const };
            return (
              <div key={entry.category} className="flex items-center justify-between gap-2 text-12">
                <span className="text-card-foreground">{entry.category}</span>
                <Badge tone={label.tone} data-testid={`agent-role-admin-readiness-${entry.category}`}>{label.text}</Badge>
              </div>
            );
          })}
        </div>
      </div>

      {saveError && <p data-testid="agent-role-admin-save-error" className="text-12 text-destructive">保存失败：{saveError}</p>}
    </section>
  );
}
