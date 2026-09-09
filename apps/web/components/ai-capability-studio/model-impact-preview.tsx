"use client";
import { useState } from "react";
import { operations } from "@repo/contracts/capability-admin-deltas";
import { DisableDialog } from "@/components/admin/disable-dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

type References = ReturnType<typeof operations.listModelReferences.out.parse>;
/** Uses simulated references only. No production disable request or audit is emitted. */
export function ModelImpactPreview({ revision, enabled, onDisable }: { revision: number; enabled: boolean; onDisable: () => void }) {
  const [references, setReferences] = useState<References | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState("");
  const [outcome, setOutcome] = useState("");
  const current = references?.modelConfigRef.configRevision === String(revision);
  const read = () => {
    setReferences(operations.listModelReferences.out.parse({ referenceSnapshotId: `preview-references-${revision}`, agents: ["研究助手"], skills: ["研究摘要 v1"], blueprintPolicies: [], activeProjects: ["演示研究项目"], inFlightCalls: 2, modelConfigRef: { capabilityModelId: "research-model", configRevision: String(revision) } }));
    setFailed(false); setOpen(false);
  };
  return <section className="space-y-3 rounded-control border border-border p-3" aria-label="模型停用影响">
    <h3 className="text-13 font-semibold">停用前查看引用</h3>
    <p className="text-12 text-muted-foreground">下列清单与调用数均为演示数据，确认不会执行生产停用。</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={read}>读取演示引用清单</Button><Button variant="ghost" onClick={() => { setReferences(null); setFailed(true); setOpen(false); }}>模拟引用读取失败</Button></div>
    {!references ? <p role={failed ? "alert" : undefined} data-testid="model-references-unknown" className="text-12">{failed ? "引用读取失败" : "尚未读取引用"}：影响数量未知，不能按 0 个处理。读取成功后才能确认停用。</p> : <div className="space-y-1 text-12" data-testid="model-references"><p>快照配置 r{references.modelConfigRef.configRevision} · 当前 r{revision}{!current && " · 快照已过期，请重新读取"}</p><p>Agent：{references.agents.join("、") || "无"}</p><p>Skill：{references.skills.join("、") || "无"}</p><p>蓝图策略：{references.blueprintPolicies.join("、") || "无"}</p><p>活跃项目：{references.activeProjects.join("、") || "无"}</p><p>进行中调用：{references.inFlightCalls}</p></div>}
    <Button variant="outline" data-testid="model-disable-review" disabled={!enabled || !current} onClick={() => setOpen(true)}>查看停用方式并确认</Button>
    {open && references && current && enabled && <DisableDialog testid="model-disable-dialog" verb="演示停用" capabilityName="research-model" inFlight={references.inFlightCalls} onCancel={() => setOpen(false)} onConfirm={mode => {
      setOpen(false); setSelection(""); onDisable();
      setOutcome(mode === "interrupt" ? `演示结果：${references.inFlightCalls} 个进行中调用被中断；拒绝新调用。` : `演示结果：${references.inFlightCalls} 个进行中调用继续当前一轮；拒绝新调用。`);
    }} />}
    {outcome && <p className="text-12" data-testid="model-disable-outcome">{outcome} 原有引用标记为依赖失败，保留原模型，不自动替换。</p>}
    <label className="block text-12">新任务模型选择器（演示）<Select data-testid="model-new-task-selector" value={enabled ? selection : ""} placeholder={enabled ? "选择模型" : "暂无可用模型，请修复依赖"} options={enabled ? [{ value: "research-model", label: "research-model" }] : []} onValueChange={setSelection} disabled={!enabled} /></label>
    <div className="space-y-1 text-12" data-testid="model-composite-members"><p className="font-medium">组合模型 research-team · 只读成员</p><p>主模型：research-model · {enabled ? "已启用" : "不可用，阻塞组合模型启用"}</p><p>审核模型：review-model · 待测试，阻塞组合模型启用</p><p className="text-muted-foreground">组合模型沿用成员定义，不填写单模型 provider/upstream 映射。成员状态需由服务端读取；此处仅展示依赖失败体验。</p></div>
  </section>;
}
