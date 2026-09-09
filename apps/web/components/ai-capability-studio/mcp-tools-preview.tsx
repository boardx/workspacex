"use client";
import { ToolAuthScope, checkToolScopeCap, checkToolScopeWithinServer } from "@repo/contracts/agent-runtime";
import { Button } from "@/components/ui/button";
import { GovernanceAction, GovernancePreview } from "./governance-preview-model";

export function McpToolsPreview({ state, dispatch }: { state: GovernancePreview; dispatch: (action: GovernanceAction) => void }) {
  return <div className="space-y-3">
    <p className="text-12" data-testid="mcp-review-status">安全评审：待安全评审 · 连接事实：{state.connectionStatus}。连通不等于放行，修改范围不自动完成评审。</p>
    <p className="text-12">服务器范围上限：仅某团队；团队归属与实际授权必须由服务端验证。</p>
    <Button variant="outline" disabled={state.connectionStatus !== "已连接" || state.discoveryChanged} onClick={() => dispatch({ type: "discover-changes" })}>模拟重新发现差异</Button>
    {state.discoveryChanged && <section className="space-y-1 rounded-control border border-border p-3 text-12" data-testid="mcp-discovery-diff"><h3 className="font-semibold">本次演示差异</h3><p>新增：无（export_report已在连接时发现）</p><p>移除：legacy_search · 研究助手的旧引用显示「工具已不存在」，不自动删除引用</p><p>签名变化：search · 旧输入需重新检查</p><p>封顶复查：search副作用改为对外发送；开放范围不得超过「需人工确认每次」，已关闭的工具保持关闭</p></section>}
    <h3 className="text-13 font-semibold">逐工具范围（演示，不授予真实权限）</h3>
    <ul className="space-y-3">{state.discoveredTools.map(tool => <li key={tool} className="space-y-2 rounded-control border border-border p-3">
      <p className="text-13">{tool} · {state.toolScopes[tool] === "未开放" ? "未授权" : `演示范围：${state.toolScopes[tool]}`}</p><p className="text-12">副作用：{state.toolEffects[tool]}</p>
      <fieldset className="space-y-1"><legend className="text-12">{tool} 的开放范围</legend>{ToolAuthScope.options.map(scope => {
        const allowed = checkToolScopeCap({ sideEffect: state.toolEffects[tool]!, authScope: scope }).ok && checkToolScopeWithinServer({ serverScope: "仅某团队", toolScope: scope }).ok;
        return <label key={scope} className="flex gap-2 text-12"><input type="radio" name={`scope-${tool}`} aria-label={`${tool} ${scope}`} checked={state.toolScopes[tool] === scope} disabled={!allowed} onChange={() => dispatch({ type: "grant", tool, scope })} />{scope}{!allowed && "（超过范围上限）"}</label>;
      })}</fieldset>
    </li>)}</ul>
  </div>;
}
