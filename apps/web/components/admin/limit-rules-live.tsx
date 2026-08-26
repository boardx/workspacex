"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { AdminModal, Field, Toast } from "./panel";
import { ViewModeToggle, type EntityViewMode } from "./view-mode-toggle";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import {
  createLimitRule, deleteLimitRule, listLimitRules, updateLimitRule,
  type ListLimitRulesOut, type LimitAction, type LimitScopeKind, type LimitWindowKind,
} from "@/lib/live-org-admin";

/**
 * F162 —— 限额规则列表的**真栈**实现。
 *
 * 只替换「限额规则」这一块。同屏的「降级阈值三级」与「按任务分级」仍是 mock：
 * 它们属 phase-03 F14（异常检测处置矩阵）的地盘，那条 feature 有自己的签核，
 * 本轮只借它「取最先触发」的语义，不把它的界面顺手做掉。那两块自带提示。
 *
 * ## 三处如实
 *
 * ① **百分比来自服务端**（`usedRatio`）。两条规则的窗口可以不同（一条 5 小时、一条按月），
 *    前端拿一个分子去除不同分母，会得到两个同时显示、互相矛盾的百分比。
 * ② **`agent` 范围的规则显示「该范围暂无计量维度」**而不是 0%：计量事件里没有 agent
 *    维度（具名缺口 `GAP-LIMIT-AGENT-SCOPE`），一条永远不会触发的规则不该看起来在正常工作。
 * ③ **动作选「自动降级」时必须选目标模型**，否则保存被服务端拒（`DEGRADE_TARGET_REQUIRED`）。
 *    界面在提交前就把那个下拉显出来，不让用户撞一次 400 才知道。
 */

type Rule = ListLimitRulesOut["rules"][number];

const SCOPE_LABEL: Record<LimitScopeKind, string> = {
  member: "个人", role: "角色", team: "团队", agent: "Agent", model: "模型",
};
const WINDOW_LABEL: Record<LimitWindowKind, string> = {
  hour: "每小时（滚动）", day: "每天", week: "每周（自然周）", month: "每月",
};
const ACTION_LABEL: Record<LimitAction, string> = {
  warn: "仅预警", degrade: "自动降级", block: "拒绝调用", require_approval: "需人工批准",
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(0)} 万`;
  return n.toLocaleString();
}

export function LimitRulesLive() {
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [data, setData] = React.useState<ListLimitRulesOut | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Rule | null>(null);
  const [draftCap, setDraftCap] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  /** 限额规则是一条条规则的 entity 列表——默认卡片视图，可切列表。 */
  const [viewMode, setViewMode] = React.useState<EntityViewMode>("card");

  // 新建表单
  const [scopeKind, setScopeKind] = React.useState<LimitScopeKind>("member");
  const [scopeRef, setScopeRef] = React.useState("");
  const [windowKind, setWindowKind] = React.useState<LimitWindowKind>("day");
  const [threshold, setThreshold] = React.useState("");
  const [action, setAction] = React.useState<LimitAction>("warn");
  const [degradeTo, setDegradeTo] = React.useState("");

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setError(null);
    try {
      setData(await listLimitRules(orgId));
    } catch (err) {
      setError(err instanceof ApiError ? (err.reasonCode ?? `http_${err.status}`) : String(err));
    }
  }, [orgId]);

  React.useEffect(() => { void load(); }, [load]);

  const describeError = (err: unknown): string => {
    const code = err instanceof ApiError ? err.reasonCode : null;
    if (code === "DEGRADE_TARGET_REQUIRED") return "选了「自动降级」就必须指定降到哪个模型——不指定等于运行时静默换模型。";
    if (code === "LIMIT_RULE_NOT_FOUND") return "这条规则已经不存在了（可能刚被另一位管理员删掉）。";
    return code ?? String(err);
  };

  const submitCreate = async () => {
    if (!orgId) return;
    const cap = Number(threshold);
    if (!Number.isFinite(cap) || cap <= 0) { setFormError("阈值要是一个正整数"); return; }
    if (scopeRef.trim() === "") { setFormError("请填作用对象"); return; }
    setFormError(null);
    try {
      await createLimitRule(orgId, {
        scopeKind, scopeRef: scopeRef.trim(), modelId: null, windowKind,
        thresholdTokens: Math.trunc(cap), action,
        degradeToModelId: action === "degrade" ? (degradeTo.trim() || null) : null,
      });
      setCreating(false);
      setScopeRef(""); setThreshold(""); setDegradeTo("");
      setToast("限额规则已新增");
      await load();
    } catch (err) {
      setFormError(describeError(err));
    }
  };

  const submitEdit = async () => {
    if (!orgId || !editing) return;
    const cap = Number(draftCap);
    if (!Number.isFinite(cap) || cap <= 0) { setFormError("阈值要是一个正整数"); return; }
    setFormError(null);
    try {
      await updateLimitRule(orgId, editing.ruleId, { thresholdTokens: Math.trunc(cap) });
      setEditing(null);
      setToast("阈值已更新");
      await load();
    } catch (err) {
      setFormError(describeError(err));
    }
  };

  const toggle = async (rule: Rule) => {
    if (!orgId) return;
    try {
      await updateLimitRule(orgId, rule.ruleId, { enabled: !rule.enabled });
      await load();
    } catch (err) {
      setToast(describeError(err));
    }
  };

  const remove = async (rule: Rule) => {
    if (!orgId) return;
    try {
      await deleteLimitRule(orgId, rule.ruleId);
      // 规则没了，但它触发过的事件留着——「上个月他被降级过三次」不因为配置被改而消失。
      setToast("规则已删除（它触发过的历史事件保留）");
      await load();
    } catch (err) {
      setToast(describeError(err));
    }
  };

  if (!orgId) return <p className="text-12 text-muted-foreground">尚未选择组织。</p>;
  if (error) {
    return (
      <Card data-testid="admin-limit-rules-failed">
        <CardContent className="flex items-center gap-2 p-3 text-12">
          <span className="text-destructive">限额规则读取失败：{error}</span>
          <Button size="xs" variant="outline" onClick={() => void load()}>重试</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <p className="text-12 text-muted-foreground">正在读取限额规则…</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="admin-limit-rules-live">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-11 text-muted-foreground">共 {data.rules.length} 条规则</span>
        <ViewModeToggle module="limits" mode={viewMode} onChange={setViewMode} />
        <Button size="xs" variant="primary" className="ml-auto" data-testid="admin-limit-rule-new"
          onClick={() => { setCreating(true); setFormError(null); }}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          新增规则
        </Button>
      </div>

      {data.rules.length === 0 && (
        <p className="text-12 text-muted-foreground" data-testid="admin-limit-rules-empty">
          还没有配置任何限额规则。
        </p>
      )}

      {data.rules.length > 0 && (
        <div
          className={
            viewMode === "card"
              ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
              : "flex flex-col gap-3"
          }
          data-testid={viewMode === "card" ? "admin-limit-rules-cards" : "admin-limit-rules-list"}
        >
          {data.rules.map((r) => {
            const pct = Math.round(r.usedRatio * 100);
            const noMetric = r.scopeKind === "agent";
            return (
              <div
                key={r.ruleId}
                data-testid={`admin-limit-rule-${r.ruleId}`}
                className={
                  "flex flex-col gap-2.5 rounded-lg border p-3 " +
                  (pct >= 90 && !noMetric ? "border-warning/40 bg-warning/5" : "border-border bg-card")
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="outline">{SCOPE_LABEL[r.scopeKind]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-12 font-medium">{r.scopeRef}</span>
                  <Toggle
                    id={`admin-limit-rule-toggle-${r.ruleId}`}
                    data-testid={`admin-limit-rule-toggle-${r.ruleId}`}
                    checked={r.enabled}
                    onCheckedChange={() => void toggle(r)}
                    label={`${r.scopeRef} 规则启用状态`}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-11">
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">适用模型</div>
                    <div className="truncate font-mono text-11">{r.modelId ?? "全部模型"}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">窗口</div>
                    <div className="text-11">{WINDOW_LABEL[r.windowKind]}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">上限</div>
                    <div className="font-mono text-11">{fmt(r.thresholdTokens)} token</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-11">
                  {noMetric ? (
                    // 不画 0%：一条永远不会触发的规则不该看起来在正常工作。
                    <span className="text-muted-foreground" data-testid={`admin-limit-rule-nometric-${r.ruleId}`}>
                      该范围暂无计量维度（用量按 Agent 归集尚未实现），本规则当前不会触发
                    </span>
                  ) : (
                    <>
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-inverse"}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <span className="font-mono text-10" data-testid={`admin-limit-rule-used-${r.ruleId}`}>
                        已用 {fmt(r.observedTokens)}（{pct}%）
                      </span>
                    </>
                  )}
                  <span className="ml-auto text-11">
                    触顶动作：{ACTION_LABEL[r.action]}
                    {r.action === "degrade" && r.degradeToModelId ? ` → ${r.degradeToModelId}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="xs" variant="outline" data-testid={`admin-limit-rule-edit-${r.ruleId}`}
                    onClick={() => { setEditing(r); setDraftCap(String(r.thresholdTokens)); setFormError(null); }}>
                    改阈值
                  </Button>
                  <Button size="xs" variant="ghost" data-testid={`admin-limit-rule-delete-${r.ruleId}`}
                    onClick={() => void remove(r)}>
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <AdminModal
          title="新增限额规则"
          testid="admin-limit-rule-create-modal"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>取消</Button>
              <Button size="sm" variant="primary" onClick={() => void submitCreate()}
                data-testid="admin-limit-rule-create-save">保存</Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-scope-kind">范围</label>
            <select id="admin-limit-scope-kind" data-testid="admin-limit-scope-kind"
              className="h-8 rounded-md border border-border bg-card px-2 text-12"
              value={scopeKind} onChange={(e) => setScopeKind(e.target.value as LimitScopeKind)}>
              {(Object.keys(SCOPE_LABEL) as LimitScopeKind[]).map((k) => (
                <option key={k} value={k}>{SCOPE_LABEL[k]}</option>
              ))}
            </select>
            <Field id="admin-limit-scope-ref" label="作用对象（用户 id / 角色 / 团队 id / 模型 id）"
              value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}
              data-testid="admin-limit-scope-ref" />
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-window">窗口</label>
            <select id="admin-limit-window" data-testid="admin-limit-window"
              className="h-8 rounded-md border border-border bg-card px-2 text-12"
              value={windowKind} onChange={(e) => setWindowKind(e.target.value as LimitWindowKind)}>
              {(Object.keys(WINDOW_LABEL) as LimitWindowKind[]).map((k) => (
                <option key={k} value={k}>{WINDOW_LABEL[k]}</option>
              ))}
            </select>
            <Field id="admin-limit-threshold" label="上限（token）" inputMode="numeric"
              value={threshold} onChange={(e) => setThreshold(e.target.value)}
              data-testid="admin-limit-threshold" />
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-action">触顶动作</label>
            <select id="admin-limit-action" data-testid="admin-limit-action"
              className="h-8 rounded-md border border-border bg-card px-2 text-12"
              value={action} onChange={(e) => setAction(e.target.value as LimitAction)}>
              {(Object.keys(ACTION_LABEL) as LimitAction[]).map((k) => (
                <option key={k} value={k}>{ACTION_LABEL[k]}</option>
              ))}
            </select>
            {/* 选了降级才出现目标模型：不让用户撞一次 400 才知道它是必填的。 */}
            {action === "degrade" && (
              <Field id="admin-limit-degrade-to" label="降级到哪个模型（必填）"
                value={degradeTo} onChange={(e) => setDegradeTo(e.target.value)}
                data-testid="admin-limit-degrade-to" />
            )}
            {formError && (
              <p className="text-11 text-destructive" data-testid="admin-limit-rule-error">{formError}</p>
            )}
          </div>
        </AdminModal>
      )}

      {editing && (
        <AdminModal
          title={`改阈值 · ${editing.scopeRef}`}
          testid="admin-limit-rule-edit-modal"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>取消</Button>
              <Button size="sm" variant="primary" onClick={() => void submitEdit()}
                data-testid="admin-limit-rule-edit-save">保存</Button>
            </>
          }
        >
          <Field id="admin-limit-edit-threshold" label="上限（token）" inputMode="numeric"
            value={draftCap} onChange={(e) => setDraftCap(e.target.value)}
            data-testid="admin-limit-edit-threshold" />
          {formError && (
            <p className="text-11 text-destructive" data-testid="admin-limit-rule-error">{formError}</p>
          )}
        </AdminModal>
      )}

      <Toast message={toast} testid="admin-limit-rules-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
