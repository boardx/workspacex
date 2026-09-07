/**
 * Phase 14 F06（`plan-permissions` 契约束，R5 / domain.md `ToolRiskLevel`）—— 工具风险
 * 分级的**唯一事实源**。翻译自 `requirements/03-plan-mode-permissions.md` R5 的分级表，
 * 不发挥；固定白名单映射，本 phase 不支持组织自定义分级（R6 不包含）。
 *
 * | 分级 | 触发条件                          | 行为                         | 归属状态                     |
 * |----|--------------------------------|----------------------------|--------------------------|
 * | L0 | grep/read_file/web_fetch 等无副作用 | 自动执行，不打断                    | 保持 `running`             |
 * | L1 | write_file/edit_file（可回滚）      | 默认自动执行，事件带完整 diff          | 保持 `running`             |
 * | L2 | bash_exec、外部系统写入               | 默认需用户确认（除非已授权同类）           | 进入 `awaiting_tool_permission` |
 *
 * I-1（domain.md 不变量）：L2 操作在用户未曾授权同类操作的情况下，绝不允许自动执行，
 * 没有例外——包括"这个工具这次看起来无害"也不能绕过。因此分级判定本身不接受任何
 * per-call 的例外输入（函数只吃 `toolName`），且**未登记在白名单里的工具名一律归 L2**：
 * 不认识的工具默认最保守，而不是默认放行——放行才是需要理由的那一侧。
 */

import type { z } from "zod";
import type { planPermissions as PP } from "@repo/contracts";

export type ToolRiskLevel = z.infer<typeof PP.ToolRiskLevel>;

/**
 * L0：只读、无副作用。`list_org_skills`（deep-agent-service 内置的技能枚举工具）与
 * `write_todos`（deepagents `TodoListMiddleware` 的规划记账工具）都在这一档——枚举/
 * 记账不改变任何用户可见的外部状态。
 */
const L0_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read_file", "grep", "web_fetch", "list_org_skills", "glob", "ls",
  "wx_memory_search", "wx_project_list", "wx_project_read", "wx_knowledge_search", "wx_knowledge_read", "wx_canvas_read",
]);

/** L1：有版本历史、可回滚的副作用。本仓当前的执行内核尚未注册这两个工具，但分级
 * 表本身与"内核这一刻实际注册了哪些工具"解耦——分级规则是固定白名单，不是从注册表
 * 反推。 */
const L1_REVERSIBLE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "write_file", "edit_file",
]);

/**
 * L2：不可逆/高风险。`call_skill`（deep_agent_service/tools.py 的唯一有副作用工具，
 * 见 `packages/contracts/src/deep-agent-hitl.ts` 头注：调用一个组织技能 = "外部系统
 * 写入"）与 `bash_exec`（命令执行）。
 */
const L2_HIGH_RISK_TOOLS: ReadonlySet<string> = new Set([
  "bash_exec", "call_skill",
]);

/**
 * 分级判定。**没有默认导出的"未知工具"豁免**——I-1 要求"没有例外"，一个新工具在被
 * 显式加进上面某一档之前，永远按最保守的 L2 处理。
 */
export function classifyToolRisk(toolName: string): ToolRiskLevel {
  if (L0_READ_ONLY_TOOLS.has(toolName)) return "L0";
  if (L1_REVERSIBLE_WRITE_TOOLS.has(toolName)) return "L1";
  if (L2_HIGH_RISK_TOOLS.has(toolName)) return "L2";
  return "L2";
}

/** 只读任务的可见性断言用得上：给定一组工具名，纯只读 ⟺ 全部落在 L0。 */
export function isReadOnlyToolSet(toolNames: readonly string[]): boolean {
  return toolNames.every((name) => classifyToolRisk(name) === "L0");
}
