import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { AIDT_STEPS } from "@/lib/project-aidt";
import { emptyAidtUiDrafts, aidtUiReportMarkdown, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ print: vi.fn() }));
vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: mocks.print }));
beforeEach(() => { vi.clearAllMocks(); Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } }); });
function Stage({ id = 1 }: { id?: number }) {
  const [draft, setDraft] = React.useState<AidtUiStageDraft>(emptyAidtUiDrafts()[id]!);
  return <AidtStageOutput projectId="g1" step={AIDT_STEPS[id - 1]!} draft={draft} update={setDraft} readOnly={false} toolHref={(tool) => `/aidt/g1?step=${id}&tool=${tool}`} />;
}
it("keeps stage forms explicitly unsaved and copies only student-entered content", async () => {
  render(<Stage />);
  fireEvent.change(screen.getByLabelText("初始问题"), { target: { value: "午餐排队太久" } });
  fireEvent.click(screen.getByRole("button", { name: "复制本步成果到聊天" }));
  expect(await screen.findByText(/发送成功后才会保存到本组/)).toBeVisible();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("午餐排队太久"));
  fireEvent.click(screen.getByText("填写与保存说明"));
  expect(screen.getByText(/刷新或离开页面后会丢失/)).toBeVisible();
});
it("allows choosing one candidate without inventing a vote or enforcing three", () => {
  render(<Stage id={4} />);
  fireEvent.change(screen.getByLabelText("候选1名称"), { target: { value: "错峰取餐" } });
  fireEvent.click(screen.getByRole("button", { name: "移除候选 3" }));
  fireEvent.click(screen.getByRole("button", { name: "移除候选 2" }));
  expect(screen.getAllByRole("radio")).toHaveLength(1);
  fireEvent.click(screen.getByRole("radio"));
  expect(screen.getByRole("radio")).toBeChecked();
  expect(screen.getByText(/不是投票/)).toBeVisible();
});
it("rejects unsupported local reference previews without claiming an upload", async () => {
  render(<Stage id={4} />);
  const file = new File(["text"], "note.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("候选1参考图"), { target: { files: [file] } });
  expect(await screen.findByText(/本页参考图预览支持/)).toBeVisible();
  expect(screen.queryByAltText("候选1参考图（未上传）")).toBeNull();
});
it("exposes native prototype handoff and real-source research handoff", () => {
  const { unmount } = render(<Stage id={5} />);
  expect(screen.getByRole("button", { name: "打开原生 Design Workbench" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "打开原生 Design Workbench" })).toBeNull();
  unmount(); render(<Stage id={2} />);
  expect(screen.getByRole("link", { name: "查看与关联真实研究资料" })).toHaveAttribute("href", "/aidt/g1?step=2&tool=sources");
});
it("preserves report edits when the stage forms change and regenerates only on explicit action", () => {
  const drafts = emptyAidtUiDrafts(); const change = vi.fn(); const regenerate = vi.fn();
  render(<AidtReportPreview drafts={drafts} text="# 我们的审阅稿" sourceRevision={1} revision={2} onChange={change} regenerate={regenerate} readOnly={false} />);
  expect(screen.getByLabelText("小组报告草稿")).toHaveValue("# 我们的审阅稿");
  expect(screen.getByText(/不会自动覆盖你的修改/)).toBeVisible();
  expect(regenerate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "从成果重新整理" }));
  expect(regenerate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认替换" }));
  expect(regenerate).toHaveBeenCalledOnce();
});
it("sends escaped text to native PDF preview and labels copying as unsaved", async () => {
  const text = "# 报告\n<script>alert(1)</script>";
  render(<AidtReportPreview drafts={emptyAidtUiDrafts()} text={text} sourceRevision={0} revision={0} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "PDF 打印预览" }));
  const article = mocks.print.mock.calls[0]![0] as HTMLElement;
  expect(article.querySelector("script")).toBeNull();
  expect(article.textContent).toContain("<script>alert(1)</script>");
  fireEvent.click(screen.getByText("把报告用于本组对话"));
  fireEvent.click(screen.getByRole("button", { name: "复制报告到聊天" }));
  expect(await screen.findByText(/发送成功后才会保存/)).toBeVisible();
});
it("report assembly keeps missing evidence and teacher comments as gaps", () => {
  const drafts = emptyAidtUiDrafts(); drafts[1]!.fields.initial = "真实问题";
  const text = aidtUiReportMarkdown(drafts);
  expect(text).toContain("真实问题"); expect(text).toContain("待补充");
  expect(text).toContain("未保存草稿"); expect(text).toContain("待教师提供");
  expect(text).not.toContain("已完成六步");
});
it("keeps the student's report and offers retry paths when browser export cannot start", async () => {
  mocks.print.mockImplementationOnce(() => { throw new Error("Print unavailable"); });
  render(<AidtReportPreview drafts={emptyAidtUiDrafts()} text="保留人工修改与证据A引用" sourceRevision={0} revision={0} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} />);
  fireEvent.click(screen.getByRole("button", { name: "PDF 打印预览" }));
  expect(screen.getByRole("status")).toHaveTextContent("打印预览未能打开，报告编辑仍保留");
  expect(screen.getByLabelText("小组报告草稿")).toHaveValue("保留人工修改与证据A引用");
  const descriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => { throw new Error("Blob unavailable"); }) });
  try {
    fireEvent.click(screen.getByRole("button", { name: "下载 Markdown 草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("下载未能启动，报告编辑仍保留");
    expect(screen.getByLabelText("小组报告草稿")).toHaveValue("保留人工修改与证据A引用");
  } finally { if (descriptor) Object.defineProperty(URL, "createObjectURL", descriptor); else Reflect.deleteProperty(URL, "createObjectURL"); }
});
