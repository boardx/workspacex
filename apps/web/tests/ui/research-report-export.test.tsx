import * as React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildResearchWord } from "@/lib/research-report-export";
import { GuidedResearchReportDocument } from "@/components/research-studio/guided-research-report-document";
import { GuidedResearchReportTimeline } from "@/components/research-studio/guided-research-report-timeline";
import { runtimeFixture } from "../guided-runtime-fixture";
const doc = { title: "欧洲储能报告", introduction: "范围与方法正文。", conclusion: "综合结论正文。", summary: "结论[1](#research-reference-1)", sections: [{ sectionId: "a", title: "政策", body: "## 政策\n\n**分析**：证据与限制。\n\n| 国家 | 判断 |\n| --- | --- |\n| 德国 | 待核验 |\n\n- 主项\n  - 子项一\n  - 子项二\n\n  子项之后\n\n```text\n证据代码\n```" }], references: [{ number: 1, title: "官方来源", url: "https://example.com/evidence" }] };
it("exports real OOXML with Chinese text, tables, superscript citations and source links", async () => {
  render(<GuidedResearchReportDocument document={doc} provisional validationNotice={<aside><p>政策：需要补充适用范围证据</p></aside>} />);
  const reader = screen.getByTestId("research-report-preview-text");
  expect(screen.getAllByRole("heading", { name: /政策/ })).toHaveLength(1);
  const blob = await buildResearchWord(reader);
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => { const file = new FileReader(); file.onload = () => resolve(file.result as ArrayBuffer); file.onerror = reject; file.readAsArrayBuffer(blob); });
  const folder = mkdtempSync(join(tmpdir(), "research-word-"));
  try {
    const path = join(folder, "report.docx"); writeFileSync(path, Buffer.from(bytes));
    const xml = execFileSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8" });
    expect(xml.indexOf("子项一")).toBeLessThan(xml.indexOf("子项之后")); expect(xml).not.toContain("政策：需要补充适用范围证据"); expect(xml).toContain("证据代码"); expect(xml).toContain("子项一"); expect(xml).toContain('w:ilvl w:val="1"'); expect(xml).not.toContain("主项子项一子项二"); expect(xml).toContain("欧洲储能报告"); expect(xml).not.toContain("草稿"); expect(xml).toContain("目录"); expect(xml).toContain("范围与方法正文。"); expect(xml).toContain("综合结论正文。"); expect(xml).toContain("证据与限制。"); expect(xml).not.toContain("内容仍在生成"); expect(xml).not.toContain("待最终校验"); expect(xml).toContain("<w:tbl>"); expect(xml).toContain('w:val="superscript"');
    expect(execFileSync("unzip", ["-p", path, "word/_rels/document.xml.rels"], { encoding: "utf8" })).toContain("https://example.com/evidence");
  } finally { rmSync(folder, { recursive: true }); }
});
it("prints only the report document and cleans up the isolated frame", () => {
  render(<GuidedResearchReportDocument document={doc} provisional limitations="检索失败运行说明" validationNotice={<p>QUALITY_GATE_FAILED</p>} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "更多操作" }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole("menuitem", { name: "导出 PDF" }));
  const frame = document.querySelector("iframe")!;
  expect(frame.contentDocument!.title).toBe("欧洲储能报告");
  expect(frame.contentDocument!.body.textContent).toContain("欧洲储能报告");
  const body = frame.contentDocument!.body;
  for (const text of ["范围与方法正文。", "综合结论正文。", "证据与限制。", "官方来源", "目录"]) expect(body.textContent).toContain(text);
  for (const text of ["QUALITY_GATE_FAILED", "检索失败运行说明", "草稿", "待最终校验", "内容仍在生成"]) expect(body.textContent).not.toContain(text);
  const contents = body.querySelector("nav")!;
  expect(frame.contentWindow!.getComputedStyle(contents).display).not.toBe("none");
  expect(frame.contentDocument!.querySelector("button")).toBeNull();
  frame.contentWindow!.dispatchEvent(new Event("afterprint"));
  expect(document.querySelector("iframe")).toBeNull();
});
describe("report process disclosure", () => {
  it("collapses a saved report but expands a new active run", () => {
    const state = { ...runtimeFixture("report"), busy: false, reportTimeline: [{ id: "v", stage: "validation" as const, status: "completed" as const, attempts: 1 }] };
    const { rerender } = render(<GuidedResearchReportTimeline state={state} />);
    expect(screen.getByTestId("research-report-timeline")).not.toHaveAttribute("open");
    rerender(<GuidedResearchReportTimeline state={{ ...state, busy: true }} />);
    expect(screen.getByTestId("research-report-timeline")).toHaveAttribute("open");
  });
});
