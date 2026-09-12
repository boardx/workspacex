import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const spec = readFileSync(resolve(root, "apps/web/e2e/real-model-pdf-smoke.spec.ts"), "utf8");

describe("real-model PDF lane documents its consent before execution", () => {
  it("enables the persisted document grant through the real UI before sending", () => {
    const enable = spec.indexOf("setDocumentAutoApproveFromUi(page, true)");
    const send = spec.indexOf("await send.click()");
    expect(enable).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(enable);
    expect(spec).toContain('getByTestId("chat-document-generation-auto-approve-toggle")');
    expect(spec).toContain('response.request().method() === "PUT"');
    expect(spec).toContain('path.endsWith("/document-generation-auto-approve")');
    expect(spec).toContain('expect(response.ok(), "文档自动批准开关的 PUT 必须成功").toBe(true)');
    expect(spec).toContain('toEqual({ enabled })');
    expect(spec).toContain('toHaveAttribute("aria-checked", expected)');
  });

  it("restores the exact initial grant through authenticated API even when UI is blocked", () => {
    const afterEach = spec.slice(spec.indexOf("test.afterEach("), spec.indexOf("async function login"));
    expect(afterEach).toContain("documentAutoApproveInitial !== null");
    expect(afterEach).toContain("setDocumentAutoApproveFromApi(page, documentAutoApproveInitial)");
    expect(afterEach).not.toContain("setDocumentAutoApproveFromUi");
    expect(spec).toContain("const request = page.context().request");
    expect(spec).toContain('request.put(path, { data: { enabled } })');
    expect(spec).toContain("await request.get(path)");
    expect(spec).toContain('toEqual({ enabled })');
  });

  it("cleans a historical grant residue before reenacting UI consent", () => {
    const read = spec.indexOf("readDocumentAutoApproveFromApi(page)");
    const reset = spec.indexOf("setDocumentAutoApproveFromApi(page, false)");
    const enable = spec.indexOf("setDocumentAutoApproveFromUi(page, true)");
    expect(read).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(read);
    expect(enable).toBeGreaterThan(reset);
    expect(spec).toContain('toHaveAttribute("aria-checked", "false")');
  });

  it("continues one confirm_task_intent card through real UI and records one decision POST", () => {
    expect(spec).toContain('getByRole("dialog", { name: "确认任务意图" })');
    expect(spec).toContain('getByTestId("agent-interrupt-confirm-intent-continue")');
    expect(spec).toContain("confirmIntentDecisionPosts += 1");
    expect(spec).toContain("confirmIntentDecisionPosts === 1");
    expect(spec).toContain('decision === "approve"');
  });
});
