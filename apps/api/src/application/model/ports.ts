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
import type { ModelPoolRow, ModelShape, ModelStatus } from "../../domain/model/registry";

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
