import { afterEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { exportGuidedResearchReport, guidedResearchExportDocument } from "@/lib/guided-research-report-export";
import { printResearchPdf } from "@/lib/research-report-export";

vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: vi.fn() }));
const input = {
  title: "中文研究报告",
  sections: [{ title: "风险与局限" }],
  summary: '<script>alert("untrusted")</script> 字面文本 &lt;',
  citations: [{ label: "保留的演示来源", url: "https://example.com/synthetic" }],
};
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.replaceChildren(); });

describe("guided report actual export routing", () => {
  it("preserves current text and sources without interpreting input as markup", () => {
    const root = guidedResearchExportDocument(input);
    expect(root.querySelector("script")).toBeNull();
    expect(root.textContent).toContain(input.summary);
    expect(root.textContent).toContain(input.citations[0]!.url);
    expect(root.textContent).toContain("不代表真实检索或研究结论");
    expect(root.textContent).not.toContain("此章节基于确认后的报告大纲保留为演示内容");
  });

  it("uses native PDF printing rather than downloading a fake PDF blob", async () => {
    const create = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create });
    await exportGuidedResearchReport(input, "pdf");
    expect(create).not.toHaveBeenCalled();
    expect(printResearchPdf).toHaveBeenCalledOnce();
    const [root, title] = vi.mocked(printResearchPdf).mock.calls[0]!;
    expect(root.textContent).toContain(input.title);
    expect(title).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("downloads a genuine DOCX with its extension and delayed URL cleanup", async () => {
    const create = vi.fn((_blob: Blob) => "blob:report");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    await exportGuidedResearchReport(input, "word");
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![0].type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(filename).toMatch(/^[A-Za-z0-9_-]+\.docx$/);
    expect(revoke).not.toHaveBeenCalled();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:report"), { timeout: 2000 });
  });
});
