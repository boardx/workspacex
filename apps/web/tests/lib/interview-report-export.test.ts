// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportInterviewReportPdf, exportInterviewReportWord } from "@/lib/interview-report-export";

const report = {
  reportId: "report-export",
  title: "江西足球：访谈/报告",
  executiveSummary: "基层体系需要长期协同。",
  markdown: "# 江西足球\n\n## 结论\n\n- 培养教练\n- 连接赛事",
  findings: [],
  generatedAt: "2026-09-03T12:00:00.000Z",
};

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete document.body.dataset.printInterviewReport;
});

describe("digital interview report export", () => {
  it("downloads a genuine OOXML Word package with a safe filename", async () => {
    let exported: Blob | undefined;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { exported = blob; return "blob:report"; }) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await exportInterviewReportWord(report);

    expect(click).toHaveBeenCalledOnce();
    expect(exported?.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(Array.from(new Uint8Array(await exported!.arrayBuffer()).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("prints only the report and clears print state after the native PDF dialog", () => {
    document.body.innerHTML = '<main id="report-root">中文报告</main>';
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);

    exportInterviewReportPdf("report-root");
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.dataset.printInterviewReport).toBe("true");
    expect(document.getElementById("report-root")).toHaveClass("print-interview-report-root");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.dataset.printInterviewReport).toBeUndefined();
    expect(document.getElementById("report-root")).not.toHaveClass("print-interview-report-root");
  });
});
