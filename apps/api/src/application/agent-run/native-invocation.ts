import { STANDARD_ARTIFACT_DOWNLOAD_TOOL } from "@repo/contracts/standard-artifact-download";
import { PLATFORM_SKILL_CATALOG } from "../../domain/skill/platform-skill-catalog";
import { STANDARD_RUN_STATUS_TOOL } from "@repo/contracts/standard-run-status";
import { STANDARD_RUN_CANCEL_TOOL } from "@repo/contracts/standard-run-cancel";
import { STANDARD_BROWSER_TOOLS } from "@repo/contracts/standard-browser-tools";
import { STANDARD_SUBTASK_TOOL } from "@repo/contracts/standard-subtask-tools";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { classifyToolRisk } from "../../domain/agent-run/tool-risk-tier";
import { resolveSkillRiskLevels, type SkillRiskEntry } from "../../domain/agent-run/skill-risk-level";
import { toOrgId } from "../../domain/org-id";
import { ModelCallError, type ModelCallInput } from "./ports";
import type { NativeSessionOwner } from "./native-session-owner";

/** Profile membership, not a second permission classification. Unknown tools remain L2. */
export const NATIVE_PROFILE_TOOLS = [STANDARD_ARTIFACT_DOWNLOAD_TOOL, STANDARD_RUN_STATUS_TOOL, STANDARD_RUN_CANCEL_TOOL, ...STANDARD_BROWSER_TOOLS, ...Object.values(AGENT_INTERRUPTS_TOOL_NAMES), "ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute", "task", "write_todos", "wx_artifact_publish", "web_search", "fetch_url", "wx_memory_search", "wx_memory_write", "wx_memory_delete", "wx_project_list", "wx_project_read", "wx_knowledge_search", "wx_knowledge_read", "wx_canvas_read", "wx_canvas_update", "wx_document_parse", "sql_db_list_tables", "sql_db_schema", "sql_db_query_checker", "sql_db_query", "wx_skill_create_draft", "wx_schedule_create", "wx_schedule_list", "wx_schedule_cancel", "wx_image_generate", "wx_audio_transcribe", STANDARD_SUBTASK_TOOL] as const;
/**
 * 准入表 → `interrupt_on` 的**唯一一次**计算。跨语言边界（`generated/native_profile_tools.json`，
 * 由 `scripts/generate-native-profile-tools.ts` 生成）和真实 provision 必须是同一个表达式算出来的：
 * 一旦在别处再写一遍 `classifyToolRisk(name) === "L2"`，两份就会各自漂移，而 Python 侧
 * `native_factory` 正是用这张表**静默过滤**掉未登记的工具（#3159 里 `spawn_async_task`
 * 就是这么消失的——构造了，没登记，一行日志都没有）。
 *
 * issue #3437 —— `execute`（沙箱命令执行）在 `tool-risk-tier.ts` 里被**刻意**、**永久**
 * 分类为 L2（I-1，"没有例外"）——那是对 `execute` 这个工具名本身的判断，合理且不应改动。
 * 但原生模式（`native_graph.py`）里，一个被判定 L0 的平台官方 skill（如 `pdf-create`，
 * #2782）自己的生成脚本也是**通过这同一个 `execute` 工具**跑的：原生 skill 没有
 * `call_skill` 那样"调用动作"与"被调用对象"分离的包装层，`SKILL.md`/脚本直接挂在
 * 沙箱文件系统里，模型直接 `execute` 命令去跑。#2782 把 `call_skill` 的风险判定从
 * "工具本身"改成"目标 skill"，但那次改动的落点只有 `harness.py` 的 `call_skill`
 * `InterruptOnConfig.when`（读 `configurable.hitl_skill_names`）——从未触达原生模式，
 * 于是devapp 真机实测（run 34594941550）里，明明挂载的唯一 skill 是 L0 的
 * `pdf-create`，`execute` 依然每次都弹审批框，15 分钟没人点、run 卡到超时。
 *
 * 这里补的不是"把 execute 也变成 L0"（那会破坏 I-1：模型脱离任何 skill 上下文时
 * 自己写的任意命令，例如本次证据里那条与 pdf-create 无关的
 * `node gen-capabilities.js`，仍然必须弹审批）。补的是**会话级豁免**：只有当本次
 * run 挂载的 skill **全部**是 L0（且至少挂了一个——未挂载任何 skill 时维持原有
 * fail-closed 默认，与 `classifyToolCallRisk` 对"认不出目标"的既有纪律同向），
 * 才放行 `execute` 不弹审批——这与 legacy 路径里"call_skill 返回的生成代码在
 * L0 skill 下自动执行、不再二次审批"（`graph.py` 系统提示的既有行为）是同一条产品
 * 决策在原生路径下的对应实现，风险面不比 legacy 路径更宽：两条路径下，挂载了任何
 * 非 L0 skill 时都仍然是"每次 execute 都问"的保守默认。
 *
 * `allSkillsAreL0` 缺省 `false`（未挂载/未传 = 原样保守），`scripts/generate-
 * native-profile-tools.ts` 生成静态准入表时正是用这个默认值调用——生成物代表的是
 * "没有任何 skill 上下文"时的保守快照，不随运行时的 skill 组合变化，与
 * `native-profile-tools-generated.test.ts` 的既有断言（`spawn_async_task` 等未登记
 * 工具默认 L2）逐字兼容。
 */
export function nativeInterruptOn({ allSkillsAreL0 = false }: { allSkillsAreL0?: boolean } = {}): Record<string, boolean> {
  return Object.fromEntries(NATIVE_PROFILE_TOOLS.map(name => [
    name,
    name === "execute" && allSkillsAreL0 ? false : classifyToolRisk(name) === "L2",
  ]));
}

/**
 * #3033 —— DevApp 上 `KERNEL_NATIVE_RUNTIME=1` 之下每条 chat 瞬间失败的真因：
 * `canonicalNativePackageSet` 要求 package set 里 `stableName` 唯一且匹配
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$`，否则抛裸 `Error("invalid native package set")`。而
 * `readPinnedSkills` 会把平台官方 skill（`skill-platform-*`）和组织自己的行一起读回
 * （`f.org_id = $1 OR f.org_id = PLATFORM_ORG_ID`），组织在 platform-owned-skills 之前
 * 装过同名 skill（pdf-create 等）的，两份一起进 pins ⇒ 每次 provision 都炸。CI 没有
 * 这种遗留数据，所以门控恒绿。草稿/导入层已经禁止**新的**同名（见
 * `pg-skill-contract-repository.ts` / `pg-skill-starter-import-repository.ts` 的冲突检查），
 * 遗留重复只能在这里收敛：同名时保留平台副本（产品意图里它才是该存在的那份）；
 * 两份都不是平台副本、或名字本身不合规，抛带名字的 `ModelCallError`——日志能直接
 * 定位，而不是再吞成 "unexpected model call failure"。
 */
const NATIVE_STABLE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function dedupeNativePins(skills: NonNullable<ModelCallInput["skills"]>) {
  const platformIds = new Set(PLATFORM_SKILL_CATALOG.map(entry => entry.skillId));
  const byName = new Map<string, { stableName: string; package: NonNullable<ModelCallInput["skills"]>[number]["package"] & object }>();
  for (const skill of skills) {
    if (!skill.package || !skill.stableName) throw new ModelCallError("MODEL_CALL_FAILED", "native_complete_package_required");
    if (!NATIVE_STABLE_NAME.test(skill.stableName)) {
      throw new ModelCallError("MODEL_CALL_FAILED", `native_invalid_skill_stable_name:${skill.stableName}`);
    }
    const prev = byName.get(skill.stableName);
    if (!prev) { byName.set(skill.stableName, { stableName: skill.stableName, package: skill.package }); continue; }
    const prevIsPlatform = platformIds.has(prev.package.skillId);
    const nextIsPlatform = platformIds.has(skill.package.skillId);
    if (nextIsPlatform && !prevIsPlatform) { byName.set(skill.stableName, { stableName: skill.stableName, package: skill.package }); continue; }
    if (prevIsPlatform && !nextIsPlatform) continue;
    throw new ModelCallError("MODEL_CALL_FAILED", `native_duplicate_skill_stable_name:${skill.stableName}`);
  }
  return [...byName.values()];
}

export async function bindNativeInvocation(owner: NativeSessionOwner, input: ModelCallInput) {
  if (input.modelProvider !== "deep-agent" || !input.orgId || !input.runId || !input.executionAttemptId
    || !Number.isInteger(input.executionLeaseEpoch) || input.executionLeaseEpoch! < 1 || input.executionMode !== undefined
    || input.scriptProtocol !== undefined || !input.onSkillActivity || !input.onRemoteRunStarted) {
    throw new ModelCallError("MODEL_CALL_FAILED", "native_execution_context_unavailable");
  }
  const pins = dedupeNativePins(input.skills ?? []);
  const context = { orgId: toOrgId(input.orgId), parentRunId: input.runId,
    attemptId: input.executionAttemptId, leaseEpoch: input.executionLeaseEpoch! };
  // issue #3437 —— 用去重前的 `input.skills`（带 `content`，`dedupeNativePins` 的结果
  // 只剩 stableName/package，算不出风险）。空挂载不算"全 L0"，保持原有 fail-closed。
  const skillRisks: readonly SkillRiskEntry[] = resolveSkillRiskLevels(input.skills ?? []);
  const allSkillsAreL0 = skillRisks.length > 0 && skillRisks.every(entry => entry.riskLevel === "L0");
  const interruptOn = nativeInterruptOn({ allSkillsAreL0 });
  const binding = await owner.provision(context, pins, interruptOn);
  return { input: { ...input, nativeSession: binding },
    release: () => owner.release(binding.bindingId, context.orgId, context.parentRunId) };
}
