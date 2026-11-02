"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {previewPlatformTeams,previewEnterpriseUpgrade,previewPlatformCreditGrant,previewEnterpriseUpgradePending} from "./pricing-platform-preview-data";
import { numberLabel } from "./pricing-preview-data";
import { EnterpriseCreditGrantRequest, EnterpriseCreditGrantResult, ENTERPRISE_MANUAL_CREDIT_MAX, type EnterpriseUpgradeOperation } from "@repo/contracts/billing-team";

export function PricingEnterprisePreview({upgradeOutcome="succeeded"}:{upgradeOutcome?:"succeeded"|"processing"|"needs_review"}={}) {
  const [outcome,setOutcome]=React.useState(upgradeOutcome);
  const [operations,setOperations]=React.useState<Record<string,EnterpriseUpgradeOperation>>({});
  const [teams, setTeams] = React.useState(previewPlatformTeams);
  const [action, setAction] = React.useState<{ id: string; kind: "upgrade" | "grant" } | null>(null);
  const [amount, setAmount] = React.useState("10000");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const selected = teams.find(team => team.orgId === action?.id);
  function upgrade(team:typeof teams[number],key:string){
    if(outcome!=="succeeded"){
      const operation=previewEnterpriseUpgradePending(team,key,outcome);
      setOperations(old=>({...old,[team.orgId]:operation}));return;
    }
    const {row,operation}=previewEnterpriseUpgrade(team,key);
    setTeams(old=>old.map(item=>item.orgId===row.orgId?row:item));
    setOperations(old=>({...old,[row.orgId]:operation}));
    setMessage(`${team.name}已在预览中升级为 Enterprise。`);
  }
  function confirm() {
    if (!action || !selected) return;
    if (action.kind === "upgrade") {
      upgrade(selected,crypto.randomUUID());
      setAction(null); return;
    }
    if (!(selected.billingSummary.licenseStatus === "enterprise")) { setError("请先将团队升级为 Enterprise。"); return; }
    const reference = crypto.randomUUID();
    const input = EnterpriseCreditGrantRequest.safeParse({ credits: Number(amount), reason, idempotencyKey: reference });
    if (!input.success) {
      setError(`请输入 1 至 ${numberLabel(ENTERPRISE_MANUAL_CREDIT_MAX)} 的整数额度，并填写有效的添加原因。`); return;
    }
    // Controlled preview receipt only; no platform request or financial write occurs.
    const receipt = EnterpriseCreditGrantResult.safeParse({ orgId: selected.orgId, grantRef: `preview:${reference}`,
      ledgerRef: `preview-ledger:${reference}`, auditRef: `preview-audit:${reference}`, credits: input.data.credits,
      balance: selected.billingSummary.wallet.balance + input.data.credits, createdAt: new Date(Date.parse(selected.billingSummary.asOf)+1000).toISOString() });
    if (!receipt.success) { setError("无法生成预览额度记录，请调整额度后重试。"); return; }
    setTeams(old => old.map(team => team.orgId === receipt.data.orgId ? previewPlatformCreditGrant(team,receipt.data.credits,receipt.data.createdAt) : team));
    setMessage(`已在预览中为${selected.name}添加 ${numberLabel(receipt.data.credits)} credit。`);
    setAction(null);
  }
  return <section data-testid="pricing-admin" className="space-y-5">
    <div><h2 className="text-20 font-semibold">Team 管理</h2><p className="mt-1 text-13 text-muted-foreground">查看团队套餐，管理 Enterprise 与额外额度。</p></div>
    <div className="flex flex-wrap gap-2" aria-label="升级结果预览">{(["succeeded","processing","needs_review"] as const).map(value=><Button key={value} data-testid={`pricing-upgrade-outcome-${value}`} size="sm" variant={outcome===value?"outline":"ghost"} onClick={()=>setOutcome(value)}>{value==="succeeded"?"升级成功示例":value==="processing"?"处理中示例":"人工核对示例"}</Button>)}</div>
    {message && <p data-testid="pricing-admin-saved" role="status" className="rounded-control bg-success p-3 text-13 text-success-foreground">{message}</p>}
    <div className="overflow-x-auto rounded-card border border-border bg-card"><table className="w-full text-left text-13">
      <caption className="sr-only">平台团队套餐与额度</caption><thead className="border-b border-border text-12 text-muted-foreground"><tr><th className="p-4 font-medium">团队</th><th className="p-4 font-medium">套餐</th><th className="p-4 font-medium">可用额度</th><th className="p-4 font-medium">管理</th></tr></thead>
      <tbody>{teams.map(team => <tr data-testid={`pricing-admin-row-${team.orgId}`} key={team.orgId} className="border-b border-border last:border-0"><td className="p-4"><div className="min-w-32 font-medium">{team.name}</div><p className="mt-1 text-12 text-muted-foreground">{team.memberCount} 位成员</p></td><td className="p-4"><Badge data-testid={`pricing-admin-plan-${team.orgId}`} tone={(team.billingSummary.licenseStatus === "enterprise") ? "primary" : "neutral"}>{(team.billingSummary.licenseStatus === "enterprise") ? "Enterprise" : "Team"}</Badge></td><td className="p-4 tabular-nums">{numberLabel(team.billingSummary.wallet.balance)}</td><td className="p-4"><div className="flex flex-wrap gap-2">
        {!(team.billingSummary.licenseStatus === "enterprise") && !operations[team.orgId] && <Button data-testid={`pricing-upgrade-${team.orgId}`} size="sm" variant="outline" onClick={() => { setAction({ id: team.orgId, kind: "upgrade" }); setError(""); }}>升级 Enterprise</Button>}
        {(team.billingSummary.licenseStatus === "enterprise") && <Button data-testid={`pricing-grant-${team.orgId}`} size="sm" variant="outline" onClick={() => { setAction({ id: team.orgId, kind: "grant" }); setReason(""); setAmount("10000"); setError(""); }}>添加额度</Button>}
        {operations[team.orgId] && operations[team.orgId]!.status!=="succeeded" && <div data-testid={`pricing-upgrade-operation-${team.orgId}`} data-operation-ref={operations[team.orgId]!.operationRef} className="space-y-2 text-12"><p>{operations[team.orgId]!.status==="processing"?"升级处理中，当前套餐保持不变。":"需要人工核对，当前套餐保持不变。联系平台并提供原操作编号。"}</p><p className="break-all text-muted-foreground">{operations[team.orgId]!.operationRef}</p>{operations[team.orgId]!.status==="processing" && <Button data-testid={`pricing-upgrade-retry-${team.orgId}`} size="sm" variant="outline" onClick={()=>upgrade(team,operations[team.orgId]!.operationRef.replace("preview-operation:",""))}>查询原操作</Button>}</div>}
      </div></td></tr>)}</tbody>
    </table></div>
    <p className="text-12 text-muted-foreground">仅平台管理员可操作。此处为模拟团队，修改不会保存到真实账户。</p>
    <Dialog open={action !== null} onOpenChange={open => { if (!open) setAction(null); }}><DialogContent data-testid="pricing-admin-dialog"><DialogHeader><DialogTitle>{action?.kind === "upgrade" ? "升级为 Enterprise" : "添加团队额度"}</DialogTitle><DialogDescription>{selected?.name} · 设计预览，不修改真实团队。</DialogDescription></DialogHeader>
      {action?.kind === "upgrade" ? <p className="text-13 leading-relaxed">升级后停止 Team 后续续费。已付 Team 额度仍按原购买日发放至原到期日，已发额度保留原有效期。Enterprise 额外额度由平台管理员手动添加，不新增默认自动额度。</p> : <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="pricing-grant-amount">添加额度（credit）</Label><Input id="pricing-grant-amount" data-testid="pricing-grant-amount" type="number" min={1} max={ENTERPRISE_MANUAL_CREDIT_MAX} step={1} value={amount} onChange={event => { setAmount(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "pricing-grant-error" : undefined} /></div>
        <div className="space-y-2"><Label htmlFor="pricing-grant-reason">添加原因</Label><Input id="pricing-grant-reason" data-testid="pricing-grant-reason" maxLength={EnterpriseCreditGrantRequest.shape.reason.maxLength ?? undefined} value={reason} onChange={event => { setReason(event.target.value); setError(""); }} placeholder="例如：本月额外额度" aria-invalid={!!error} aria-describedby={error ? "pricing-grant-error" : undefined} /></div>
        <p className="text-12 text-muted-foreground">确认时将记录团队、额度、原因与操作人。</p>
      </div>}
      {error && <p id="pricing-grant-error" data-testid="err-pricing-grant" role="alert" className="text-13 text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button data-testid="pricing-admin-cancel" variant="outline" onClick={() => setAction(null)}>取消</Button><Button data-testid="pricing-admin-confirm" variant="primary" onClick={confirm}>确认{action?.kind === "upgrade" ? "升级" : "添加"}</Button></div>
    </DialogContent></Dialog>
  </section>;
}
