import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const spec = readFileSync(resolve(root, "apps/web/e2e/real-model-pdf-smoke.spec.ts"), "utf8");

describe("real-model PDF lane documents its consent before execution", () => {
  it("verifies the authenticated document grant before sending", () => {
    const setup = spec.indexOf("const persistedDocumentAutoApproveAtEntry =");
    const enable = spec.indexOf("if (!persistedDocumentAutoApproveAtEntry) await setDocumentAutoApproveFromApi(page, true)", setup);
    const verify = spec.indexOf("expect(await readDocumentAutoApproveFromApi(page)).toBe(true)", enable);
    const send = spec.indexOf("await send.click()");
    expect(setup).toBeGreaterThan(-1);
    expect(enable).toBeGreaterThan(setup);
    expect(verify).toBeGreaterThan(enable);
    expect(send).toBeGreaterThan(verify);
    expect(spec).toContain('getByTestId("chat-document-generation-auto-approve-toggle")).toHaveCount(0)');
    expect(spec).toContain('authenticatedSessionRequest(page, path, "PUT", { enabled })');
    expect(spec).toContain('authenticatedSessionRequest(page, path, "GET")');
  });

  it("restores the exact initial grant through authenticated API even when UI is blocked", () => {
    const afterEach = spec.slice(spec.indexOf("test.afterEach("), spec.indexOf("async function login"));
    expect(afterEach).toContain("documentAutoApproveInitial !== null");
    expect(afterEach).toContain("setDocumentAutoApproveFromApi(page, documentAutoApproveInitial)");
    expect(afterEach).not.toContain("setDocumentAutoApproveFromUi");
    expect(spec).toContain("authenticatedSessionRequest(page, path, \"PUT\", { enabled })");
    expect(spec).toContain("SESSION_TOKEN_STORAGE_KEY");
    expect(spec).toContain("window.localStorage.getItem(storageKey)");
    expect(spec).toContain('Authorization: `Bearer ${token}`');
    expect(spec).toContain("window.fetch(path");
    expect(spec).not.toContain("page.context().request");
    expect(spec).toContain('toEqual({ enabled })');
  });

  it("captures the initial grant before temporarily enabling it", () => {
    const read = spec.indexOf("const persistedDocumentAutoApproveAtEntry = await readDocumentAutoApproveFromApi(page)");
    const capture = spec.indexOf("documentAutoApproveInitial = persistedDocumentAutoApproveAtEntry");
    const enable = spec.indexOf("setDocumentAutoApproveFromApi(page, true)");
    expect(read).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(read);
    expect(enable).toBeGreaterThan(capture);
  });

  it("continues one confirm_task_intent card through real UI and records one decision POST", () => {
    expect(spec).toContain('getByRole("dialog", { name: "确认任务意图" })');
    expect(spec).toContain('getByTestId("agent-interrupt-confirm-intent-continue")');
    expect(spec).toContain("confirmIntentDecisionPosts += 1");
    expect(spec).toContain("confirmIntentDecisionPosts === 1");
    expect(spec).toContain('decision === "approve"');
  });
});
