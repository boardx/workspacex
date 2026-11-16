import { expect, it } from "vitest";
import { aidtStageContextSelector, aidtSummaryContextSelector } from "@/features/aidt/lib/aidt-native-context-selector";
it("selects only exact persisted coordinates, never student bodies or identities", () => {
  expect(aidtStageContextSelector("p", 3, [{ stageNumber: 1, revision: 7 }, { stageNumber: 3, revision: 2 }], "8")).toEqual({ schemaVersion: 1, projectId: "p", purpose: "stage", stageId: 3, stageRevisions: [{ stageId: 1, revision: 7 }, { stageId: 3, revision: 2 }], returnRevision: 8 });
});
it("rejects ambiguous/future/noncanonical return selection rather than falling back", () => {
  for (const refs of [[{ stageNumber: 4, revision: 1 }], [{ stageNumber: 1, revision: 1 }, { stageNumber: 1, revision: 2 }]]) expect(() => aidtStageContextSelector("p", 3, refs)).toThrow();
  for (const revision of ["latest", "0", "01", "1e2"]) expect(() => aidtStageContextSelector("p", 3, [], revision)).toThrow();
  expect(() => aidtStageContextSelector("p", 6, [], "1")).toThrow();
});
it("uses separately collected current and historical revisions and rejects other projects", () => {
  const packet = { projectId: "p", currentStages: [{ stageId: 6, revision: 9, markdown: "not transmitted" }], historyRevisions: [{ stageId: 6, revision: 2 }] };
  expect(aidtSummaryContextSelector("p", packet)).toEqual({ schemaVersion: 1, projectId: "p", purpose: "summary", stageRevisions: [{ stageId: 6, revision: 9 }], historyRevisions: [{ stageId: 6, revision: 2 }] });
  expect(() => aidtSummaryContextSelector("foreign", packet)).toThrow();
});
