"use client";
import { useState } from "react";
import Link from "next/link";
import { RuntimeFailureAttributionRefs } from "@repo/contracts/capability-runtime-policy";
import { Button } from "@/components/ui/button";

const fixture = RuntimeFailureAttributionRefs.parse({ runId: "run-preview-01", agentId: "research-agent", agentVersionId: "agent-version-1", skillVersionIds: ["skill-version-1"], modelConfigRef: { capabilityModelId: "research-model", configRevision: "1" }, mcpSnapshotRef: { snapshotId: "11111111-1111-4111-8111-111111111111", digest: "a".repeat(64) }, failureCode: "MODEL_CALL_FAILED" });

/** Server-response fixture. A generic error is never used to guess a missing dependency reference. */
export function RunFailurePreview({ currentModelRevision }: { currentModelRevision: number }) {
  const [accessible, setAccessible] = useState(true);
  const [withReferences, setWithReferences] = useState(true);
  const [target, setTarget] = useState<"model" | "mcp" | null>(null);
  const refs = withReferences ? fixture : { ...fixture, modelConfigRef: null, mcpSnapshotRef: null };
  return <section className="space-y-3 rounded-container border border-border bg-card p-5" data-testid="run-failure-preview">
    <h2 className="text-16 font-semibold">从失败记录返回</h2>
    <p className="text-12 text-muted-foreground">服务端响应形状的演示数据，不读取真实历史配置，也不自动重放任务。</p>
    <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => { setAccessible(!accessible); setTarget(null); }}>{accessible ? "模拟引用无权限" : "恢复演示访问"}</Button><Button variant="ghost" onClick={() => { setWithReferences(!withReferences); setTarget(null); }}>{withReferences ? "模拟缺少依赖引用" : "恢复演示引用"}</Button></div>
    {!accessible ? <p role="alert" className="text-13">该记录不可访问或不存在。请联系管理员确认访问权限。</p> : <>
      <p className="text-13">运行 {refs.runId} · {refs.failureCode}</p><p className="text-12">Agent版本 {refs.agentVersionId} · Skill版本 {refs.skillVersionIds.join("、")}</p>
      <div className="flex flex-wrap gap-2">{refs.modelConfigRef && <Button variant="outline" onClick={() => setTarget("model")}>查看本次模型配置</Button>}{refs.mcpSnapshotRef && <Button variant="outline" onClick={() => setTarget("mcp")}>查看本次 MCP 快照</Button>}</div>
      {!refs.modelConfigRef && !refs.mcpSnapshotRef && <p className="text-12">运行未返回依赖引用，不能根据错误文案猜测模型或 MCP。</p>}
      {target === "model" && refs.modelConfigRef && <div className="space-y-1 rounded-control border border-border p-3 text-12" data-testid="failure-model-reference"><p>{refs.modelConfigRef.capabilityModelId} · 运行使用 r{refs.modelConfigRef.configRevision} / 当前 r{currentModelRevision}</p><p>{String(currentModelRevision) === refs.modelConfigRef.configRevision ? "本运行使用此配置版本。" : "版本不同：旧运行失败不代表当前配置仍然失败。"}</p><p>这里只展示引用。历史配置读取 API 尚未接线，不把当前配置内容当成历史内容。</p><a href="#model" className="text-primary">查看当前模型管理</a></div>}
      {target === "mcp" && refs.mcpSnapshotRef && <div className="space-y-1 rounded-control border border-border p-3 text-12" data-testid="failure-mcp-reference"><p>运行快照 {refs.mcpSnapshotRef.snapshotId}</p><p className="break-all">摘要 {refs.mcpSnapshotRef.digest}</p><p>快照解析接口尚未接线；不根据该引用猜测服务器或工具，不将当前发现列表当作运行快照。</p></div>}
      <Link href="/preview/ai-capability-studio/workbench" className="inline-block text-13 text-primary">返回 Skill 工作台重新试跑</Link>
    </>}
  </section>;
}
