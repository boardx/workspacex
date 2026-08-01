/**
 * F39 -- the real `ReviewGate` `ingestion-worker.ts` (F36) left as a port: "confidential ∨
 * PII five-class ∨ low parse quality" (uc-22-2 R3 step 11, O-39).
 *
 * `ingestion-worker.ts`'s own comment on `NEVER_NEEDS_REVIEW` says this plainly: the
 * threshold/PII detector was deliberately left a PORT because `contracts/files/
 * design-signoff.md` T-9 (the parse-quality threshold, and the reviewer role) is undecided.
 * This module is that port's first real implementation, structural on the two decided legs
 * (confidential, PII) and conservative on the undecided one (parse quality never trips this
 * gate on its own until T-9 is ratified with an actual number -- the same "nothing routes to
 * review yet" stance `NEVER_NEEDS_REVIEW` took for ALL three legs, narrowed here to just the
 * one still-undecided leg instead of all of them).
 */
import type { ArtifactRepository, ObjectStore } from "../artifact/ports";
import type { ReviewGate } from "./ingestion-worker";
import type { ConfidentialityLookup } from "./review-ports";
import { hasPii } from "../../domain/files/pii-detect";
import type { OrgId } from "../../domain/org-id";

const DECODER = new TextDecoder("utf-8", { fatal: false });

export interface StructuralReviewGateDeps {
  readonly artifacts: Pick<ArtifactRepository, "findVersion" | "listDerived">;
  readonly confidentiality: ConfidentialityLookup;
  /** Reads a derived representation's bytes to scan for PII. Absent = PII leg never trips
   *  (same "undefined = no-op" shape `ingestion-worker.ts`'s own `store?` already uses). */
  readonly store?: ObjectStore;
}

export class StructuralReviewGate implements ReviewGate {
  constructor(private readonly deps: StructuralReviewGateDeps) {}

  async needsReview(input: { readonly orgId: OrgId; readonly artifactVersionId: string }): Promise<boolean> {
    const version = await this.deps.artifacts.findVersion(input.orgId, input.artifactVersionId);
    if (version === null) return false;

    // Leg ① 机密标记 -- material-level, O-17.
    if (await this.deps.confidentiality.isConfidential(input.orgId, version.artifactId)) return true;

    // Leg ② PII 五类 -- scan every derived text this version has produced so far (F37's four
    // adapters all materialize an independent derived file; a version can have more than one
    // if OCR/ASR were rerun -- ANY of them containing PII is enough to route to review).
    if (this.deps.store !== undefined) {
      const derived = await this.deps.artifacts.listDerived(input.orgId, version.artifactId);
      for (const d of derived) {
        if (d.objectStorageKey === null) continue; // embedding rows carry no readable text
        const bytes = await this.deps.store.get(d.objectStorageKey);
        if (bytes === null) continue;
        if (hasPii(DECODER.decode(bytes))) return true;
      }
    }

    // Leg ③ 解析质量低于阈值 -- `[待定 T-9]`. No confidence signal exists anywhere in the
    // extraction pipeline yet (`domain/files/extraction-adapters.ts` produces no such field),
    // so asserting a number here would be inventing the very threshold T-9 defers. This gate
    // stays a real fork on the two decided legs without pretending the third is decided.
    return false;
  }
}
