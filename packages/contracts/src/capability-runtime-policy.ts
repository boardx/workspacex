import { z } from "zod";
import { MCP_EXECUTION_LIMITS, McpRunSnapshotRef } from "./mcp-runtime-snapshot";
import { AgentRunError } from "./wave2-runtime";

/**
 * PROPOSED design delta for issue #3234. This module is intentionally not exported from
 * `index.ts` and does not amend any existing operation. Human UI / UC / API sign-off is still
 * required before an existing controller may consume these schemas.
 *
 * Existing status schemas remain authoritative: `agent-runtime.ModelStatus`,
 * `wave2-runtime.AgentRunStatus`, and the MCP review/connection statuses are not repeated here.
 */

const StableRef = z.string().trim().min(1).max(255);
const ConfigRevision = z.string().trim().min(1).max(128);

/** Stable model-pool identity plus the exact configuration revision admitted for a run. */
export const CapabilityModelConfigRef = z
  .object({
    capabilityModelId: StableRef,
    configRevision: ConfigRevision,
  })
  .strict();

/**
 * Resolves a single model-pool identity to the deployed adapter and upstream model identifier.
 * It deliberately has no status or credential fields: status stays in `ModelStatus`, and
 * credentials remain write-only in the existing model-management boundary. The current executor
 * accepts one provider call: composite admission must fail until an executor can freeze and run
 * every ordered member. A composite pool row cannot masquerade as its first member here.
 */
export const CapabilityModelRuntimeBinding = CapabilityModelConfigRef.extend({
  shape: z.literal("single"),
  providerKey: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  upstreamModelId: StableRef,
}).strict();

/** The immutable subject whose dependencies a trial run resolved. */
export const TrialRunSubjectRef = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("skill-draft"),
      skillId: StableRef,
      draftId: StableRef,
      draftRevision: z.number().int().positive(),
      snapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("agent-version"),
      agentId: StableRef,
      agentVersionId: StableRef,
    })
    .strict(),
]);

/**
 * Exact dependencies admitted before a trial run starts. `mcpSnapshotRef: null` means that the
 * run admitted no MCP tools; it never means "resolve the latest tools while executing".
 */
export const CapabilityTrialRunDependencySnapshot = z
  .object({
    dependencySnapshotId: z.string().uuid(),
    subject: TrialRunSubjectRef,
    modelBinding: CapabilityModelRuntimeBinding,
    mcpSnapshotRef: McpRunSnapshotRef.nullable(),
    capturedAt: z.string().datetime({ offset: true }),
  })
  .strict();

/**
 * Unambiguous write intent for an MCP credential. The existing nullable credential inputs must
 * not be reinterpreted: adopting this union on an existing operation requires a signed delta.
 */
export const McpCredentialMutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }).strict(),
  z.object({ action: z.literal("clear") }).strict(),
  z
    .object({
      action: z.literal("replace"),
      credential: z.string().min(1).max(MCP_EXECUTION_LIMITS.maxCredentialBytes).refine(
        (value) => new TextEncoder().encode(value).byteLength <= MCP_EXECUTION_LIMITS.maxCredentialBytes,
        { message: "credential exceeds UTF-8 byte limit" },
      ),
    })
    .strict(),
]);

/**
 * Server-derived references attached to feedback for a failed run. This shape excludes prompt,
 * endpoint, provider/upstream identifiers, credentials, and caller-supplied attribution.
 */
export const RuntimeFailureAttributionRefs = z
  .object({
    runId: StableRef,
    agentId: StableRef,
    agentVersionId: StableRef,
    skillVersionIds: z.array(StableRef).max(64),
    modelConfigRef: CapabilityModelConfigRef.nullable(),
    mcpSnapshotRef: McpRunSnapshotRef.nullable(),
    failureCode: AgentRunError,
  })
  .strict()
  .refine((value) => new Set(value.skillVersionIds).size === value.skillVersionIds.length, {
    path: ["skillVersionIds"],
    message: "duplicate skill version reference",
  });

/**
 * Review checklist only; these are explicit deltas, not operation declarations. Existing strict
 * schemas continue to reject the proposed fields until human sign-off and a separate change.
 */
export const CAPABILITY_RUNTIME_POLICY_DESIGN_DELTAS = {
  modelRuntimeBinding: {
    existingOperations: [
      "agent-runtime.registerModel",
      "agent-runtime.configureModel",
      "agent-runtime.listModelPool",
      "agent-runtime.listSelectableModels",
      "agent-runtime.routeModelCall",
    ],
    delta: "Carry capabilityModelId -> providerKey + upstreamModelId at an exact configRevision; do not add another model status.",
  },
  trialRunDependencies: {
    existingOperations: ["skills.runTrialRun", "agent-runtime.trialRunAgent"],
    delta: "Accept or return an exact dependency snapshot reference; never resolve a newer draft, model config, or MCP tool set after admission.",
  },
  mcpCredentialMutation: {
    existingOperations: ["agent-runtime.registerMcpServer", "agent-runtime.discoverRemoteMcpTools"],
    delta: "Replace nullable credential ambiguity with keep | replace | clear only after the existing operations are re-signed.",
  },
  failedRunFeedback: {
    existingOperations: ["wave2-runtime.getAgentRun"],
    delta: "A future failure-feedback operation derives attribution references from runId on the server; clients cannot submit those references.",
  },
} as const;
