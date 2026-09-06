import { classifyToolRisk } from "../../domain/agent-run/tool-risk-tier";
import { toOrgId } from "../../domain/org-id";
import { ModelCallError, type ModelCallInput } from "./ports";
import type { NativeSessionOwner } from "./native-session-owner";

/** Profile membership, not a second permission classification. Unknown tools remain L2. */
const NATIVE_PROFILE_TOOLS = ["ls", "read_file", "write_file", "edit_file", "delete", "glob", "grep", "execute", "task", "write_todos", "wx_artifact_publish", "web_search", "fetch_url"] as const;
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
