import { expect, it, vi } from "vitest";
import { createSkillActivityWriter } from "../../src/application/agent-run/skill-activity-writer";
import { toOrgId } from "../../src/domain/org-id";

const fact = { contractVersion: 1 as const, factId: "read-1", skillId: "skill-1",
  skillStableName: "report", skillVersion: "v1", packageDigest: "a".repeat(64),
  stage: "body_read" as const, readPath: "/skills/report/SKILL.md" };

it("does not acknowledge a fact without a persistent writer", async () => {
  await expect(createSkillActivityWriter({}, toOrgId("org"), "run", "attempt")(fact))
    .rejects.toThrow("skill_activity_writer_unavailable");
});

it("binds trusted identity and waits for journal acknowledgement", async () => {
  let acknowledge!: () => void;
  const appendExecutionEvent = vi.fn(async () => new Promise<void>(resolve => { acknowledge = resolve; }));
  let done = false;
  const pending = createSkillActivityWriter({ appendExecutionEvent }, toOrgId("org"), "run", "attempt")(fact)
    .then(() => { done = true; });
  expect(done).toBe(false);
  expect(appendExecutionEvent).toHaveBeenCalledWith("org", "run", { kind: "skill_activity", attemptId: "attempt", fact });
  acknowledge();
  await pending;
  expect(done).toBe(true);
});

it("propagates journal failure", async () => {
  const appendExecutionEvent = vi.fn(async () => { throw new Error("journal_write_failed"); });
  await expect(createSkillActivityWriter({ appendExecutionEvent }, toOrgId("org"), "run", "attempt")(fact))
    .rejects.toThrow("journal_write_failed");
});
