/**
 * #1911 —— Agent「能力图」的纯数据组装（图层无关，不 import `@xyflow/react`）。
 *
 * 拆成独立的纯函数是为了让「这张图到底画了什么」可以在不渲染 React Flow 画布的
 * 情况下被单测断言——同 `asset-code-editor.tsx` 把诊断计算与 Monaco 渲染分开的
 * 理由一样：渲染层在 jsdom 里没有 `ResizeObserver`，但数据组装是纯函数，不需要它。
 *
 * ⚠ 只读组装，不做任何写入判断——这一轮范围明确排除拖拽新增关系。
 */
import { agentRuntime } from "@repo/contracts";
import type { AgentCapabilityGraphOut } from "./live-agent-capability-graph";

const { parseMcpToolFullName } = agentRuntime;

export interface CapabilityGraphSkillNode {
  readonly id: string;
  readonly skillId: string;
  readonly skillVersion: number;
  /** 展示名——有已知目录名就用目录名，拿不到时原样退回 skillId（诚实，不臆造）。 */
  readonly label: string;
  readonly href: string;
}

export interface CapabilityGraphMcpNode {
  readonly id: string;
  readonly toolFullName: string;
  readonly serverSlug: string;
  readonly toolName: string;
  readonly state: AgentCapabilityGraphOut["toolWhitelist"][number]["state"];
  readonly href: string;
}

export interface AgentCapabilityGraphModel {
  readonly agentId: string;
  readonly agentLabel: string;
  readonly skillNodes: readonly CapabilityGraphSkillNode[];
  readonly mcpNodes: readonly CapabilityGraphMcpNode[];
  readonly hasCapabilities: boolean;
}

/** Skill 编辑页路由——与 `capability-edit-page.tsx` 的 `CATALOG_HREF`/详情路由同一形状。 */
export function skillEditHref(skillId: string): string {
  return `/admin/skill/${encodeURIComponent(skillId)}`;
}

/**
 * MCP 管理页——round-1（#1852）落地的只有全局面板，没有 per-server 深链路由，
 * 所以点击只跳到这一个已存在的入口，不新增路由（同 `mcp-screen.tsx` 现有 Link）。
 */
export const MCP_MANAGEMENT_HREF = "/preview/agent-runtime?screen=mcp-policy";

export function buildAgentCapabilityGraphModel(
  data: AgentCapabilityGraphOut,
  /** 可选：id → 展示名的目录映射（来自 `listCapabilities(orgId, "skill")`，非必需）。 */
  skillNames: ReadonlyMap<string, string> = new Map(),
): AgentCapabilityGraphModel {
  const skillNodes: CapabilityGraphSkillNode[] = data.skillMounts.map((mount) => ({
    id: `skill:${mount.skillId}`,
    skillId: mount.skillId,
    skillVersion: mount.skillVersion,
    label: skillNames.get(mount.skillId) ?? mount.skillId,
    href: skillEditHref(mount.skillId),
  }));

  const mcpNodes: CapabilityGraphMcpNode[] = data.toolWhitelist.flatMap((entry) => {
    const parsed = parseMcpToolFullName(entry.toolFullName);
    // 非法/不可解析的工具全名不该出现（不变量本应保证它合法）——跳过而不是硬凑一个假节点。
    if (parsed === null) return [];
    return [
      {
        id: `mcp:${entry.toolFullName}`,
        toolFullName: entry.toolFullName,
        serverSlug: parsed.serverSlug,
        toolName: parsed.toolName,
        state: entry.state,
        href: MCP_MANAGEMENT_HREF,
      },
    ];
  });

  return {
    agentId: data.agentId,
    agentLabel: data.name,
    skillNodes,
    mcpNodes,
    hasCapabilities: skillNodes.length > 0 || mcpNodes.length > 0,
  };
}
