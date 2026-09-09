"use client";
import { useReducer, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { operations } from "@repo/contracts/capability-admin-deltas";
import { admissionItems, governanceReducer, initialGovernancePreview, missingAdmission } from "./governance-preview-model";
import { ModelConfigurationPreview } from "./model-configuration-preview";

export function CapabilityGovernancePreview() {
  const [state, dispatch] = useReducer(governanceReducer, undefined, initialGovernancePreview);
  const [mutation, setMutation] = useState<"keep" | "replace" | "clear">("keep");
  const [confirm, setConfirm] = useState(false);
  const [configConflict, setConfigConflict] = useState(false);
  const [endpoint, setEndpoint] = useState(state.endpoint);
  const [credential, setCredential] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const reconnect = (success: boolean) => {
    if ((mutation === "clear" && !confirm) || (mutation === "keep" && !state.credentialConfigured)) return;
    const parsed = operations.discoverRemoteMcpTools.in.safeParse({ serverId: "demo-mcp", endpoint,
      credentialMutation: mutation === "replace" ? { action: mutation, credential } : { action: mutation }, expectedConfigRevision: String(state.configRevision) });
    setCredential("");
    if (!parsed.success) { setConnectionError("请填写端点；替换凭据时需输入演示文本。服务端仍须校验实际端点与权限。"); return; }
    setConnectionError(""); dispatch({ type: "reconnect", mutation, expectedRevision: state.configRevision, success, endpoint });
    if (success && mutation === "clear") { setMutation("replace"); setConfirm(false); }
  };
  const missing = missingAdmission(state);
  return <main className="min-h-screen bg-background px-4 py-6 text-background-foreground" data-testid="studio-governance">
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/preview/ai-capability-studio/workbench" className="text-13 text-muted-foreground">返回 Skill 工作台</Link>
      <header><p className="text-12 text-primary">能力库 / 运行依赖</p><h1 className="mt-2 text-28 font-semibold">修复依赖，继续开发</h1><p className="mt-2 text-13 text-muted-foreground">确认配置、测试结果和工具权限，再返回原来的任务。</p></header>
      <p role="note" className="rounded-control border border-border bg-muted p-3 text-12">交互原型 · 所有结果由页面内模拟产生，不保存凭据、不调用模型或 MCP。重新打开页面会重置。</p>
      <div role="status" aria-live="polite" data-testid="governance-notice" className="rounded-control border border-border p-3 text-13">{state.notice}</div>
      <div className="grid gap-6 lg:grid-cols-2">
        <section id="model" className="space-y-4 rounded-container border border-border bg-card p-5">
          <h2 className="text-16 font-semibold">Model · 研究模型</h2>
          <p className="text-13" data-testid="model-status">{state.status} · 配置 r{state.revision}</p>
          <ModelConfigurationPreview revision={state.revision} onSaved={expectedRevision => dispatch({ type: "configure", expectedRevision })} onConflictChange={setConfigConflict} />
          <ul className="space-y-3">{admissionItems.map(item => {
            const latest = state.evidence.filter(record => record.item === item && record.revision === state.revision).at(-1);
            return <li key={item} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border p-3">
              <span className="text-13">{item} · {latest?.verdict ?? "待测试"}</span>
              <div className="flex gap-2"><Button disabled={configConflict} variant="outline" data-testid={`model-test-${item}`} onClick={() => dispatch({ type: "test", item, revision: state.revision, verdict: "通过" })}>模拟通过</Button><Button disabled={configConflict} variant="ghost" onClick={() => dispatch({ type: "test", item, revision: state.revision, verdict: "不通过" })}>模拟失败</Button></div>
            </li>;
          })}</ul>
          <p className="text-12">{missing.length ? `还需通过：${missing.join("、")}` : "当前配置的五项测试已通过（演示）。"}</p>
          <div className="flex gap-2"><Button variant="primary" data-testid="model-enable" disabled={configConflict || missing.length > 0 || state.status === "已启用"} onClick={() => dispatch({ type: "enable", expectedRevision: state.revision })}>启用演示模型</Button><Button variant="outline" disabled={state.status !== "已启用"} onClick={() => dispatch({ type: "disable" })}>模拟停用</Button></div>
          <details className="text-12"><summary>测试历史 · {state.evidence.length} 条</summary><ul>{state.evidence.map((record, index) => <li key={index}>r{record.revision} · {record.item} · {record.verdict}</li>)}</ul></details>
        </section>
        <section id="mcp" className="space-y-4 rounded-container border border-border bg-card p-5">
          <h2 className="text-16 font-semibold">MCP · 资料工具</h2>
          <p data-testid="mcp-status" className="text-13">{state.connectionStatus} · {state.credentialConfigured ? "已配置凭据" : "匿名连接"} · 配置 r{state.configRevision}</p>
          <p data-testid="mcp-current-endpoint" className="break-all text-12">当前演示端点：{state.endpoint}</p>
          <label className="block text-12" htmlFor="mcp-endpoint">重新连接端点<Input id="mcp-endpoint" data-testid="mcp-endpoint" value={endpoint} onChange={event => setEndpoint(event.target.value)} /></label>
          <p className="text-12 text-muted-foreground">选择本次连接如何处理凭据。连接失败时保留原配置，重新发现工具不会自动授权。</p>
          <fieldset className="space-y-2" data-testid="mcp-credential-mode"><legend className="mb-2 text-13">凭据处理方式</legend>{([{ value: "keep", label: "保留并使用现有凭据" }, { value: "replace", label: "替换凭据（演示）" }, { value: "clear", label: "清除凭据，尝试匿名连接" }] as const).map(option => <label key={option.value} className="flex items-center gap-2 text-12"><input type="radio" name="mcp-credential-mode" value={option.value} checked={mutation === option.value} disabled={option.value === "keep" && !state.credentialConfigured} onChange={() => { setMutation(option.value); setCredential(""); setConfirm(false); setConnectionError(""); }} />{option.label}</label>)}</fieldset>
          {mutation === "replace" && <label className="block text-12" htmlFor="mcp-credential">新凭据（仅填写演示文本）<Input id="mcp-credential" data-testid="mcp-credential" type="password" autoComplete="off" value={credential} onChange={event => setCredential(event.target.value)} /></label>}
          {mutation === "clear" && <label className="flex items-start gap-2 text-12"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />我确认：匿名连接成功后清除已保存凭据；失败则保留。</label>}
          {connectionError && <p role="alert" className="text-12 text-destructive">{connectionError}</p>}
          <div className="flex flex-wrap gap-2"><Button variant="primary" data-testid="mcp-connect-success" disabled={(mutation === "clear" && !confirm) || (mutation === "replace" && !credential.trim())} onClick={() => reconnect(true)}>模拟连接成功</Button><Button variant="outline" data-testid="mcp-connect-failure" onClick={() => reconnect(false)}>模拟鉴权失败</Button></div>
          <h3 className="text-13 font-semibold">发现的工具</h3><ul className="space-y-3">{state.discoveredTools.map(tool => <li key={tool} className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border p-3"><span className="text-13">{tool} · {state.grantedTools.includes(tool) ? "演示范围已授权" : "未授权"}</span><Button variant="outline" onClick={() => dispatch({ type: "grant", tool })}>{state.grantedTools.includes(tool) ? "撤销演示授权" : "明确授权此工具"}</Button></li>)}</ul>
          <p className="text-12 text-muted-foreground">实际调用还需同时满足组织权限、服务器范围、工具范围及 Agent 白名单。</p>
        </section>
      </div>
      <section className="space-y-3 rounded-container border border-border bg-card p-5"><h2 className="text-16 font-semibold">从失败记录返回</h2><p className="text-13">演示任务 run-preview-01 · Skill v1。修复依赖后回到草稿重新试跑，不会自动重放失败任务。</p><div className="flex flex-wrap gap-3"><a href="#model" className="text-13 text-primary">模型不可用 → 查看模型配置</a><a href="#mcp" className="text-13 text-primary">工具鉴权失败 → 重连 MCP</a><Link href="/preview/ai-capability-studio/workbench" className="text-13 text-primary">返回 Skill 工作台重新试跑</Link></div></section>
    </div>
  </main>;
}
