import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { aidtContextCanonicalJson } from "@repo/contracts/aidt-run-context";
import { wave2Runtime, planPermissions } from "@repo/contracts";
import { apiPath } from "./real-model-api";
import { aidtV2Api } from "./aidt-v2-acceptance";

export type PlanReviewRequest = { projectId: string; threadId: string; runId: string; permissionRequestId: string; toolName: "write_todos"; args: unknown; argsDigest: string };
export function validateAidtPlanReview(request: PlanReviewRequest, proof: unknown): void {
  const row = proof as Record<string, unknown> | null;
  if (!row || row.decision !== "once" || row.reviewedFullArgs !== true || row.reviewedBy !== "root"
    || ["projectId", "threadId", "runId", "permissionRequestId", "toolName", "argsDigest"].some(key => row[key] !== request[key as keyof PlanReviewRequest])) throw new Error("AIDT_PLAN_FULL_ARGS_EXACT_ROOT_REVIEW_REQUIRED");
  if (createHash("sha256").update(aidtContextCanonicalJson(request.args)).digest("hex") !== request.argsDigest) throw new Error("AIDT_PLAN_ARGS_DIGEST_MISMATCH");
}
/** No proof means no click. Review continues this durable run, never sends another student message. */
export async function reviewAidtCurrentPlanOnce(page: Page, projectId: string, threadId: string, runId: string) {
  const directory = process.env.AIDT_V2_PLAN_REVIEW_DIR;
  if (!directory || !isAbsolute(directory)) throw new Error("AIDT_PLAN_REVIEW_DIRECTORY_REQUIRED");
  expect(new URL(page.url()).pathname).toBe(`/aidt/${projectId}`);
  const result = await aidtV2Api(page, `/agent-runs/${runId}`);
  expect(result.status).toBe(200);
  const run = wave2Runtime.operations.getAgentRun.out.parse(result.data);
  expect(run).toMatchObject({ runId, threadId, status: "awaiting_tool_permission" });
  const approval = run.pendingApproval!; expect(approval.toolName).toBe("write_todos");
  const permissionRequestId = approval.permissionRequestId;
  if (typeof permissionRequestId !== "string" || !permissionRequestId) throw new Error("AIDT_PLAN_PERMISSION_ID_REQUIRED");
  const args = JSON.parse(approval.argsSummary!) as { todos: { content: string; status: string }[] };
  expect(Object.keys(args)).toEqual(["todos"]); expect(args.todos.length).toBeGreaterThan(0);
  for (const todo of args.todos) { expect(Object.keys(todo).sort()).toEqual(["content", "status"]); expect(todo.content.trim()).toBeTruthy(); expect(["pending", "in_progress", "completed"]).toContain(todo.status); }
  const request: PlanReviewRequest = { projectId, threadId, runId, permissionRequestId, toolName: "write_todos", args,
    argsDigest: createHash("sha256").update(aidtContextCanonicalJson(args)).digest("hex") };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const pendingFile = join(directory, `${runId}.pending.json`), proofFile = join(directory, `${runId}.approved.json`);
  if (!existsSync(pendingFile)) writeFileSync(pendingFile, JSON.stringify(request, null, 2), { flag: "wx", mode: 0o600 });
  else expect(JSON.parse(readFileSync(pendingFile, "utf8"))).toEqual(request);
  console.info(`[aidt-v2] ROOT_REVIEW_REQUIRED ${pendingFile}`);
  await expect.poll(() => existsSync(proofFile), { timeout: 180_000, intervals: [500, 1_000] }).toBe(true);
  validateAidtPlanReview(request, JSON.parse(readFileSync(proofFile, "utf8")));
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "审批高风险操作", exact: true }) });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText("调用工具 write_todos", { exact: true })).toBeVisible();
  expect(JSON.parse(await dialog.locator("code").innerText())).toEqual(args);
  const path = planPermissions.operations.decidePermissionRequest.path.replace(":runId", runId).replace(":permissionRequestId", permissionRequestId);
  const response = page.waitForResponse(value => value.request().method() === "POST" && new URL(value.url()).pathname === apiPath(path));
  await dialog.getByRole("button", { name: "仅本次允许", exact: true }).click();
  const decided = await response; expect(decided.status()).toBe(200); expect(decided.request().postDataJSON()).toEqual({ decision: "once" });
  return { ...request, decision: "once", proofFile, newStudentMessage: false, newReservation: false };
}
