import { STANDARD_ARTIFACT_DOWNLOAD_TOOL } from "@repo/contracts/standard-artifact-download";
import { STANDARD_RUN_STATUS_TOOL } from "@repo/contracts/standard-run-status";
import { STANDARD_RUN_CANCEL_TOOL } from "@repo/contracts/standard-run-cancel";
import { STANDARD_BROWSER_TOOLS } from "@repo/contracts/standard-browser-tools";
import { AGENT_INTERRUPTS_TOOL_NAMES } from "@repo/contracts/agent-interrupts";
import { classifyToolRisk } from "../../domain/agent-run/tool-risk-tier";
import { toOrgId } from "../../domain/org-id";
import { ModelCallError, type ModelCallInput } from "./ports";
import type { NativeSessionOwner } from "./native-session-owner";

/** Profile membership, not a second permission classification. Unknown tools remain L2. */
const NATIVE_PROFILE_TOOLS = [STANDARD_ARTIFACT_DOWNLOAD_TOOL, STANDARD_RUN_STATUS_TOOL, STANDARD_RUN_CANCEL_TOOL, ...STANDARD_BROWSER_TOOLS, ...Object.values(AGENT_INTERRUPTS_TOOL_NAMES), "ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute", "task", "write_todos", "wx_artifact_publish", "web_search", "fetch_url", "wx_memory_search", "wx_memory_write", "wx_memory_delete", "wx_project_list", "wx_project_read", "wx_knowledge_search", "wx_knowledge_read", "wx_canvas_read", "wx_canvas_update", "wx_document_parse", "sql_db_list_tables", "sql_db_schema", "sql_db_query_checker", "sql_db_query", "wx_skill_create_draft", "wx_schedule_create", "wx_schedule_list", "wx_schedule_cancel", "wx_image_generate", "wx_audio_transcribe"] as const;
export async function bindNativeInvocation(owner: NativeSessionOwner, input: ModelCallInput) {
  if (input.modelProvider !== "deep-agent" || !input.orgId || !input.runId || !input.executionAttemptId
    || !Number.isInteger(input.executionLeaseEpoch) || input.executionLeaseEpoch! < 1 || input.executionMode !== undefined
    || input.scriptProtocol !== undefined || !input.onSkillActivity || !input.onRemoteRunStarted) {
    throw new ModelCallError("MODEL_CALL_FAILED", "native_execution_context_unavailable");
  }
  const pins = (input.skills ?? []).map(skill => {
    if (!skill.package || !skill.stableName) throw new ModelCallError("MODEL_CALL_FAILED", "native_complete_package_required");
    return { stableName: skill.stableName, package: skill.package };
  });
  const context = { orgId: toOrgId(input.orgId), parentRunId: input.runId,
    attemptId: input.executionAttemptId, leaseEpoch: input.executionLeaseEpoch! };
  const interruptOn = Object.fromEntries(NATIVE_PROFILE_TOOLS.map(name => [name, classifyToolRisk(name) === "L2"]));
  const binding = await owner.provision(context, pins, interruptOn);
  return { input: { ...input, nativeSession: binding },
    release: () => owner.release(binding.bindingId, context.orgId, context.parentRunId) };
}
