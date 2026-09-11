import { expect, it, vi } from "vitest";
import { previewDeleteImpact } from "../../src/application/files/preview-delete-impact";
import { requestDeletion, type RequestDeletionDeps } from "../../src/application/files/request-deletion";
import { FakeIdentityRepository, FakeDeleteImpactRepository, FakeLegalHoldRepository,
  FakeDeletionTaskRepository, FakeProvenanceWriter, SeqIdFactory, SeqDecisionIds, ORG, FACILITATOR } from "../support/trash-compliance-fakes";
it("does not treat absent project context as a grant to perform project compliance actions", async () => {
  const impact = new FakeDeleteImpactRepository(); impact.add({ artifactId: "unscoped", projectId: null, title: "file" });
  const invalidateLocalCascades = vi.fn();
  const deps: RequestDeletionDeps = { impact, repo: new FakeIdentityRepository(), ids: new SeqDecisionIds(),
    legalHold: new FakeLegalHoldRepository(), cascades: { invalidateLocalCascades }, tasks: new FakeDeletionTaskRepository(),
    provenance: new FakeProvenanceWriter(), idFactory: new SeqIdFactory(), now: () => new Date(), trashGraceDays: async () => 30 };
  const actor = { orgId: ORG, userId: FACILITATOR, artifactId: "unscoped", actorKind: "user" as const };
  await expect(previewDeleteImpact(deps, actor)).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  await expect(requestDeletion(deps, { ...actor, scope: null, confirmedImpact: true, reason: "test reason" })).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });
  expect(invalidateLocalCascades).not.toHaveBeenCalled();
});
