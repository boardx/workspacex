"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, History, KeyRound, LocateFixed, SearchX } from "lucide-react";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { useSession } from "@/components/session/session-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateShell, type UiState } from "@/components/state/state-shell";
import { cn } from "@/lib/utils";
import {
  listWorkflowCapabilityGrants, revokeWorkflowCapabilityGrant, setWorkflowCapabilityGrant,
  type WorkflowCapabilityAuditEntry, type WorkflowCapabilityGrantsOut,
} from "@/lib/live-workflow-capability-grants";
import { CAP_LEVEL, capabilityCopy, describeWorkflowGrantFailure } from "@/lib/workflow-capability-grant-copy";
import { memberLabel, useOrgMemberNames } from "@/lib/use-org-member-names";
import { findBuiltinWorkflow, workflowDisplayName } from "@/lib/workflow-display-copy";
import { WorkflowGrantDialog } from "./workflow-grant-dialog";
import { capabilityRows, workflowRows, type CapabilityRow } from "./workflow-grant-model";

type View = "capability" | "workflow";

/**
 * `/org-admin/workflow-grants` —— 工作流权限授予（组织 admin）。
 *
 * 内置工作流默认只读（ADR-120 #2）：保存文档、发通知这类会改动组织数据的步骤，要管理员在这里
 * 授权后才会执行，否则运行会停在「权限阻断」。运行详情页的阻断横幅对管理员直接链接到这里
 * （`?workflow=<key>` 聚焦该工作流）。每次授予 / 撤销都由服务端写审计，列在页面底部。
 */
export function WorkflowGrantsScreen() {
  const { session, identity } = useSession();
  const isAdmin = identity?.orgRole === "admin";
  const me = session?.userId ?? null;
  const orgId = session?.currentOrgId ?? null;
  const memberNames = useOrgMemberNames(isAdmin ? orgId : null);

  const [state, setState] = React.useState<UiState>("loading");
  const [failure, setFailure] = React.useState<string | null>(null);
  const [data, setData] = React.useState<WorkflowCapabilityGrantsOut | null>(null);
  const [view, setView] = React.useState<View>("capability");
  const [focusWorkflow, setFocusWorkflow] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<CapabilityRow | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("workflow");
    if (key) { setFocusWorkflow(key); setView("workflow"); }
  }, []);

  const load = React.useCallback(async () => {
    setState("loading");
    setFailure(null);
    try {
      setData(await listWorkflowCapabilityGrants());
      setState("default");
    } catch (err) {
      setFailure(describeWorkflowGrantFailure(err));
      setState("dep-failed");
    }
  }, []);

  React.useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  // 深链落点：数据到位后把匹配的工作流卡片滚到视口并拿到焦点（横幅「去授权」进来的人一眼看到它）。
  const focusedId = data && focusWorkflow ? resolveFocus(workflowRows(data), focusWorkflow)?.workflow.workflowId ?? null : null;
  React.useEffect(() => {
    if (!focusedId || view !== "workflow") return;
    const el = document.getElementById(`workflow-grants-card-${focusedId}`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    el?.focus({ preventScroll: true });
  }, [focusedId, view]);

  async function confirm(level: "read" | "write" | "external_send") {
    if (!editing) return;
    const label = capabilityCopy(editing.category).label;
    setBusy(true);
    setDialogError(null);
    try {
      if (level === "read") await revokeWorkflowCapabilityGrant(editing.category);
      else await setWorkflowCapabilityGrant(editing.category, level);
      setEditing(null);
      setNotice(level === "read" ? `已撤销「${label}」，恢复为只读。` : `已授予「${label}」${CAP_LEVEL[level].label}权限。`);
      // 重新拉一次：另一位管理员可能同时改了别的项，本地推断会和服务端不一致。
      setData(await listWorkflowCapabilityGrants());
    } catch (err) {
      setDialogError(describeWorkflowGrantFailure(err));
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <GrantsShell>
        <StateShell state="denied" denial={{ layer: "organization", reason: "工作流权限仅组织管理员可以查看和调整。需要授权时，请联系本组织的管理员。" }}>
          {null}
        </StateShell>
      </GrantsShell>
    );
  }

  const caps = data ? capabilityRows(data) : [];
  const flows = data ? workflowRows(data) : [];
  const blockedFlows = flows.filter((f) => !f.ready).length;
  const focused = focusWorkflow ? resolveFocus(flows, focusWorkflow) : null;

  return (
    <GrantsShell>
      <StateShell state={state} skeletonRows={4} depFailure={{ what: failure ?? "工作流权限服务暂时不可用", retry: () => void load() }}>
        {data ? (
          <div className="flex flex-col gap-6">
            <div
              data-testid="workflow-grants-summary"
              className={cn(
                "flex items-start gap-3 rounded-lg border p-4",
                blockedFlows > 0 ? "border-warning bg-warning-tint text-warning-tint-foreground" : "border-border bg-card",
              )}
            >
              {blockedFlows > 0
                ? <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                : <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />}
              <div className="flex flex-col gap-0.5">
                <p className="text-13 font-medium">
                  {blockedFlows > 0
                    ? `${flows.length} 个内置工作流中，有 ${blockedFlows} 个会因权限不足在中途暂停`
                    : `${flows.length} 个内置工作流所需的权限都已授予`}
                </p>
                <p className="text-12 opacity-80">授权按能力生效：给一项能力授权，本组织所有用到它的工作流都会同时获得。</p>
              </div>
            </div>

            {notice ? (
              <p role="status" data-testid="workflow-grants-notice" className="rounded-control border border-border bg-card px-3 py-2 text-12">{notice}</p>
            ) : null}

            <div role="tablist" aria-label="查看方式" className="flex gap-1 border-b border-border">
              {([["capability", "按能力"], ["workflow", "按工作流"]] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`workflow-grants-tab-${key}`}
                  aria-selected={view === key}
                  aria-controls={`workflow-grants-panel-${key}`}
                  onClick={() => setView(key)}
                  data-testid={`workflow-grants-tab-${key}`}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2 text-12 font-medium transition-colors duration-fast",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    view === key ? "border-primary text-card-foreground" : "border-transparent text-muted-foreground hover:text-card-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === "workflow" && focusWorkflow ? (
              focused ? (
                <p role="status" data-testid="workflow-grants-focus-chip" className="inline-flex w-fit items-center gap-1.5 rounded-control border border-primary bg-card px-2 py-1 text-12">
                  <LocateFixed aria-hidden className="h-3.5 w-3.5 text-primary" />
                  已定位到「{workflowDisplayName(focused.workflow.workflowKey, focused.workflow.title)}」
                </p>
              ) : (
                <p role="alert" data-testid="workflow-grants-focus-missing" className="inline-flex w-fit items-center gap-1.5 rounded-control border border-warning bg-warning-tint px-2 py-1 text-12 text-warning-tint-foreground">
                  <SearchX aria-hidden className="h-3.5 w-3.5" />
                  找不到该工作流，它可能不是内置工作流或已下线。下面列出全部内置工作流。
                </p>
              )
            ) : null}

            {view === "capability" ? (
              <section role="tabpanel" id="workflow-grants-panel-capability" aria-labelledby="workflow-grants-tab-capability">
                {caps.length === 0 ? (
                  <p className="text-12 text-muted-foreground" data-testid="workflow-grants-empty">内置工作流目前没有需要授权的操作。</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {caps.map((row) => <CapabilityCard key={row.category} row={row} onEdit={() => { setDialogError(null); setNotice(null); setEditing(row); }} />)}
                  </ul>
                )}
              </section>
            ) : (
              <section role="tabpanel" id="workflow-grants-panel-workflow" aria-labelledby="workflow-grants-tab-workflow">
                <ul className="flex flex-col gap-3">
                  {flows.map((f) => {
                    const isFocused = focused === f;
                    return (
                    <li
                      key={f.workflow.workflowId}
                      id={`workflow-grants-card-${f.workflow.workflowId}`}
                      tabIndex={isFocused ? -1 : undefined}
                      data-testid={`workflow-grants-workflow-${f.workflow.workflowId}`}
                      data-focused={isFocused ? "true" : undefined}
                      aria-current={isFocused ? "location" : undefined}
                      className={cn("flex scroll-mt-6 flex-col gap-2 rounded-lg border bg-card p-4",
                        isFocused ? "border-primary ring-2 ring-ring ring-offset-2 ring-offset-background outline-none" : "border-border")}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-13 font-semibold">{workflowDisplayName(f.workflow.workflowKey, f.workflow.title)}</h3>
                        {f.ready ? <Badge tone="success">可以完整运行</Badge> : <Badge tone="warning">会在中途暂停</Badge>}
                      </div>
                      <ul className="flex flex-col gap-1.5">
                        {f.items.map((i) => {
                          const row = caps.find((c) => c.category === i.category);
                          return (
                            <li key={i.category} className="flex flex-wrap items-center justify-between gap-2 text-12">
                              <span className="flex items-center gap-2">
                                {i.ok ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-success" /> : <CircleAlert aria-hidden className="h-3.5 w-3.5 text-warning-tint-foreground" />}
                                <span>{capabilityCopy(i.category).label}</span>
                                <span className="text-muted-foreground">需要「{CAP_LEVEL[i.requiredCap].label}」，当前「{CAP_LEVEL[i.current].label}」</span>
                              </span>
                              {!i.ok && row ? (
                                <Button size="xs" variant="outline" onClick={() => { setDialogError(null); setNotice(null); setEditing(row); }}>去授权</Button>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <AuditTrail entries={data.audit} me={me} names={memberNames} />
          </div>
        ) : null}
      </StateShell>

      <WorkflowGrantDialog row={editing} busy={busy} error={dialogError} onCancel={() => setEditing(null)} onConfirm={(l) => void confirm(l)} />
    </GrantsShell>
  );
}

function CapabilityCard({ row, onEdit }: { row: CapabilityRow; onEdit: () => void }) {
  const copy = capabilityCopy(row.category);
  const needsGrant = row.blocked.length > 0;
  const granted = row.current !== "read" && row.current !== "none";
  // 已授予过（哪怕仍有工作流要更高等级）一律叫「调整权限」；从未授予才叫「授予权限」。
  const cta = granted ? "调整权限" : "授予权限";
  return (
    <li data-testid={`workflow-grant-row-${row.category}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-14 font-semibold">{copy.label}</h3>
            <Badge tone={granted ? "primary" : "neutral"} data-testid="workflow-grant-current">
              当前：{CAP_LEVEL[row.current].label}
            </Badge>
          </div>
          <p className="text-12 text-muted-foreground">{copy.allows}</p>
        </div>
        <Button
          size="sm"
          variant={needsGrant ? "primary" : "outline"}
          onClick={onEdit}
          data-testid="workflow-grant-edit"
          aria-label={`${cta}：${copy.label}`}
        >
          {cta}
        </Button>
      </div>
      <div className="flex flex-col gap-1 text-12">
        <p className="text-muted-foreground">用到它的工作流及各自需要的等级：</p>
        <ul className="flex flex-wrap gap-1.5">
          {row.uses.map((u) => {
            const blocked = row.blocked.includes(u);
            return (
              <li key={u.workflowId} data-testid={`workflow-grant-use-${row.category}-${u.workflowId}`}>
                <span className={cn("inline-flex items-center gap-1 rounded-control border px-2 py-0.5",
                  blocked ? "border-warning bg-warning-tint text-warning-tint-foreground" : "border-border")}>
                  {blocked ? <CircleAlert aria-hidden className="h-3 w-3" /> : <CheckCircle2 aria-hidden className="h-3 w-3 text-success" />}
                  {workflowDisplayName(u.workflowKey, u.title)}
                  <span className="text-muted-foreground">· 需要「{CAP_LEVEL[u.requiredCap].label}」</span>
                  <span className="sr-only">{blocked ? "（权限不足，会暂停）" : "（可以运行）"}</span>
                </span>
              </li>
            );
          })}
        </ul>
        {needsGrant ? (
          <p className="text-warning-tint-foreground" data-testid="workflow-grant-shortfall">
            当前「{CAP_LEVEL[row.current].label}」不够：
            {row.blocked.map((u) => `「${workflowDisplayName(u.workflowKey, u.title)}」需要「${CAP_LEVEL[u.requiredCap].label}」`).join("、")}，
            这些工作流会在对应步骤暂停。
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AuditTrail({ entries, me, names }: { entries: readonly WorkflowCapabilityAuditEntry[]; me: string | null; names: ReadonlyMap<string, string> }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="workflow-grants-audit-title" data-testid="workflow-grants-audit">
      <div className="flex items-center gap-2">
        <History aria-hidden className="h-4 w-4 text-muted-foreground" />
        <h2 id="workflow-grants-audit-title" className="text-14 font-semibold">变更记录</h2>
      </div>
      {entries.length === 0 ? (
        <p className="text-12 text-muted-foreground" data-testid="workflow-grants-audit-empty">还没有人调整过工作流权限，当前全部为默认的只读。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-12">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">时间</th>
                <th scope="col" className="px-3 py-2 font-medium">操作人</th>
                <th scope="col" className="px-3 py-2 font-medium">能力</th>
                <th scope="col" className="px-3 py-2 font-medium">变更</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.eventId} className="border-t border-border" data-testid="workflow-grants-audit-row">
                  <td className="whitespace-nowrap px-3 py-2">{formatAuditTime(e.at)}</td>
                  <td className="px-3 py-2" data-testid="workflow-grants-audit-actor">{memberLabel(e.actorId, me, names)}</td>
                  <td className="px-3 py-2">{capabilityCopy(e.capabilityCategory).label}</td>
                  <td className="px-3 py-2">
                    <Badge tone={e.action === "revoked" ? "outline" : "primary"}>{e.action === "revoked" ? "撤销" : "授予"}</Badge>
                    <span className="ml-2 text-muted-foreground">{CAP_LEVEL[e.fromCap].label} → {CAP_LEVEL[e.toCap].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function GrantsShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell previewRole={null} left={<AdminNav active="workflow-grants" />}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6" data-testid="workflow-grants-screen">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <KeyRound aria-hidden className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-16 font-semibold tracking-tight">工作流权限</h1>
          </div>
          <p className="text-12 text-muted-foreground">
            内置工作流默认只能查看数据。保存文档、发送通知、更新看板这类会改动组织数据的步骤，需要你在这里授权后才会执行；
            未授权时，工作流会停在对应步骤并提示成员联系管理员。
          </p>
        </div>
        {children}
      </div>
    </AppShell>
  );
}

/** `?workflow=` 同时接受 workflowId（W029）与 key（problem-to-prd），大小写不敏感。 */
function resolveFocus<T extends { workflow: { workflowId: string; workflowKey: string } }>(rows: readonly T[], raw: string): T | null {
  const q = raw.trim().toLowerCase();
  const builtin = findBuiltinWorkflow(q);
  return rows.find((r) => {
    const id = r.workflow.workflowId.toLowerCase();
    const key = r.workflow.workflowKey.toLowerCase();
    return id === q || key === q || (builtin !== null && (id === builtin.workflowId.toLowerCase() || key === builtin.key));
  }) ?? null;
}

const AUDIT_TIME = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
function formatAuditTime(iso: string): string {
  return AUDIT_TIME.format(new Date(iso));
}
