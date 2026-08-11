/**
 * #946 · F153/W1 —— `planExtraction` 纯领域映射的单测（无 anydoc / 无 I/O）。
 * 关键反证：契约白名单里**每一个** MIME 都必须有抽取计划——遍历契约常量断言无遗漏，
 * 防「加了新白名单类型却没给它抽取路径」悄悄漏过。白名单不在此复述，只对它做全覆盖。
 */
import { describe, expect, it } from "vitest";
import { chatFileUpload as CFU } from "@repo/contracts";
import { planExtraction } from "../../src/domain/chat/attachment-extraction";

describe("planExtraction", () => {
  it("契约白名单每一个 MIME 都有计划（全覆盖，防漏）", () => {
    for (const mime of CFU.ATTACHMENT_MIME_ALLOWLIST) {
      const plan = planExtraction(mime);
      expect(plan.kind, `${mime} 应有抽取计划`).toMatch(/^(convert|passthrough|unsupported)$/);
    }
  });

  it("office/pdf/csv → convert，且 format 正确", () => {
    expect(planExtraction("application/pdf")).toEqual({ kind: "convert", format: "pdf" });
    expect(planExtraction("text/csv")).toEqual({ kind: "convert", format: "csv" });
    expect(planExtraction("application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
      .toEqual({ kind: "convert", format: "docx" });
    expect(planExtraction("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
      .toEqual({ kind: "convert", format: "xlsx" });
    expect(planExtraction("application/vnd.openxmlformats-officedocument.presentationml.presentation"))
      .toEqual({ kind: "convert", format: "pptx" });
  });

  it("txt/md → passthrough（本身即文本，不进 anydoc）", () => {
    expect(planExtraction("text/plain")).toEqual({ kind: "passthrough" });
    expect(planExtraction("text/markdown")).toEqual({ kind: "passthrough" });
  });

  it("图片 → unsupported（没有文字层；OCR 归 CE-014，不在此）", () => {
    expect(planExtraction("image/png")).toEqual({ kind: "unsupported", reason: "image" });
    expect(planExtraction("image/jpeg")).toEqual({ kind: "unsupported", reason: "image" });
    expect(planExtraction("image/webp")).toEqual({ kind: "unsupported", reason: "image" });
  });

  it("白名单外的 MIME → 保守 unsupported，不臆造 format", () => {
    expect(planExtraction("application/x-msdownload").kind).toBe("unsupported");
  });
});
