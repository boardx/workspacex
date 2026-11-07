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
import { useI18n } from "@/lib/i18n/provider";
import { memberFailure, formatMemberTokens, type MemberFeedback } from "@/lib/admin-member-copy";
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

export function LimitRulesLive() {
  const { t, locale } = useI18n();
  const SCOPE_LABEL = { member: t("adminLimitPolicy.scope.member"), role: t("adminLimitPolicy.scope.role"), team: t("adminLimitPolicy.scope.team"), agent: t("adminLimitPolicy.scope.agent"), model: t("adminLimitPolicy.scope.model") } satisfies Record<LimitScopeKind, string>;
  const WINDOW_LABEL = { hour: t("adminLimitPolicy.window.hour"), day: t("adminLimitPolicy.window.day"), week: t("adminLimitPolicy.window.week"), month: t("adminLimitPolicy.window.month") } satisfies Record<LimitWindowKind, string>;
  const ACTION_LABEL = { warn: t("adminLimitPolicy.action.warn"), degrade: t("adminLimitPolicy.action.degrade"), block: t("adminLimitPolicy.action.block"), require_approval: t("adminLimitPolicy.action.require_approval") } satisfies Record<LimitAction, string>;
  const fmt = (n: number) => formatMemberTokens(n, locale);
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [data, setData] = React.useState<ListLimitRulesOut | null>(null);
  const [error, setError] = React.useState<MemberFeedback | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<Rule | null>(null);
  const [draftCap, setDraftCap] = React.useState("");
  const [formError, setFormError] = React.useState<MemberFeedback | null>(null);
  const [toast, setToast] = React.useState<MemberFeedback | null>(null);
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
      setError((): MemberFeedback => (t, locale) => t("adminLimitPolicy.failed", { error: memberFailure(err, locale) }));
    }
  }, [orgId]);

  React.useEffect(() => { void load(); }, [load]);

  const describeError = (err: unknown): MemberFeedback => (t, locale) => {
    const code = err instanceof ApiError ? err.reasonCode : null;
    if (code === "DEGRADE_TARGET_REQUIRED") return t("adminLimitPolicy.degradeRequired");
    if (code === "LIMIT_RULE_NOT_FOUND") return t("adminLimitPolicy.missing");
    return memberFailure(err, locale);
  };

  const submitCreate = async () => {
    if (!orgId) return;
    const cap = Number(threshold);
    if (!Number.isFinite(cap) || cap <= 0) { setFormError((): MemberFeedback => (t) => t("adminLimitPolicy.positive")); return; }
    if (scopeRef.trim() === "") { setFormError((): MemberFeedback => (t) => t("adminLimitPolicy.scopeRequired")); return; }
    setFormError(null);
    try {
      await createLimitRule(orgId, {
        scopeKind, scopeRef: scopeRef.trim(), modelId: null, windowKind,
        thresholdTokens: Math.trunc(cap), action,
        degradeToModelId: action === "degrade" ? (degradeTo.trim() || null) : null,
      });
      setCreating(false);
      setScopeRef(""); setThreshold(""); setDegradeTo("");
      setToast((): MemberFeedback => (t) => t("adminLimitPolicy.added"));
      await load();
    } catch (err) {
      setFormError((): MemberFeedback => describeError(err));
    }
  };

  const submitEdit = async () => {
    if (!orgId || !editing) return;
    const cap = Number(draftCap);
    if (!Number.isFinite(cap) || cap <= 0) { setFormError((): MemberFeedback => (t) => t("adminLimitPolicy.positive")); return; }
    setFormError(null);
    try {
      await updateLimitRule(orgId, editing.ruleId, { thresholdTokens: Math.trunc(cap) });
      setEditing(null);
      setToast((): MemberFeedback => (t) => t("adminLimitPolicy.updated"));
      await load();
    } catch (err) {
      setFormError((): MemberFeedback => describeError(err));
    }
  };

  const toggle = async (rule: Rule) => {
    if (!orgId) return;
    try {
      await updateLimitRule(orgId, rule.ruleId, { enabled: !rule.enabled });
      await load();
    } catch (err) {
      setToast((): MemberFeedback => describeError(err));
    }
  };

  const remove = async (rule: Rule) => {
    if (!orgId) return;
    try {
      await deleteLimitRule(orgId, rule.ruleId);
      // 规则没了，但它触发过的事件留着——「上个月他被降级过三次」不因为配置被改而消失。
      setToast((): MemberFeedback => (t) => t("adminLimitPolicy.deleted"));
      await load();
    } catch (err) {
      setToast((): MemberFeedback => describeError(err));
    }
  };

  if (!orgId) return <p className="text-12 text-muted-foreground">{t("adminLimitPolicy.noOrg")}</p>;
  if (error) {
    return (
      <Card data-testid="admin-limit-rules-failed">
        <CardContent className="flex flex-wrap items-center gap-2 p-3 text-12">
          <span className="text-destructive">{error(t, locale)}</span>
          <Button size="xs" variant="outline" onClick={() => void load()}>{t("adminLimitPolicy.retry")}</Button>
        </CardContent>
      </Card>
    );
  }
  if (!data) return <p className="text-12 text-muted-foreground">{t("adminLimitPolicy.loading")}</p>;

  return (
    <div className="flex flex-col gap-3" data-testid="admin-limit-rules-live">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-11 text-muted-foreground">{t("adminLimitPolicy.count", { count: data.rules.length })}</span>
        <ViewModeToggle module="limits" mode={viewMode} onChange={setViewMode} />
        <Button size="xs" variant="primary" className="ml-auto" data-testid="admin-limit-rule-new"
          onClick={() => { setCreating(true); setFormError(null); }}>
          <Plus aria-hidden className="h-3.5 w-3.5" />
          {t("adminLimitPolicy.new")}
        </Button>
      </div>

      {data.rules.length === 0 && (
        <p className="text-12 text-muted-foreground" data-testid="admin-limit-rules-empty">
          {t("adminLimitPolicy.empty")}
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
                  "min-w-0 flex flex-col gap-2.5 rounded-lg border p-3 " +
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
                    label={t("adminLimitPolicy.enabled", { name: r.scopeRef })}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2 text-11 [&>div]:min-w-0">
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">{t("adminLimitPolicy.model")}</div>
                    <div className="truncate font-mono text-11">{r.modelId ?? t("adminLimitPolicy.allModels")}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">{t("adminLimitPolicy.window")}</div>
                    <div className="text-11">{WINDOW_LABEL[r.windowKind]}</div>
                  </div>
                  <div>
                    <div className="mb-1 text-10 text-muted-foreground">{t("adminLimitPolicy.cap")}</div>
                    <div className="font-mono text-11">{fmt(r.thresholdTokens)} token</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-11">
                  {noMetric ? (
                    // 不画 0%：一条永远不会触发的规则不该看起来在正常工作。
                    <span className="text-muted-foreground" data-testid={`admin-limit-rule-nometric-${r.ruleId}`}>
                      {t("adminLimitPolicy.noMetric")}
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
                        {t("adminLimitPolicy.used", { amount: fmt(r.observedTokens), pct })}
                      </span>
                    </>
                  )}
                  <span className="ml-auto min-w-0 break-words text-11 [overflow-wrap:anywhere]">
                    {t("adminLimitPolicy.atCap")}{ACTION_LABEL[r.action]}
                    {r.action === "degrade" && r.degradeToModelId ? ` → ${r.degradeToModelId}` : ""}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" data-testid={`admin-limit-rule-edit-${r.ruleId}`}
                    onClick={() => { setEditing(r); setDraftCap(String(r.thresholdTokens)); setFormError(null); }}>
                    {t("adminLimitPolicy.edit")}
                  </Button>
                  <Button size="xs" variant="ghost" data-testid={`admin-limit-rule-delete-${r.ruleId}`}
                    onClick={() => void remove(r)}>
                    <Trash2 aria-hidden className="h-3.5 w-3.5" />
                    {t("adminLimitPolicy.delete")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <AdminModal
          title={t("adminLimitPolicy.createTitle")}
          testid="admin-limit-rule-create-modal"
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>{t("adminLimitPolicy.cancel")}</Button>
              <Button size="sm" variant="primary" onClick={() => void submitCreate()}
                data-testid="admin-limit-rule-create-save">{t("adminLimitPolicy.save")}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-scope-kind">{t("adminLimitPolicy.scope")}</label>
            <select id="admin-limit-scope-kind" data-testid="admin-limit-scope-kind"
              className="min-w-0 w-full h-8 rounded-md border border-border bg-card px-2 text-12"
              value={scopeKind} onChange={(e) => setScopeKind(e.target.value as LimitScopeKind)}>
              {(Object.keys(SCOPE_LABEL) as LimitScopeKind[]).map((k) => (
                <option key={k} value={k}>{SCOPE_LABEL[k]}</option>
              ))}
            </select>
            <Field id="admin-limit-scope-ref" label={t("adminLimitPolicy.scopeTarget")}
              value={scopeRef} onChange={(e) => setScopeRef(e.target.value)}
              data-testid="admin-limit-scope-ref" />
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-window">{t("adminLimitPolicy.window")}</label>
            <select id="admin-limit-window" data-testid="admin-limit-window"
              className="min-w-0 w-full h-8 rounded-md border border-border bg-card px-2 text-12"
              value={windowKind} onChange={(e) => setWindowKind(e.target.value as LimitWindowKind)}>
              {(Object.keys(WINDOW_LABEL) as LimitWindowKind[]).map((k) => (
                <option key={k} value={k}>{WINDOW_LABEL[k]}</option>
              ))}
            </select>
            <Field id="admin-limit-threshold" label={t("adminLimitPolicy.tokenCap")} inputMode="numeric"
              value={threshold} onChange={(e) => setThreshold(e.target.value)}
              data-testid="admin-limit-threshold" />
            <label className="text-11 font-medium text-muted-foreground" htmlFor="admin-limit-action">{t("adminLimitPolicy.action")}</label>
            <select id="admin-limit-action" data-testid="admin-limit-action"
              className="min-w-0 w-full h-8 rounded-md border border-border bg-card px-2 text-12"
              value={action} onChange={(e) => setAction(e.target.value as LimitAction)}>
              {(Object.keys(ACTION_LABEL) as LimitAction[]).map((k) => (
                <option key={k} value={k}>{ACTION_LABEL[k]}</option>
              ))}
            </select>
            {/* 选了降级才出现目标模型：不让用户撞一次 400 才知道它是必填的。 */}
            {action === "degrade" && (
              <Field id="admin-limit-degrade-to" label={t("adminLimitPolicy.target")}
                value={degradeTo} onChange={(e) => setDegradeTo(e.target.value)}
                data-testid="admin-limit-degrade-to" />
            )}
            {formError && (
              <p className="text-11 text-destructive" data-testid="admin-limit-rule-error">{formError(t, locale)}</p>
            )}
          </div>
        </AdminModal>
      )}

      {editing && (
        <AdminModal
          title={t("adminLimitPolicy.editTitle", { name: editing.scopeRef })}
          testid="admin-limit-rule-edit-modal"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("adminLimitPolicy.cancel")}</Button>
              <Button size="sm" variant="primary" onClick={() => void submitEdit()}
                data-testid="admin-limit-rule-edit-save">{t("adminLimitPolicy.save")}</Button>
            </>
          }
        >
          <Field id="admin-limit-edit-threshold" label={t("adminLimitPolicy.tokenCap")} inputMode="numeric"
            value={draftCap} onChange={(e) => setDraftCap(e.target.value)}
            data-testid="admin-limit-edit-threshold" />
          {formError && (
            <p className="text-11 text-destructive" data-testid="admin-limit-rule-error">{formError(t, locale)}</p>
          )}
        </AdminModal>
      )}

      <Toast message={toast ? toast(t, locale) : null} testid="admin-limit-rules-toast" onDismiss={() => setToast(null)} />
    </div>
  );
}
