/**
 * F46 -- `getRetentionPolicy` (O-01, D-14, N-20). Resolution logic itself lives in
 * `domain/files/retention-policy.ts`'s `resolveRetentionParams`; this file only wires the
 * lookup + the read-access gate.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { resolveRetentionParams } from "../../domain/files/retention-policy";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { RetentionPolicyRepository } from "./retention-policy-ports";

export type GetRetentionPolicyResult = z.infer<typeof C.operations.getRetentionPolicy.out>;

export class GetRetentionPolicyError extends Error {
  constructor(readonly reasonCode: "PROJECT_ROLE_INSUFFICIENT") {
    super("get_retention_policy_failed");
  }
}

/**
 * Any project role may READ the resolved config (R3.d: the reminder is meant to be visible
 * to a project's owner, not gated behind compliance) -- `read.published` is the existing
 * least-restrictive read action every one of the four roles already carries, reused rather
 * than a fresh action invented for a plain informational read.
 */
const READ_ACTION = "read.published";

export interface GetRetentionPolicyDeps extends AuthorizeDeps {
  readonly retention: RetentionPolicyRepository;
  readonly defaults: GetRetentionPolicyResult;
}

export interface GetRetentionPolicyInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string | null;
}

export async function getRetentionPolicy(
  deps: GetRetentionPolicyDeps,
  input: GetRetentionPolicyInput,
): Promise<GetRetentionPolicyResult> {
  if (input.projectId === null) {
    // No project context: the org-wide answer is the injected default, full stop -- there is
    // no per-org override table (see `retention_policies`' migration header for why).
    return deps.defaults;
  }

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: READ_ACTION,
  });
  if (!decision.allowed) throw new GetRetentionPolicyError("PROJECT_ROLE_INSUFFICIENT");

  const override = await deps.retention.getOverride(input.orgId, input.projectId);
  return resolveRetentionParams(deps.defaults, override);
}
