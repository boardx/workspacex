/** Interactive design fixture only; no provider, credential or database calls. */
import { AdmissionTestItem, AdmissionVerdict, ModelStatus, McpConnectionStatus, ToolAuthScopeT, ToolSideEffectT, checkToolScopeCap, checkToolScopeWithinServer } from "@repo/contracts/agent-runtime";
import { z } from "zod";

type TestItem = z.infer<typeof AdmissionTestItem>;
type Verdict = z.infer<typeof AdmissionVerdict>;
export type GovernancePreview = {
  revision: number;
  probe: { revision: number; reachable: boolean } | null;
  status: z.infer<typeof ModelStatus>;
  evidence: { item: TestItem; revision: number; verdict: Verdict; evidence: string }[];
  credentialRevision: number;
  configRevision: number;
  endpoint: string;
  credentialConfigured: boolean;
  connectionStatus: z.infer<typeof McpConnectionStatus>;
  toolScopes: Record<string, ToolAuthScopeT>;
  toolEffects: Record<string, ToolSideEffectT>;
  discoveryChanged: boolean;
  removedTools: string[];
  discoveredTools: string[];
  notice: string;
};
export const admissionItems = AdmissionTestItem.options;
export function initialGovernancePreview(): GovernancePreview {
  return { revision: 1, probe: null, status: "待测试", evidence: [], credentialRevision: 1, configRevision: 1, endpoint: "https://example.test/mcp",
    credentialConfigured: true, connectionStatus: "凭据失效", toolScopes: { search: "仅某团队", legacy_search: "仅某团队" }, toolEffects: { search: "只读", legacy_search: "只读" }, discoveryChanged: false, removedTools: [],
    discoveredTools: ["search", "legacy_search"], notice: "演示配置尚未完成准入测试。" };
}
export function missingAdmission(state: GovernancePreview) {
  return admissionItems.filter(item => (item === "连通性" && state.probe?.revision === state.revision && !state.probe.reachable) || state.evidence.filter(record => record.item === item && record.revision === state.revision).at(-1)?.verdict !== "通过");
}
export type GovernanceAction =
  | { type: "probe"; revision: number; reachable: boolean }
  | { type: "configure"; expectedRevision: number }
  | { type: "test"; item: TestItem; revision: number; verdict: Verdict; evidence: string }
  | { type: "enable"; expectedRevision: number }
  | { type: "disable" }
  | { type: "reconnect"; mutation: "keep" | "replace" | "clear"; expectedRevision: number; success: boolean; endpoint?: string }
  | { type: "grant"; tool: string; scope: ToolAuthScopeT }
  | { type: "discover-changes" };
export function governanceReducer(state: GovernancePreview, action: GovernanceAction): GovernancePreview {
  switch (action.type) {
    case "probe": return { ...state, probe: { revision: action.revision, reachable: action.reachable }, notice: action.reachable ? "演示探测成功，仍需人工判读。" : "本次探测失败：当前版本暂不能启用，请修复连接并重新探测。" };
    case "configure":
      return action.expectedRevision !== state.revision ? { ...state, notice: "配置已变化，请重新读取后保存。" } :
        { ...state, revision: state.revision + 1, status: "待测试", notice: "配置已保存；旧测试保留在历史中，当前配置需要重新测试。" };
    case "test":
      if (!action.evidence.trim()) return { ...state, notice: "请填写本次判读的证据或说明。" };
      return action.revision !== state.revision ? { ...state, notice: "测试期间配置已变化，此结果不能用于启用当前配置。" } :
        { ...state, evidence: [...state.evidence, { item: action.item, revision: action.revision, verdict: action.verdict, evidence: action.evidence.trim() }], notice: `${action.item}：${action.verdict}（演示结果）` };
    case "enable":
      if (action.expectedRevision !== state.revision) return { ...state, notice: "配置已变化，请重新读取后启用。" };
      if (missingAdmission(state).length) return { ...state, notice: `还需通过：${missingAdmission(state).join("、")}。` };
      return { ...state, status: "已启用", notice: "演示模型已启用，可供新任务选择。" };
    case "disable": return { ...state, status: "已停用", notice: "演示模型已停用；新任务应返回依赖修复入口。" };
    case "reconnect": {
      if (action.expectedRevision !== state.configRevision) return { ...state, notice: "连接配置已变化，请重载后再连接。" };
      if (!action.success) return { ...state, notice: "本次候选连接失败；已保存连接的状态、凭据与工具授权均保留。" };
      if (action.mutation === "keep" && !state.credentialConfigured) return { ...state, notice: "没有可保留的凭据，请选择替换或匿名连接。" };
      const changed = action.mutation !== "keep" || (action.endpoint !== undefined && action.endpoint !== state.endpoint);
      return { ...state, credentialConfigured: action.mutation === "clear" ? false : state.credentialConfigured || action.mutation === "replace",
        endpoint: action.endpoint ?? state.endpoint,
        configRevision: state.configRevision + (changed ? 1 : 0),
        credentialRevision: state.credentialRevision + (action.mutation === "keep" ? 0 : 1), connectionStatus: "已连接",
        discoveredTools: changed ? ["search", "export_report"] : [...new Set([...state.discoveredTools, "export_report"])],
        discoveryChanged: false, removedTools: [],
        toolScopes: changed ? { search: "未开放", export_report: "未开放" } : { export_report: "未开放", ...state.toolScopes },
        toolEffects: changed ? { search: "只读", export_report: "对外发送" } : { ...state.toolEffects, export_report: "对外发送" },
        notice: changed ? "演示新配置已连接；旧工具授权不迁移，当前工具需要重新确认范围。" : "演示连接成功；新增工具未授权，旧发现差异已清空。" };
    }
    case "discover-changes":
      if (state.connectionStatus !== "已连接") return { ...state, notice: "先恢复连接，再重新发现工具。" };
      return { ...state, discoveryChanged: true, removedTools: state.discoveredTools.filter(tool => !["search", "export_report"].includes(tool)), discoveredTools: ["search", "export_report"],
        toolEffects: { search: "对外发送", export_report: "对外发送" },
        toolScopes: { search: state.toolScopes.search === "未开放" ? "未开放" : "需人工确认每次", export_report: state.toolScopes.export_report ?? "未开放" },
        notice: state.discoveredTools.includes("legacy_search") ? "演示发现完成：legacy_search已移除，原引用显示依赖失败；search签名及副作用变化，范围已按封顶收紧。" : "演示发现完成：本轮没有移除工具；search签名及副作用变化，范围按封顶复查。" };
    case "grant":
      if (!state.discoveredTools.includes(action.tool)) return state;
      if (!checkToolScopeCap({ sideEffect: state.toolEffects[action.tool]!, authScope: action.scope }).ok ||
          !checkToolScopeWithinServer({ serverScope: "仅某团队", toolScope: action.scope }).ok) return { ...state, notice: "授权范围超过服务器上限或工具副作用限制。" };
      return { ...state, toolScopes: { ...state.toolScopes, [action.tool]: action.scope }, notice: "演示工具范围已更新；实际调用仍需检查评审状态、Agent白名单与组织权限。" };
  }
}
