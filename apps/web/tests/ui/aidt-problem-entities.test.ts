import { describe, expect, it } from "vitest";
import { addAidtProblem, archiveAidtProblem, listAidtProblems, readAidtProblemEntityDraft, updateAidtProblemEntity } from "@/features/aidt/lib/aidt-problem-entities";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

const first = "7eb11d00-2933-4370-8a26-43223e3153f1";
const second = "7eb11d00-2933-4370-8a26-43223e3153f2";

describe("AIDT problem entities", () => {
  it("preserves separate input and only projects an explicitly confirmed question for handoff", () => {
    let draft = addAidtProblem(addAidtProblem(emptyAidtUiDrafts()[1]!, first, "校园食堂"), second, "校车等候");
    draft = updateAidtProblemEntity(draft, first, value => ({ ...value, fields: { initial: "了解食堂" } }));
    draft = updateAidtProblemEntity(draft, second, value => ({ ...value, fields: { initial: "了解校车" } }));
    expect(readAidtProblemEntityDraft(draft, first).fields.initial).toBe("了解食堂");
    expect(readAidtProblemEntityDraft(draft, second).fields.initial).toBe("了解校车");
    expect(draft.fields.problemHandoffEntity).toBeUndefined();
    draft = updateAidtProblemEntity(draft, first, value => ({
      ...value, fields: { ...value.fields, rewrittenTheme: "学生怎样选午餐？", roundCompletion: "confirmed" },
    }));
    expect(draft.fields.problemHandoffEntity).toBe(first);
    expect(draft.fields.rewrittenTheme).toBe("学生怎样选午餐？");
    expect(readAidtProblemEntityDraft(draft, second).fields.rewrittenTheme).toBeUndefined();
    draft = archiveAidtProblem(draft, first);
    expect(listAidtProblems(draft).find(entry => entry.id === first)?.archived).toBe(true);
    expect(readAidtProblemEntityDraft(draft, first).fields.initial).toBe("了解食堂");
  });
});
