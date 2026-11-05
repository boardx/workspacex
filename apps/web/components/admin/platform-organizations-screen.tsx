"use client";
import * as React from "react";
import {useOptionalSession} from "@/components/session/session-provider";
import {useAuthenticatedSessionScope} from "@/lib/authenticated-session-scope";
import {EnterpriseManagementPanel} from "./enterprise-management-panel";
import { AiUsagePanel } from "./ai-usage-panel";
import { AdminScreen } from "./admin-screen";
import {AiPolicyPanel} from "./ai-policy-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { listPlatformOrganizations, getPlatformOrganization, setPlatformOrganizationPlan,
  type OrganizationList, type OrganizationDetail, type PlanInput } from "@/lib/live-platform-organizations";
import type { UiState } from "@/lib/ui-state";

function explain(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.reasonCode === "NOT_PLATFORM_SUPERUSER" || error.status === 403) return "仅平台运营人员可以管理组织。";
    if (error.reasonCode === "PLATFORM_CATALOG_UNAVAILABLE" || error.status === 503) return "组织目录暂不可用，请联系平台运维。";
    if (error.reasonCode === "PLAN_VERSION_CONFLICT") return "套餐已被其他运营人员修改，请重新打开详情后再提交。";
    if (error.status === 404) return "组织不存在或不在套餐管理范围内。";
  }
  return "操作未完成，请稍后重试。";
}
const planLabel = (plan: PlanInput["plan"] | null) => plan === null ? "未配置" : plan === "enterprise" ? "企业" : "普通";

/** lint-no-backend-badge:backed-by-children — real catalog, detail and plan APIs in this screen. */
export function PlatformOrganizationsScreen(props:{state:UiState}){
  const context=useOptionalSession();
  return context?<ScopedOrganizations {...props}/>:<OrganizationsBody {...props}/>;
}
function ScopedOrganizations(props:{state:UiState}){
  const scope=useAuthenticatedSessionScope();
  return scope===null?<p>正在确认管理会话…</p>:<OrganizationsBody key={scope} {...props}/>;
}
function OrganizationsBody({ state }: { state: UiState }) {
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState<string | undefined>();
  const [data, setData] = React.useState<OrganizationList | null>(null);
  const [loadedDetail, setDetail] = React.useState<OrganizationDetail | null>(null);
  const detailTrigger = React.useRef<HTMLButtonElement | null>(null);
  const searchInput = React.useRef<HTMLInputElement | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const detail=loadedDetail?.organization.orgId===selectedId?loadedDetail:null;
  const [plan, setPlan] = React.useState<PlanInput["plan"]>("ordinary");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [detailError, setDetailError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setData(null); setError(null);
    void listPlatformOrganizations(query, cursor).then(out => { if (active) setData(out); })
      .catch(e => { if (active) setError(explain(e)); });
    return () => { active = false; };
  }, [query, cursor, refresh]);
  React.useEffect(() => {
    let active = true;
    // Keep a confirmed financial receipt mounted during same-organization refresh.
    setDetail(current=>current?.organization.orgId===selectedId?current:null); setReason(""); setDetailError(null);
    if (selectedId) void getPlatformOrganization(selectedId).then(out => {
      if (active) { setDetail(out); setPlan(out.organization.plan.plan ?? "ordinary"); }
    }).catch(e => { if (active) setDetailError(explain(e)); });
    return () => { active = false; };
  }, [selectedId, refresh]);
  async function save() {
    if (!detail || busy || !reason.trim()) return;
    setBusy(true); setDetailError(null);
    try {
      await setPlatformOrganizationPlan(detail.organization.orgId, {
        plan, expectedVersion: detail.organization.plan.version, reason: reason.trim(),
      });
      setRefresh(n => n + 1);
    } catch (e) { setDetailError(explain(e)); }
    finally { setBusy(false); }
  }
  return <AdminScreen state={state} moduleLabel="组织管理" title="组织与套餐" hideOrgIdentity liveBacked
    intro="管理所有正式组织，包括尚无成员的组织。本地组织与平台内部容器不在此管理。"
    emptyHint="没有匹配的组织" denialReason="仅平台运营可见" successMessage="套餐已保存">
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (busy) return; setCursor(undefined); setQuery(search); setRefresh(n => n + 1); }}>
      <label className="sr-only" htmlFor="organization-search">搜索组织名称</label>
      <Input ref={searchInput} id="organization-search" value={search} maxLength={200} placeholder="搜索组织名称" onChange={e => setSearch(e.target.value)} />
      <Button type="submit" disabled={busy}>搜索</Button>
      <Button type="button" disabled={busy} variant="outline" onClick={() => setRefresh(n => n + 1)}>刷新</Button>
    </form>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <p role="status">正在加载组织…</p>}
    {data && <>
      <Table><TableHeader><TableRow><TableHead>组织</TableHead><TableHead>成员</TableHead><TableHead>套餐</TableHead><TableHead>操作</TableHead></TableRow></TableHeader>
        <TableBody>{data.organizations.map(org => <TableRow key={org.orgId}>
          <TableCell><div>{org.name}</div><div className="text-12 text-muted-foreground">{org.orgId}</div></TableCell>
          <TableCell>{org.memberCount}</TableCell><TableCell>{planLabel(org.plan.plan)}{org.plan.plan==="enterprise"&&org.plan.enforcement!=="active"?"（待生效）":""}</TableCell>
          <TableCell><Button variant="outline" disabled={busy} onClick={event => { detailTrigger.current=event.currentTarget; setDetailError(null); setSelectedId(org.orgId); }}>详情与套餐</Button></TableCell>
        </TableRow>)}</TableBody></Table>
      {data.organizations.length === 0 && <p>没有匹配的正式组织。</p>}
      <div className="flex gap-2"><Button variant="outline" disabled={busy || !cursor} onClick={() => setCursor(undefined)}>回到首页</Button>
        <Button variant="outline" disabled={busy || !data.nextCursor} onClick={() => setCursor(data.nextCursor ?? undefined)}>下一页</Button></div>
    </>}
    <Dialog open={selectedId!==null} onOpenChange={open=>{if(!open&&!busy)setSelectedId(null);}}>
    {selectedId && <DialogContent hideClose aria-describedby="organization-drawer-description" className="left-auto right-0 top-0 h-dvh max-h-dvh w-full max-w-2xl translate-x-0 translate-y-0 rounded-none border-y-0 border-r-0 p-6" onCloseAutoFocus={event=>{event.preventDefault();
      const target=detailTrigger.current?.isConnected?detailTrigger.current:searchInput.current;
      target?.focus();}}>
      <div className="flex items-center justify-between gap-4"><DialogTitle>组织详情</DialogTitle>
        <Button variant="ghost" disabled={busy} onClick={() => setSelectedId(null)}>关闭</Button></div>
      <DialogDescription id="organization-drawer-description">查看组织信息与管理设置。</DialogDescription>
      <div className="min-h-0 flex-1 overflow-y-auto">
      {detailError && <p role="alert" className="text-destructive">{detailError}</p>}
      {!detail ? <p>{detailError ? "详情未能加载，请重新选择组织。" : "正在加载详情…"}</p> : <>
        <p>{detail.organization.name} · {detail.organization.memberCount} 位成员</p>
        <p className="text-13 text-muted-foreground">套餐：{planLabel(detail.organization.plan.plan)}{detail.organization.plan.plan==="enterprise"&&detail.organization.plan.enforcement!=="active"?"（待生效）":""} · 版本 {detail.organization.plan.version}</p>
        <p className="my-3 text-13 text-muted-foreground">套餐额度以实际计费记录为准，所有套餐均记录用量并保留安全和供应商限制。</p>
        {detail.organization.plan.enforcement!=="active"&&<>
        <label className="block" htmlFor="organization-plan">套餐</label>
        <select id="organization-plan" className="my-2 rounded border bg-background p-2" value={plan} disabled={busy} onChange={e => setPlan(e.target.value === "enterprise" ? "enterprise" : "ordinary")}>
          <option value="ordinary">普通</option><option value="enterprise">企业</option>
        </select>
        <label className="block" htmlFor="plan-change-reason">变更理由（写入审计记录）</label>
        <Input id="plan-change-reason" value={reason} maxLength={500} disabled={busy} onChange={e => setReason(e.target.value)} />
        <Button className="my-3" disabled={busy || !reason.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存套餐"}</Button>
        </>}
        <EnterpriseManagementPanel key={`enterprise-${detail.organization.orgId}`} orgId={detail.organization.orgId} orgName={detail.organization.name} balance={detail.organization.billingSummary?.wallet.balance} version={detail.organization.plan.version} enterprise={detail.organization.billingSummary?.licenseStatus==="enterprise"&&detail.organization.plan.enforcement==="active"&&detail.organization.plan.billingGeneration===detail.organization.billingSummary.generation} onApplied={()=>setRefresh(n=>n+1)}/>
        <AiPolicyPanel key={`policy-${detail.organization.orgId}`} orgId={detail.organization.orgId}/>
        <AiUsagePanel key={detail.organization.orgId} orgId={detail.organization.orgId} platform/>
        <h3 className="font-semibold">最近变更</h3>
        {detail.changes.length === 0 ? <p>尚无套餐变更。</p> : <ul>{detail.changes.map(change => <li key={change.version} className="my-2 text-13">
          {new Date(change.changedAt).toLocaleString()} · {planLabel(change.previousPlan)} → {planLabel(change.plan)} · {change.actorId} · {change.reason}
        </li>)}</ul>}
      </>}
      </div>
    </DialogContent>}
    </Dialog>
  </AdminScreen>;
}
