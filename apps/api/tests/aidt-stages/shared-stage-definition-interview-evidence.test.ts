import { expect, test } from "vitest";
import { definitionInterviewCoordinates, definitionInterviewEvidence } from "../../src/application/aidt-stages/definition-interview-evidence";
import type { SharedStageValue } from "@repo/contracts/aidt-stages";

function stage(stageId: 2 | 3, revision: number, fields: Record<string, string>): SharedStageValue {
  return { stageId, revision, projectId: "project", updatedBy: "student", updatedAt: "2026-11-22T00:00:00.000Z",
    sourceStageRevisions: stageId === 3 ? [{ stageId: 2, revision: 4 }] : [],
    content: { schemaVersion: 1, draft: { fields, ideas: [], selectedIdeaId: "" } } };
}

test("uses only selected confirmed interview records at the exact linked revision", () => {
  const definition = stage(3, 6, {
    definitionEvidenceRevision: "4",
    "definitionPersona:p": JSON.stringify({ id: "p", archived: false, cardIds: ["first", "pending"] }),
    "definitionHmw:h": JSON.stringify({ id: "h", archived: false, cardIds: ["sibling"] }),
  });
  const interviews = stage(2, 4, Object.fromEntries(["first", "pending", "sibling"].flatMap(id => [
    [`interviewRecord:${id}`, JSON.stringify({ id, code: id, displayName: `alias-${id}` })],
    [`interviewConfirmed:${id}`, id === "pending" ? "false" : "true"],
  ])));
  interviews.content.draft.discoveryCards = ["first", "pending", "sibling"].map(id => ({
    id, participantCode: id, headline: `headline-${id}`, headlineKind: "student-summary",
    context: "context", quote: "source quote", sourceRef: "", photoRef: "",
  }));
  expect(definitionInterviewEvidence(definition, "p", interviews)).toEqual({
    stageId: 2, revision: 4, cards: [{ interviewId: "first", cardId: "first", interview: "first · alias-first",
      headline: "headline-first", context: "context", headlineKind: "student-summary" }],
    unavailableCardIds: ["pending"],
  });
  expect(definitionInterviewEvidence(definition, "p", { ...interviews, revision: 5 })).toBeUndefined();
  expect(definitionInterviewEvidence(definition, "p", { ...interviews, projectId: "different" })).toBeUndefined();
  expect(definitionInterviewCoordinates({ ...definition, sourceStageRevisions: [] }, "p")).toBeUndefined();
  expect(definitionInterviewCoordinates(definition, "absent")).toBeUndefined();
});
