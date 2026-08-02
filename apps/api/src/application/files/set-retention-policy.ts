/**
 * F46 -- `setRetentionPolicy` (D-14: "项目级覆盖由项目负责人配"). Only facilitator writes
 * this (project-owner stand-in, same shape as `content.renameFile`'s non-observer grouping
 * -- but a WRITE to a project-wide policy, not per-content, so it uses the project's own
 * write action rather than an artifact-scoped one).
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { mergeRetentionOverride, resolveRetentionParams, RetentionParamInvalidError } from "../../domain/files/retention-policy";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { RetentionPolicyRepository } from "./retention-policy-ports";

export type SetRetentionPolicyResult = z.infer<typeof C.operations.setRetentionPolicy.out>;

export type SetRetentionPolicyReasonCode = "PROJECT_ROLE_INSUFFICIENT" | "RETENTION_PARAM_INVALID";

export class SetRetentionPolicyError extends Error {
  constructor(readonly reasonCode: SetRetentionPolicyReasonCode) {
    super("set_retention_policy_failed");
  }
}

/**
 * `member.manage` is the closest existing facilitator-only write action in the matrix
 * (project-wide administrative write, not per-artifact) -- reused rather than adding a
 * second "is this caller the project owner" action for the same judgement
 * `project-role-matrix.ts`'s `member.manage` comment already made for F125.
 */
const WRITE_ACTION = "member.manage";

export interface SetRetentionPolicyDeps extends AuthorizeDeps {
  readonly retention: RetentionPolicyRepository;
  readonly defaults: SetRetentionPolicyResult;
}

export interface SetRetentionPolicyInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly params: Partial<SetRetentionPolicyResult>;
}

export async function setRetentionPolicy(
  deps: SetRetentionPolicyDeps,
  input: SetRetentionPolicyInput,
): Promise<SetRetentionPolicyResult> {
  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: WRITE_ACTION,
  });
  if (!decision.allowed) throw new SetRetentionPolicyError("PROJECT_ROLE_INSUFFICIENT");

  const existingOverride = await deps.retention.getOverride(input.orgId, input.projectId);
  const current = resolveRetentionParams(deps.defaults, existingOverride);

  let merged;
  try {
    merged = mergeRetentionOverride(current, input.params);
  } catch (e) {
    if (e instanceof RetentionParamInvalidError) throw new SetRetentionPolicyError("RETENTION_PARAM_INVALID");
    throw e;
  }

  // Persist only the fields this project has actually overridden (existing override merged
  // with the new patch), not the fully-resolved record -- writing `merged` verbatim would
  // freeze today's org default into every project's row the first time anyone calls this,
  // and a later change to `DEFAULT_RETENTION_PARAMS` would then silently stop reaching any
  // project that had ever overridden even ONE field.
  const nextOverride = { ...(existingOverride ?? {}), ...input.params };
  await deps.retention.setOverride({
    orgId: input.orgId,
    projectId: input.projectId,
    params: nextOverride,
    updatedBy: input.userId,
  });

  return merged;
}
