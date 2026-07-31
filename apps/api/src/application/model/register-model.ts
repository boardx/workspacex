/**
 * `registerModel` (F48 / uc-20-1 R3 steps 1-3).
 *
 * Accepts a model into the pool in state `待测试`, sealing its credential on the way past.
 *
 * ## Two orderings that are part of the contract, not implementation detail
 *
 * 1. **The vocabulary check runs before anything is sealed or written.** uc-20-1 E2: a
 *    rejected registration must not leave half a configuration behind. Sealing first and
 *    validating second would produce a ciphertext with no row to own it.
 *
 * 2. **The plaintext is sealed before the row is projected.** `projectPoolRow` builds the
 *    response from a whitelist, so it would drop the credential anyway -- but the local
 *    variable holding the plaintext ends its life here rather than travelling into the
 *    projection call, so a future edit to the projection cannot reach it.
 */
import { checkComplianceAttrs, COMPLIANCE_ATTR_UNKNOWN } from "../../domain/model/compliance-attrs";
import { sealCredential, type CredentialCipher } from "../../domain/model/credential-vault";
import {
  INITIAL_MODEL_STATUS,
  projectPoolRow,
  type ModelPoolRow,
  type RegisterModelInput,
} from "../../domain/model/registry";
import type { ComplianceVocabularyReader, ModelPoolClock, ModelPoolRepository } from "./ports";

export type RegisterModelResult =
  | { readonly ok: true; readonly row: ModelPoolRow }
  | {
      readonly ok: false;
      readonly code: typeof COMPLIANCE_ATTR_UNKNOWN;
      /**
       * The offending values, which are the admin's own submission -- echoing them back is
       * not a disclosure, and without them the error is unactionable.
       */
      readonly unknown: readonly string[];
    };

export interface RegisterModelDeps {
  readonly repository: ModelPoolRepository;
  readonly cipher: CredentialCipher;
  readonly vocabulary: ComplianceVocabularyReader;
  readonly clock: ModelPoolClock;
}

export async function registerModel(
  orgId: string,
  input: RegisterModelInput,
  deps: RegisterModelDeps,
): Promise<RegisterModelResult> {
  const vocabulary = await deps.vocabulary.forOrg(orgId);
  const checked = checkComplianceAttrs(input.complianceAttrs, vocabulary);
  if (!checked.ok) return { ok: false, code: checked.code, unknown: checked.unknown };

  const sealedAt = deps.clock.now();
  const credential =
    input.credential === null ? null : sealCredential(input.credential, deps.cipher, sealedAt);
  // The endpoint is sealed too. It is not a secret in the way a key is, but uc-21-1 treats
  // an internal address as sensitive for the same reason (`domain.md` B: "内网地址属敏感
  // 信息"), and a model's endpoint is the same kind of fact about the same network.
  const endpoint =
    input.endpoint === null ? null : sealCredential(input.endpoint, deps.cipher, sealedAt);

  const row = projectPoolRow(
    { ...input, complianceAttrs: [...checked.attrs] },
    { modelId: deps.clock.newModelId(), status: INITIAL_MODEL_STATUS },
  );
  await deps.repository.insert({ orgId, row, credential, endpoint });
  return { ok: true, row };
}
