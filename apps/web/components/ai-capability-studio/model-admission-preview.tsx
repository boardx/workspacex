"use client";
import { useState } from "react";
import { AdmissionTestItem, AdmissionVerdict } from "@repo/contracts/agent-runtime";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Item = z.infer<typeof AdmissionTestItem>;
type Verdict = z.infer<typeof AdmissionVerdict>;
type RecordInput = { item: Item; revision: number; verdict: Verdict; evidence: string };

function JudgmentCard({ item, revision, blocked, latest, onRecord }: {
  item: Item; revision: number; blocked: boolean; latest?: Verdict; onRecord: (record: RecordInput) => void;
}) {
  const [loadedRevision, setLoadedRevision] = useState(revision);
  const [verdict, setVerdict] = useState("");
  const [evidence, setEvidence] = useState("");
  const stale = loadedRevision !== revision;
  return <li className="space-y-3 rounded-control border border-border p-3" data-testid={`model-judgment-${item}`}>
    <p className="text-13 font-medium">{item} · {latest ?? "待测试"}</p>
    <p className="text-12 text-muted-foreground">本次判读 r{loadedRevision} · 当前配置 r{revision}</p>
    <Select data-testid={`model-verdict-${item}`} placeholder="选择判读" value={verdict} disabled={blocked || stale}
      options={AdmissionVerdict.options.map(value => ({ value, label: value }))} onValueChange={setVerdict} />
    <label className="block text-12" htmlFor={`model-evidence-${item}`}>证据或说明<Input id={`model-evidence-${item}`} data-testid={`model-evidence-${item}`} value={evidence} disabled={blocked || stale} onChange={event => setEvidence(event.target.value)} /></label>
    {stale && <div className="space-y-2 text-12" data-testid={`model-judgment-stale-${item}`}><p>配置已变化；旧输入保留供查看，不能提交到新版本。</p><Button variant="outline" disabled={blocked} onClick={() => { setLoadedRevision(revision); setVerdict(""); setEvidence(""); }}>以当前配置重新填写</Button></div>}
    <Button variant="outline" data-testid={`model-test-${item}`} disabled={blocked || stale || !verdict || !evidence.trim()} onClick={() => onRecord({ item, revision: loadedRevision, verdict: AdmissionVerdict.parse(verdict), evidence: evidence.trim() })}>保存演示判读</Button>
  </li>;
}

export function ModelAdmissionPreview({ revision, blocked, evidence, onRecord, probe, onProbe }: {
  revision: number; blocked: boolean; evidence: RecordInput[]; onRecord: (record: RecordInput) => void;
  probe: { revision: number; reachable: boolean } | null; onProbe: (probe: { revision: number; reachable: boolean }) => void;
}) {

  return <div className="space-y-4">
    <section className="space-y-3 rounded-control border border-border p-3" aria-label="连接探测与人工判读分离">
      <h3 className="text-13 font-semibold">1. 连通性探测</h3>
      <p className="text-12 text-muted-foreground">探测结果只作为证据，不自动判定五项测试通过。</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={blocked} data-testid="model-probe-success" onClick={() => onProbe({ revision, reachable: true })}>模拟连通成功</Button><Button variant="outline" disabled={blocked} onClick={() => onProbe({ revision, reachable: false })}>模拟凭据失败</Button></div>
      {probe && <p className="text-12" data-testid="model-probe-result">r{probe.revision} · {probe.reachable ? "连通成功（演示）" : "凭据失败（演示）"}{probe.revision !== revision ? " · 已过期，未应用到当前配置" : " · 等待人工判读"}</p>}
    </section>
    {probe?.revision === revision && !probe.reachable && <p role="alert" className="text-12 text-destructive">本版本探测失败与人工通过结论冲突：保留判读记录，但禁止启用；请修复连接并重新探测成功。</p>}
    <h3 className="text-13 font-semibold">2. 准入判读与证据</h3>
    <ul className="space-y-3">{AdmissionTestItem.options.map(item => <JudgmentCard key={item} item={item} revision={revision} blocked={blocked}
      latest={evidence.filter(record => record.item === item && record.revision === revision).at(-1)?.verdict} onRecord={onRecord} />)}</ul>
  </div>;
}
