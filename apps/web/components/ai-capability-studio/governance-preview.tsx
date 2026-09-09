"use client";
import { useReducer, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { operations } from "@repo/contracts/capability-admin-deltas";
import { governanceReducer, initialGovernancePreview, missingAdmission } from "./governance-preview-model";
import { ModelConfigurationPreview } from "./model-configuration-preview";
import { RunFailurePreview } from "./run-failure-preview";
import { McpToolsPreview } from "./mcp-tools-preview";
import { ModelImpactPreview } from "./model-impact-preview";
import { ModelAdmissionPreview } from "./model-admission-preview";

export function CapabilityGovernancePreview() {
  const [state, dispatch] = useReducer(governanceReducer, undefined, initialGovernancePreview);
  const [mutation, setMutation] = useState<"keep" | "replace" | "clear">("keep");
  const [confirm, setConfirm] = useState(false);
  const [configConflict, setConfigConflict] = useState(false);
  const [endpoint, setEndpoint] = useState(state.endpoint);
  const [credential, setCredential] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const reconnectBlocked = (mutation === "clear" && !confirm) || (mutation === "replace" && !credential.trim()) || (mutation === "keep" && !state.credentialConfigured);
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
          <ModelAdmissionPreview probe={state.probe} onProbe={probe => dispatch({ type: "probe", ...probe })} revision={state.revision} blocked={configConflict} evidence={state.evidence} onRecord={record => dispatch({ type: "test", ...record })} />
          <p className="text-12">{missing.length ? `还需通过：${missing.join("、")}` : "当前配置的五项测试已通过（演示）。"}</p>
          <ModelImpactPreview revision={state.revision} enabled={state.status === "已启用"} onDisable={() => dispatch({ type: "disable" })} />
          <div className="flex gap-2"><Button variant="primary" data-testid="model-enable" disabled={configConflict || missing.length > 0 || state.status === "已启用"} onClick={() => dispatch({ type: "enable", expectedRevision: state.revision })}>启用演示模型</Button></div>
          <details className="text-12"><summary>测试历史 · {state.evidence.length} 条</summary><ul>{state.evidence.map((record, index) => <li key={index}>r{record.revision} · {record.item} · {record.verdict} · {record.evidence}</li>)}</ul></details>
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
          <div className="flex flex-wrap gap-2"><Button variant="primary" data-testid="mcp-connect-success" disabled={reconnectBlocked} onClick={() => reconnect(true)}>模拟连接成功</Button><Button variant="outline" data-testid="mcp-connect-failure" disabled={reconnectBlocked} onClick={() => reconnect(false)}>模拟鉴权失败</Button></div>
          <McpToolsPreview state={state} dispatch={dispatch} />
          <p className="text-12 text-muted-foreground">实际调用还需同时满足组织权限、服务器范围、工具范围及 Agent 白名单。</p>
        </section>
      </div>
      <RunFailurePreview currentModelRevision={state.revision} />
    </div>
  </main>;
}
