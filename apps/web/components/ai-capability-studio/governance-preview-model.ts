/** Interactive design fixture only; no provider, credential or database calls. */
import { AdmissionTestItem, AdmissionVerdict, ModelStatus, McpConnectionStatus } from "@repo/contracts/agent-runtime";
import { z } from "zod";

type TestItem = z.infer<typeof AdmissionTestItem>;
type Verdict = z.infer<typeof AdmissionVerdict>;
export type GovernancePreview = {
  revision: number;
  status: z.infer<typeof ModelStatus>;
  evidence: { item: TestItem; revision: number; verdict: Verdict; evidence: string }[];
  credentialRevision: number;
  configRevision: number;
  endpoint: string;
  credentialConfigured: boolean;
  connectionStatus: z.infer<typeof McpConnectionStatus>;
  grantedTools: string[];
  discoveredTools: string[];
  notice: string;
};
export const admissionItems = AdmissionTestItem.options;
export function initialGovernancePreview(): GovernancePreview {
  return { revision: 1, status: "待测试", evidence: [], credentialRevision: 1, configRevision: 1, endpoint: "https://example.test/mcp",
    credentialConfigured: true, connectionStatus: "凭据失效", grantedTools: ["search"],
    discoveredTools: ["search"], notice: "演示配置尚未完成准入测试。" };
}
export function missingAdmission(state: GovernancePreview) {
  return admissionItems.filter(item => state.evidence.filter(record => record.item === item && record.revision === state.revision).at(-1)?.verdict !== "通过");
}
export type GovernanceAction =
  | { type: "configure"; expectedRevision: number }
  | { type: "test"; item: TestItem; revision: number; verdict: Verdict; evidence: string }
  | { type: "enable"; expectedRevision: number }
  | { type: "disable" }
  | { type: "reconnect"; mutation: "keep" | "replace" | "clear"; expectedRevision: number; success: boolean; endpoint?: string }
  | { type: "grant"; tool: string };
export function governanceReducer(state: GovernancePreview, action: GovernanceAction): GovernancePreview {
  switch (action.type) {
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
    case "reconnect":
      if (action.expectedRevision !== state.configRevision) return { ...state, notice: "连接配置已变化，请重载后再连接。" };
      if (!action.success) return { ...state, connectionStatus: "凭据失效", notice: "演示连接失败，原凭据与工具授权均保留。" };
      if (action.mutation === "keep" && !state.credentialConfigured) return { ...state, notice: "没有可保留的凭据，请选择替换或匿名连接。" };
      return { ...state, credentialConfigured: action.mutation === "clear" ? false : state.credentialConfigured || action.mutation === "replace",
        endpoint: action.endpoint ?? state.endpoint,
        configRevision: state.configRevision + (action.mutation !== "keep" || (action.endpoint !== undefined && action.endpoint !== state.endpoint) ? 1 : 0),
        credentialRevision: state.credentialRevision + (action.mutation === "keep" ? 0 : 1), connectionStatus: "已连接",
        discoveredTools: [...new Set([...state.discoveredTools, "export_report"])],
        notice: "演示连接成功；新发现的 export_report 尚未授权。" };
    case "grant":
      return !state.discoveredTools.includes(action.tool) ? state : { ...state, grantedTools: state.grantedTools.includes(action.tool) ?
        state.grantedTools.filter(tool => tool !== action.tool) : [...state.grantedTools, action.tool], notice: "演示工具授权已更新；实际调用仍需检查 Agent 白名单与组织权限。" };
  }
}
