import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { aidtContextCanonicalJson } from "@repo/contracts/aidt-run-context";
import { type PlanReviewRequest, validateAidtPlanReview } from "../e2e/support/aidt-v2-plan-review";
const args = { todos: [{ content: "核对本组保存材料，不代学生确认", status: "completed" }] };
const request: PlanReviewRequest = { projectId: "group", threadId: "thread", runId: "run", permissionRequestId: "permission", toolName: "write_todos", args,
  argsDigest: createHash("sha256").update(aidtContextCanonicalJson(args)).digest("hex") };
const proof = { ...request, args: undefined, decision: "once", reviewedFullArgs: true, reviewedBy: "root" };
it("allows only root's exact current run/thread/permission/full-args digest review", () => {
  expect(() => validateAidtPlanReview(request, proof)).not.toThrow();
  for (const mismatch of [{ runId: "old-run" }, { threadId: "other-thread" }, { projectId: "other-group" }, { permissionRequestId: "old-permission" },
    { argsDigest: "0".repeat(64) }, { reviewedFullArgs: false }, { decision: "always" }, { toolName: "save_stage" }]) {
    expect(() => validateAidtPlanReview(request, { ...proof, ...mismatch })).toThrow("FULL_ARGS_EXACT_ROOT_REVIEW_REQUIRED");
  }
});
it("refuses the same approval after any argument mutation", () => {
  expect(() => validateAidtPlanReview({ ...request, args: { todos: [{ content: "替学生确认结论", status: "completed" }] } }, proof)).toThrow("ARGS_DIGEST_MISMATCH");
});
