"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { numberLabel } from "./pricing-preview-data";

const organizations = [
  { id: "studio", name: "山海设计工作室", members: 4, enterprise: false, credits: 64000 },
  { id: "research", name: "远见研究团队", members: 12, enterprise: true, credits: 238500 },
  { id: "product", name: "星河产品团队", members: 5, enterprise: false, credits: 18500 },
];
export function PricingEnterprisePreview() {
  const [teams, setTeams] = React.useState(organizations);
  const [action, setAction] = React.useState<{ id: string; kind: "upgrade" | "grant" } | null>(null);
  const [amount, setAmount] = React.useState("10000");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const selected = teams.find(team => team.id === action?.id);
  function confirm() {
    if (!action || !selected) return;
    const value = Number(amount);
    if (action.kind === "grant" && (!Number.isSafeInteger(value) || value <= 0 || value > 1000000 || !reason.trim())) {
      setError("请输入 1 至 1,000,000 的整数额度，并填写添加原因。"); return;
    }
    setTeams(old => old.map(team => team.id !== action.id ? team : action.kind === "upgrade" ? { ...team, enterprise: true } : { ...team, credits: team.credits + value }));
    setMessage(action.kind === "upgrade" ? `${selected.name}已在预览中升级为 Enterprise。` : `已在预览中为${selected.name}添加 ${numberLabel(value)} credit。`);
    setAction(null);
  }
  return <section data-testid="pricing-admin" className="space-y-5">
    <div><h2 className="text-20 font-semibold">Team 管理</h2><p className="mt-1 text-13 text-muted-foreground">查看团队套餐，管理 Enterprise 与额外额度。</p></div>
    {message && <p data-testid="pricing-admin-saved" role="status" className="rounded-control bg-success p-3 text-13 text-success-foreground">{message}</p>}
    <div className="overflow-x-auto rounded-card border border-border bg-card"><table className="w-full text-left text-13">
      <caption className="sr-only">平台团队套餐与额度</caption><thead className="border-b border-border text-12 text-muted-foreground"><tr><th className="p-4 font-medium">团队</th><th className="p-4 font-medium">套餐</th><th className="p-4 font-medium">可用额度</th><th className="p-4 font-medium">管理</th></tr></thead>
      <tbody>{teams.map(team => <tr data-testid={`pricing-admin-row-${team.id}`} key={team.id} className="border-b border-border last:border-0"><td className="p-4"><div className="min-w-32 font-medium">{team.name}</div><p className="mt-1 text-12 text-muted-foreground">{team.members} 位成员</p></td><td className="p-4"><Badge data-testid={`pricing-admin-plan-${team.id}`} tone={team.enterprise ? "primary" : "neutral"}>{team.enterprise ? "Enterprise" : "Team"}</Badge></td><td className="p-4 tabular-nums">{numberLabel(team.credits)}</td><td className="p-4"><div className="flex flex-wrap gap-2">
        {!team.enterprise && <Button data-testid={`pricing-upgrade-${team.id}`} size="sm" variant="outline" onClick={() => { setAction({ id: team.id, kind: "upgrade" }); setError(""); }}>升级 Enterprise</Button>}
        {team.enterprise && <Button data-testid={`pricing-grant-${team.id}`} size="sm" variant="outline" onClick={() => { setAction({ id: team.id, kind: "grant" }); setReason(""); setAmount("10000"); setError(""); }}>添加额度</Button>}
      </div></td></tr>)}</tbody>
    </table></div>
    <p className="text-12 text-muted-foreground">仅平台管理员可操作。此处为模拟团队，修改不会保存到真实账户。</p>
    <Dialog open={action !== null} onOpenChange={open => { if (!open) setAction(null); }}><DialogContent data-testid="pricing-admin-dialog"><DialogHeader><DialogTitle>{action?.kind === "upgrade" ? "升级为 Enterprise" : "添加团队额度"}</DialogTitle><DialogDescription>{selected?.name} · 设计预览，不修改真实团队。</DialogDescription></DialogHeader>
      {action?.kind === "upgrade" ? <p className="text-13 leading-relaxed">确认后，该团队将显示 Enterprise 标识。此操作不产生支付或自动发放额度；额度由平台管理员单独添加。</p> : <div className="space-y-4">
        <div className="space-y-2"><Label htmlFor="pricing-grant-amount">添加额度（credit）</Label><Input id="pricing-grant-amount" data-testid="pricing-grant-amount" type="number" min={1} max={1000000} step={1} value={amount} onChange={event => { setAmount(event.target.value); setError(""); }} aria-invalid={!!error} aria-describedby={error ? "pricing-grant-error" : undefined} /></div>
        <div className="space-y-2"><Label htmlFor="pricing-grant-reason">添加原因</Label><Input id="pricing-grant-reason" data-testid="pricing-grant-reason" value={reason} onChange={event => { setReason(event.target.value); setError(""); }} placeholder="例如：本月额外额度" aria-invalid={!!error} aria-describedby={error ? "pricing-grant-error" : undefined} /></div>
        <p className="text-12 text-muted-foreground">确认时将记录团队、额度、原因与操作人。</p>
      </div>}
      {error && <p id="pricing-grant-error" data-testid="err-pricing-grant" role="alert" className="text-13 text-destructive">{error}</p>}
      <div className="flex justify-end gap-2"><Button data-testid="pricing-admin-cancel" variant="outline" onClick={() => setAction(null)}>取消</Button><Button data-testid="pricing-admin-confirm" variant="primary" onClick={confirm}>确认{action?.kind === "upgrade" ? "升级" : "添加"}</Button></div>
    </DialogContent></Dialog>
  </section>;
}
