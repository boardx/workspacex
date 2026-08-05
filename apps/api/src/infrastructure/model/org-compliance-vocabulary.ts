/**
 * `ComplianceVocabularyReader` (F48 / O-38, invariant I-8).
 *
 * ## Why this returns an empty list, and why that is the ruling rather than a stub
 *
 * O-38 defines the vocabulary as `部署区域清单 ∩ 目标客户法域清单`. Both are external inputs
 * that do not exist yet, and `domain.md` 三③ rules: 「controlled enum, values read from
 * configuration, vocabulary currently EMPTY -- and that does not block coding」.
 *
 * There is correspondingly NO storage for it: migration 0019 deliberately puts no CHECK
 * constraint on `models.compliance_attrs` (its own comment: 「A CHECK here would be a second
 * copy of a value domain that has no first copy」), and `organizations` has no settings
 * column. So this reader has nothing to query -- it is not a Pg repository with the query
 * left out, which is why it is not named `Pg...`.
 *
 * ## The empty vocabulary is a CLOSED door, not an open one
 *
 * `checkComplianceAttrs` treats an empty vocabulary as "only `[]` is valid" rather than
 * "anything goes" (see its header). So today `registerModel` accepts a model with no
 * compliance attributes and rejects every non-empty submission with
 * `COMPLIANCE_ATTR_UNKNOWN`. That is the fail-closed direction and it is deliberate: the
 * alternative turns the window before configuration exists into the one period where
 * arbitrary strings enter the column a later routing rule will trust.
 *
 * ⚠ Do not "temporarily" seed `["境内", "境外"]` here to make the console render something.
 * `no-hardcoded-model-list.test.ts` scans the domain for exactly that literal, and it would
 * be the value domain that decides which models may touch a jurisdiction's data -- declared
 * in the one place nobody would look for a policy.
 */
import type { ComplianceVocabularyReader } from "../../application/model/ports";

export class OrgComplianceVocabulary implements ComplianceVocabularyReader {
  /**
   * ⚠ `orgId` is accepted and unused. The parameter is not dead weight: the vocabulary IS
   * per-organization (O-38), so when the two source lists arrive this signature does not
   * change and no caller is touched. A reader declared without it would have to grow one.
   */
  async forOrg(_orgId: string): Promise<readonly string[]> {
    return [];
  }
}
