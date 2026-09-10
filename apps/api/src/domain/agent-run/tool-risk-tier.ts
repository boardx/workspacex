/**
 * Phase 14 F06（`plan-permissions` 契约束，R5 / domain.md `ToolRiskLevel`）—— 工具风险
 * 分级的**唯一事实源**。翻译自 `requirements/03-plan-mode-permissions.md` R5 的分级表，
 * 不发挥；固定白名单映射，本 phase 不支持组织自定义分级（R6 不包含）。
 *
 * | 分级 | 触发条件                          | 行为                         | 归属状态                     |
 * |----|--------------------------------|----------------------------|--------------------------|
 * | L0 | grep/read_file/fetch_url 等无副作用 | 自动执行，不打断                    | 保持 `running`             |
 * | L1 | write_file/edit_file（可回滚）      | 默认自动执行，事件带完整 diff          | 保持 `running`             |
 * | L2 | execute（命令执行）、外部系统写入          | 默认需用户确认（除非已授权同类）           | 进入 `awaiting_tool_permission` |
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
 *
 * ⚠ 这段注释曾经**只是注释**：`write_todos` 从引入这条注释的 5571b867f 起就从没进过
 * 下面的集合（`git log -S write_todos` 只有那一次提交），于是落进末尾的默认 L2 ——
 * 每记一次待办弹一次审批框。它还连续误导了两个 agent 的排查（#3132 / #3186）。
 * 同一档的另一个死名字是 `web_fetch`：内核真正注册的工具叫 `fetch_url`
 * （`NATIVE_PROFILE_TOOLS`），`web_fetch` 谁也匹配不上 ⇒ 每次取网页都要人工批准（#3160）。
 * 两条都由 `tests/agent-run/tool-risk-tier-names-are-real.test.ts` 的 A/B 断言机械看住：
 * 名字必须真实存在，且注释点名的必须真的在集合里。
 */
const L0_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "wx_run_status", "browser_snapshot",
  "read_file", "grep", "fetch_url", "list_org_skills", "glob", "ls", "write_todos",
  "wx_memory_search", "wx_project_list", "wx_project_read", "wx_knowledge_search", "wx_knowledge_read", "wx_canvas_read",
  // #3302：以下七件此前从未登记，静默落进末尾的默认 L2 ⇒ 每次调用都弹审批框。
  "web_search",             // 出站检索，只读回结果，不改任何状态（与已在档的 `fetch_url` 同性质）。
  "sql_db_list_tables",     // 列表名；`/sql/source/check` 的只读元数据面。
  "sql_db_schema",          // 读表结构；同上，不执行用户 SQL。
  "sql_db_query_checker",   // 只对 SQL 字符串做静态/模型校验，不连库执行（执行的是 `sql_db_query`，L2）。
  "wx_schedule_list",       // 枚举本组织已有日程；`wx_schedule_create` / `wx_schedule_cancel` 才是写面。
  "wx_audio_transcribe",    // 转写一个已存在的附件，读入产出文本，不改附件。
  "task",                   // deepagents 同步子代理委派：它本身无副作用，子代理调的每一件工具
                            // 仍逐个过同一张 `interrupt_on` 表——在这里拦它等于把内层的分级重复计一次。
]);

/** L1：有版本历史、可回滚的副作用。本仓当前的执行内核尚未注册这两个工具，但分级
 * 表本身与"内核这一刻实际注册了哪些工具"解耦——分级规则是固定白名单，不是从注册表
 * 反推。 */
const L1_REVERSIBLE_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "browser_take_screenshot", // Writes only a reversible image in the bound workspace.
  "write_file", "edit_file",
  // #3302：以下六件此前从未登记。
  "wx_artifact_publish",   // 追加一个新 artifact 版本，既有版本不动，可回滚到上一版。
  "wx_memory_write",       // 记忆行带 revision，可由 `wx_memory_delete`（L2）撤销；写入本身可追溯可回滚。
  "wx_canvas_update",      // 带 `expectedRevision` 的乐观并发 + 画布版本历史 ⇒ 定义上的可回滚写。
  "wx_skill_create_draft", // 只落草稿，未激活；草稿不影响任何现有执行路径。
  "wx_image_generate",     // 产出一件新 artifact，纯追加；没有任何既有状态被改写。
]);

/**
 * L2：不可逆/高风险。`call_skill`（deep_agent_service/tools.py 的唯一有副作用工具，
 * 见 `packages/contracts/src/deep-agent-hitl.ts` 头注：调用一个组织技能 = "外部系统
 * 写入"）与 `execute`（命令执行）。
 *
 * ⚠ 这里原本写的是 `bash_exec` —— 又一个内核从未注册过的名字（真实名字是 `execute`，
 * 见 `native_skill_activity.py` 的 `('read_file', 'execute')`）。它没造成事故只是因为
 * 恰好和"未登记 ⇒ 默认 L2"同向；换成 L0 档的死名字（`web_fetch`）后果就是 #3160。
 * 死名字一律由 A 断言看住，不区分它这次是往安全还是往危险的方向错。
 */
const L2_HIGH_RISK_TOOLS: ReadonlySet<string> = new Set([
  "wx_artifact_download", "wx_run_cancel", "browser_navigate", "browser_click", "browser_fill_form",
  "execute", "call_skill",
  // #3302：以下八件此前从未登记。它们本来就该是 L2——但"碰巧和兜底同向"不算登记，
  // 因为兜底掩盖的是"没人判断过"，而不是"判断结果是 L2"（`bash_exec` 的死名字正是这么活下来的）。
  "confirm_task_intent",   // 人机交互三件：语义就是"停下来问人"，没有出站派发面，
  "fill_run_params",       // `interrupt_on` 恒为 true；`pg-native-session-owner` 也按这个前提
  "choose_execution_option", // 处理既有 binding 的准入合并，改成非 L2 会直接破坏 HITL。
  "delete",                // 删工作区文件，没有版本历史可回滚（`write_file`/`edit_file` 有，所以它们是 L1）。
  "wx_memory_delete",      // 删记忆行，不可逆。
  "sql_db_query",          // 真连库执行模型给出的 SQL，可能是 DML ⇒ 外部系统写入。
  "wx_schedule_create",    // 创建将来会自动触发的执行，是"授权一串未来的 run"，不是一次写。
  "wx_schedule_cancel",    // 取消用户配置的日程，与已在档的 `wx_run_cancel` 同性质。
  "wx_document_parse",     // 按性质它是只读的（解析工作区里已有的文件，无外部写入），本该是 L0。
                           // 但 `standard-document-locators-http.test.ts` 的生产授权链断言
                           // 「未授权的第一次调用必须 503」——它今天依赖这件工具是 L2。那条断言里
                           // 没写明这是不是刻意的产品判断（不像 #3159 有白纸黑字的理由），而放宽它
                           // 等于**在一个补门控的 PR 里顺手改动一条安全形状的断言**。
                           // 所以这里按既有行为显式登记为 L2：本 PR 只负责把「没人判断过」变成
                           // 「判断过」，不夹带放宽。是否降到 L0 另开 issue 由人决定。
  "spawn_async_task",      // durable 子任务派发本身就是有副作用的动作（#3159 的既定判定，
                           // 由 `native-profile-tools-generated.test.ts` 钉住）。登记的目的是让它
                           // **存在于准入表**，不是顺手放行——所以显式写在 L2，而不是靠兜底。
]);

/**
 * 三档白名单的机械可读视图。**只用于门控断言**（`tests/agent-run/tool-risk-tier-names-are-real.test.ts`
 * 的 A/B 两条），不是第二份事实源——它就是上面那三个常量本身，不许在这里增删任何名字。
 */
export const RISK_TIER_WHITELISTS = {
  L0: L0_READ_ONLY_TOOLS,
  L1: L1_REVERSIBLE_WRITE_TOOLS,
  L2: L2_HIGH_RISK_TOOLS,
} as const satisfies Record<ToolRiskLevel, ReadonlySet<string>>;

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
