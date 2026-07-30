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
import type { SealedCredential } from "../../domain/model/credential-vault";
import type { ModelPoolRow, ModelStatus } from "../../domain/model/registry";

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
