/**
 * Ports for the model pool (F48). Declared by the use-case layer, implemented outside it.
 *
 * ## The credential port is WRITE-ONLY, and that is the interface's job to make true
 *
 * `ModelPoolRepository` can store a `SealedCredential` and can report WHETHER one is
 * configured. It has no method that returns one. A repository interface with a
 * `readCredential` on it would make "never echoed" a discipline every future caller has to
 * remember; without one, the leak is not something a use case can write by accident -- it
 * needs a new method, which needs a review.
 *
 * The outbound provider call will eventually need the plaintext. When that arrives it gets
 * its OWN port, on the infrastructure side, holding the decryption key, with the gateway as
 * its only consumer (`routeModelCall` is the single execution point, I-15). It does not
 * arrive by adding a getter here.
 */
import type {
  AdmissionTestItem,
  AdmissionVerdict,
  StoredAdmissionTest,
} from "../../domain/model/admission";
import type { SealedCredential } from "../../domain/model/credential-vault";
import type {
  DisableMode,
  ModelKind,
  ModelPoolRow,
  ModelShape,
  ModelStatus,
} from "../../domain/model/registry";

/** What a stored row looks like coming back. Never carries the credential or the endpoint. */
export interface StoredModel {
  readonly row: ModelPoolRow;
  /** The one bit about the credential that may cross this boundary. */
  readonly credentialConfigured: boolean;
}

export interface ModelPoolRepository {
  /**
   * Persist a new pool entry with its sealed credential.
   *
   * ⚠ Sealed, not plaintext: the type makes it impossible to hand this a raw secret, so
   * "the repository encrypts it" is never a promise anyone has to keep.
   */
  insert(input: {
    readonly orgId: string;
    readonly row: ModelPoolRow;
    readonly credential: SealedCredential | null;
    readonly endpoint: SealedCredential | null;
  }): Promise<void>;

  /**
   * Every model this organization has configured.
   *
   * ⚠ An organization with no configuration returns `[]`. There is no default set, no
   * starter pack and no "if empty, fall back to" branch anywhere above this port -- that
   * branch is exactly what F15's acceptance V1 exists to forbid, and what
   * `no-hardcoded-model-list.test.ts` re-asserts for the model half.
   */
  listForOrg(orgId: string): Promise<readonly StoredModel[]>;
}

/** Encrypts on the way in. Symmetric by construction with `CredentialCipher`: no decrypt. */
export type { CredentialCipher } from "../../domain/model/credential-vault";

/** The organization's configured compliance vocabulary (O-38). Empty until it is supplied. */
export interface ComplianceVocabularyReader {
  forOrg(orgId: string): Promise<readonly string[]>;
}

/** Identifiers and timestamps, injected so the use case stays deterministic under test. */
export interface ModelPoolClock {
  now(): string;
  newModelId(): string;
}

/* ═══════════════ DI tokens (#548) ═══════════════ */
//
// ⚠ Symbols only -- no port INTERFACE is declared below this line, and none may be. The
// method list in `credential-never-echoed.test.ts` is exhaustive over this file, and its own
// comment warns that moving new surface into a second ports file would keep it green while
// widening what the layer can reach. Tokens carry no methods, so they are invisible to that
// scan for the right reason rather than by evasion.

export const MODEL_POOL_REPOSITORY = Symbol("ModelPoolRepository");
export const MODEL_CREDENTIAL_CIPHER = Symbol("ModelCredentialCipher");
export const COMPLIANCE_VOCABULARY_READER = Symbol("ComplianceVocabularyReader");
export const MODEL_POOL_CLOCK = Symbol("ModelPoolClock");

export type { ModelStatus };

/* ═══════════════ F49 · 五项准入判读（uc-20-1 R3 步骤 5, I-1 / I-7）═══════════════ */

/**
 * The admission log.
 *
 * ⚠ There is no `update` and no `delete` here, and unlike `ModelPoolRepository`'s
 * write-only credential that is NOT the guarantee -- it is only the convenient path. I-7 is
 * held by migration 0031's two triggers, because this table hangs off `organizations` AND
 * off `models` and a referential action skips the privilege check on the child table
 * (0013's header records that exact hole being live on `provenance_events` after a REVOKE
 * that read as correct). `test-verdict-immutable.test.ts` attacks the table in SQL as the
 * role that serves traffic, not through this interface.
 */
export interface AdmissionTestRepository {
  /**
   * Append one judgement. Returns it with the `seq` the store assigned, because "which of
   * these two is the later one" is the store's answer, not the caller's.
   */
  append(input: {
    readonly orgId: string;
    readonly modelId: string;
    readonly item: AdmissionTestItem;
    readonly verdict: AdmissionVerdict;
    readonly evidence: string;
    readonly judgedBy: string;
  }): Promise<StoredAdmissionTest>;

  /** The whole log for one model, oldest first. Never a summary: I-7 lives in the history. */
  listForModel(orgId: string, modelId: string): Promise<readonly StoredAdmissionTest[]>;
}

/** What `enableModel` needs to know about the record it is being asked to enable. */
export interface ModelShapeReader {
  /** `null` when the organization has no such model. */
  read(
    orgId: string,
    modelId: string,
  ): Promise<{ readonly shape: ModelShape; readonly memberIds: readonly string[] } | null>;
}

/* ═══════════════ F50 · 停用 + 可选范围过滤器（uc-20-2 R3 步骤 3–4, I-2 I-5 I-16）═══════════════ */

/** What `disableModel` needs to know about the record it is being asked to disable. */
export interface ModelKindStatusReader {
  /** `null` when the organization has no such model. */
  read(
    orgId: string,
    modelId: string,
  ): Promise<{ readonly kind: ModelKind; readonly version: string } | null>;

  /**
   * Every OTHER model in `已启用` with `kind === "self-hosted"` — i.e. what would still
   * stand if `excludingModelId` were disabled. Excludes the target itself so the count
   * cannot mistake "myself, about to go" for "another one still standing".
   */
  countOtherEnabledSelfHosted(orgId: string, excludingModelId: string): Promise<number>;
}

/**
 * The four-category reference enumeration — **无清单不得停用**.
 *
 * ⚠ `snapshot` must be re-fetchable and re-comparable: `disableModel.in.referenceSnapshotId`
 * proves the admin confirmed against THIS list, not a stale one loaded minutes ago. A
 * mismatch is reported as `VERSION_CHANGED` (the contract has no separate code for a stale
 * reference list — same "the world moved since you looked" bucket as a stale model version).
 */
export interface ModelReferenceReader {
  snapshot(
    orgId: string,
    modelId: string,
  ): Promise<{
    readonly referenceSnapshotId: string;
    readonly agents: readonly string[];
    readonly skills: readonly string[];
    readonly blueprintPolicies: readonly string[];
    readonly activeProjects: readonly string[];
    readonly inFlightCalls: number;
  }>;
}

/**
 * The write side of `disableModel`'s cascade.
 *
 * ⚠ No method here takes a replacement model id, for any parameter. That is not an
 * oversight to fill in later — "停用绝不静默换模型" means there is nothing for such a
 * parameter to do; a reference becomes `依赖失败` and stops being loaded, full stop.
 */
export interface ModelDisableWriter {
  /** Flip the target row itself to `已停用`. */
  disable(orgId: string, modelId: string): Promise<void>;

  /**
   * Mark every listed agent/skill as depending on a disabled model, so they read as
   * `依赖失败` and stop being loaded (I-16) — never reassigned to another model.
   */
  markDependencyFailed(input: {
    readonly orgId: string;
    readonly modelId: string;
    readonly agentIds: readonly string[];
    readonly skillIds: readonly string[];
  }): Promise<void>;

  /**
   * `mode: "interrupt"` — stop in-flight calls against this model now.
   * `mode: "drain"` — let the current round finish; new calls are refused from this point.
   * Returns however many calls were actually interrupted (always `0` for `"drain"`).
   */
  applyCallPolicy(orgId: string, modelId: string, mode: DisableMode): Promise<number>;
}

/** The status write `enableModel` performs once the gate opens. */
export interface ModelStatusWriter {
  setStatus(orgId: string, modelId: string, status: ModelStatus): Promise<void>;
}

/**
 * Where a REFUSED enable goes.
 *
 * ⚠ F49's `user_visible_behavior`: 「直接调接口置为已启用被拒绝并记审计」. The audit entry
 * is the deliverable, not a side effect -- an attempt to bypass the admission gate is
 * exactly the event an administrator needs to be able to find afterwards, and a refusal
 * that leaves no trace is indistinguishable from a request nobody made.
 */
export interface AdmissionAuditSink {
  enableRejected(entry: {
    readonly orgId: string;
    readonly modelId: string;
    readonly actorId: string;
    readonly code: string;
    /** Which items / members blocked it. uc-20-1: 「必须指出卡在哪一项」. */
    readonly detail: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}
