/**
 * Ports for the minimal no-tool AgentRun (Wave 2 delta §5, #414).
 *
 * ## There is exactly one model port, and it takes no provider choice
 *
 * `ModelCallPort.complete` receives the run's PINNED `modelProvider`/`modelId` and either
 * performs that one call or refuses. It has no "try the next one" parameter, no candidate
 * list and no default. §5 says one configured provider and no fallback; a port shaped to
 * accept alternatives would make that a discipline every future caller has to remember,
 * and the failure mode of forgetting is silent -- a run answered by a model nobody pinned.
 *
 * ## The snapshot is an INPUT to this layer, never something it resolves
 *
 * Everything the executor needs about the Agent arrives on `ClaimedAgentRun`, read from
 * the run row that #415 wrote at acceptance. Nothing here can ask for "the Agent's current
 * version": there is no method for it. That is deliberate -- §4 says an Agent's published
 * head moves while existing runs keep their stored version id, and a port that could
 * resolve a head is a port through which that invariant leaks.
 */
import { wave2Runtime as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** Derived from the contract's enums, never restated (ADR-020). */
export type RunFailureCode = z.infer<typeof C.AgentRunError>;
export type RunStepKind = z.infer<typeof C.AgentRunStepKind>;
export type RunLifecycleStatus = z.infer<typeof C.AgentRunStatus>;

/**
 * The outcome of claiming one run.
 *
 * A union rather than "return only the good ones", because a claim already moved the row
 * out of `queued`: dropping the unresolvable ones on the floor would leave them `running`
 * with no step and no terminal state -- a message that is simply never answered, and the
 * one outcome an operator cannot act on. The executor fails them explicitly.
 */
export type ClaimOutcome =
  | { readonly kind: "executable"; readonly run: ClaimedAgentRun }
  | { readonly kind: "unresolvable"; readonly runId: string };

/** One queued run, claimed for execution, carrying its whole acceptance snapshot. */
export interface ClaimedAgentRun {
  readonly runId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly inputMessageId: string;
  readonly inputText: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly instructions: string;
  /** In the snapshot's order. The order is part of the pinned fact, not a set. */
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
}

export interface PinnedSkillContent {
  readonly versionId: string;
  readonly content: string;
}

export interface AppendedRunStep {
  readonly runId: string;
  readonly seq: number;
  readonly kind: RunStepKind;
  readonly status: "succeeded" | "failed";
  readonly startedAt: string;
  readonly endedAt: string;
  readonly inputDigest: string | null;
  readonly outputDigest: string | null;
  readonly failureCode: RunFailureCode | null;
}

/** What `GET /agent-runs/:runId` projects, once the requester has been cleared. */
export interface RunProjection {
  readonly runId: string;
  readonly threadId: string;
  readonly inputMessageId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly skillVersionIds: readonly string[];
  readonly modelProvider: string;
  readonly modelId: string;
  readonly status: RunLifecycleStatus;
  readonly error: RunFailureCode | null;
  readonly resultMessageId: string | null;
  readonly steps: readonly Omit<AppendedRunStep, "runId" | "seq">[];
  readonly createdAt: string;
}

/** Ids only -- enough to ASK the visibility question, never enough to answer it. */
export interface RunLocator {
  readonly threadId: string;
  readonly projectId: string;
}

export interface AgentRunStore {
  /**
   * Atomically move up to `limit` of this tenant's `queued` runs to `running` and return
   * their snapshots. The claim IS the exactly-once guarantee: two concurrent executors
   * cannot both leave `queued`, so the single model call cannot be made twice.
   */
  claimQueued(orgId: OrgId, limit: number): Promise<readonly ClaimOutcome[]>;

  /**
   * The pinned Skill versions' root `SKILL.md`, in the order asked for.
   *
   * Returns fewer entries than requested when a pinned version is unreachable; the caller
   * fails the run. It must NOT silently substitute a newer version or drop the entry --
   * that would turn "runs never resolve a mutable latest" (§3) into a best-effort claim.
   */
  readPinnedSkills(
    orgId: OrgId,
    versionIds: readonly string[],
  ): Promise<readonly PinnedSkillContent[]>;

  appendStep(orgId: OrgId, step: AppendedRunStep): Promise<void>;

  /** Store the sole model call's output and enter `writeback_pending` (§6's first step). */
  storeOutputAwaitingWriteback(
    orgId: OrgId,
    runId: string,
    output: { readonly text: string },
  ): Promise<void>;

  /** Terminal failure with a stable, enumerated code. There is no free-text variant. */
  failRun(orgId: OrgId, runId: string, code: RunFailureCode): Promise<void>;

  findLocator(orgId: OrgId, runId: string): Promise<RunLocator | null>;

  readRun(orgId: OrgId, runId: string): Promise<Guarded<RunProjection> | null>;
}

export interface ModelCallInput {
  readonly modelProvider: string;
  readonly modelId: string;
  readonly system: string;
  readonly user: string;
}

/**
 * A refusal or failure from the one configured provider.
 *
 * It carries a `code` from the contract's enumeration and a `detail` that is for the
 * SERVER LOG only. Keeping the two on one object rather than putting the provider's text
 * into `message` is what makes the interface layer's job unmistakable: there is nothing
 * on this error a handler could pass through to a client by accident.
 */
export class ModelCallError extends Error {
  constructor(
    readonly code: RunFailureCode,
    readonly detail: string,
  ) {
    super(code);
    this.name = "ModelCallError";
  }
}

export interface ModelCallPort {
  /**
   * Perform the single model call for a pinned provider/model.
   *
   * Throws `ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED")` when `modelProvider` is not
   * the one provider this deployment configured. It does not substitute the configured
   * one: answering with a model the Agent version does not name is the failure §5 forbids.
   */
  complete(input: ModelCallInput): Promise<{ readonly text: string }>;
}

export interface AgentRunClock {
  now(): string;
  newStepId(): string;
}

/**
 * The executor as the composition root wires it.
 *
 * `tick` runs one bounded batch for one tenant and RESOLVES when the batch is done, so
 * tests can order "publish a new head" against "execute" instead of racing it. `kick` is
 * the fire-and-forget acceptance trigger; it is a no-op when this process is not the one
 * executing runs (`KERNEL_AGENT_RUN_AUTOSTART=0`).
 */
export interface AgentRunExecutorPort {
  tick(orgId: OrgId): Promise<number>;
  kick(orgId: OrgId): void;
}

export const AGENT_RUN_STORE = Symbol("AgentRunStore");
export const MODEL_CALL_PORT = Symbol("ModelCallPort");
export const AGENT_RUN_EXECUTOR = Symbol("AgentRunExecutor");
