import { STANDARD_ARTIFACT_DOWNLOAD_TOOL } from "@repo/contracts/standard-artifact-download";
import { PLATFORM_SKILL_CATALOG } from "../../domain/skill/platform-skill-catalog";
import { STANDARD_RUN_STATUS_TOOL } from "@repo/contracts/standard-run-status";
import { STANDARD_RUN_CANCEL_TOOL } from "@repo/contracts/standard-run-cancel";
import { STANDARD_BROWSER_TOOLS } from "@repo/contracts/standard-browser-tools";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { classifyToolRisk } from "../../domain/agent-run/tool-risk-tier";
import { toOrgId } from "../../domain/org-id";
import { ModelCallError, type ModelCallInput } from "./ports";
import type { NativeSessionOwner } from "./native-session-owner";

/** Profile membership, not a second permission classification. Unknown tools remain L2. */
export const NATIVE_PROFILE_TOOLS = [STANDARD_ARTIFACT_DOWNLOAD_TOOL, STANDARD_RUN_STATUS_TOOL, STANDARD_RUN_CANCEL_TOOL, ...STANDARD_BROWSER_TOOLS, ...Object.values(AGENT_INTERRUPTS_TOOL_NAMES), "ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute", "task", "write_todos", "wx_artifact_publish", "web_search", "fetch_url", "wx_memory_search", "wx_memory_write", "wx_memory_delete", "wx_project_list", "wx_project_read", "wx_knowledge_search", "wx_knowledge_read", "wx_canvas_read", "wx_canvas_update", "wx_document_parse", "sql_db_list_tables", "sql_db_schema", "sql_db_query_checker", "sql_db_query", "wx_skill_create_draft", "wx_schedule_create", "wx_schedule_list", "wx_schedule_cancel", "wx_image_generate", "wx_audio_transcribe"] as const;
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
  const interruptOn = Object.fromEntries(NATIVE_PROFILE_TOOLS.map(name => [name, classifyToolRisk(name) === "L2"]));
  const binding = await owner.provision(context, pins, interruptOn);
  return { input: { ...input, nativeSession: binding },
    release: () => owner.release(binding.bindingId, context.orgId, context.parentRunId) };
}
