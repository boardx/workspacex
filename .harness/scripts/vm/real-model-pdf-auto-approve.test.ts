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

  it("restores a grant that this lane created", () => {
    const afterEach = spec.slice(spec.indexOf("test.afterEach("), spec.indexOf("async function login"));
    expect(afterEach).toContain("documentAutoApproveInitial === false");
    expect(afterEach).toContain("setDocumentAutoApproveFromUi(page, false)");
  });
});
