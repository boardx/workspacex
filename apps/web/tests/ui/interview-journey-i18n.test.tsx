import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { InterviewWorkbenchHeader, INTERVIEW_WORKBENCH_STEPS } from "@/components/itv/interview-workbench-header";
import { InterviewIntakeStep } from "@/components/itv/interview-intake-step";
import { InterviewAnalysisStep } from "@/components/itv/interview-analysis-step";
import { InterviewReportStep } from "@/components/itv/interview-report-step";
import { InterviewStudioHome } from "@/components/itv/interview-studio-home";
import type { InterviewMarkdownDocument } from "@/lib/interview-markdown-api";
const api = vi.hoisted(() => ({ history: vi.fn(), experts: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/interview-api", async original => ({ ...await original<typeof import("@/lib/interview-api")>(), loadDigitalInterviewHistory: api.history, loadDigitalExperts: api.experts }));
vi.mock("@/lib/interview-expert-library-api", () => ({ loadCustomInterviewExperts: async () => ({ items: [] }) }));
const raw = "# 私有研究 {count}\n\n## 原文结论\n内容与符号 **保留**。";
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function swap(locale: "en" | "zh-CN") { fireEvent.click(screen.getByText(locale === "en" ? "EN test" : "ZH test")); }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); api.history.mockResolvedValue({ items: [] }); api.experts.mockResolvedValue({ items: [] }); });
it("localizes the real six-step header while keeping raw identity and navigation IDs", () => {
  const move = vi.fn();
  show(<InterviewWorkbenchHeader name="原始访谈 {count}" tags={["客户原标签"]} steps={INTERVIEW_WORKBENCH_STEPS} activeStep="outline" completedSteps={["intake"]} status="draft" version={3} topic={null} onStepChange={move} onReturnToList={vi.fn()} />);
  expect(screen.getByRole("navigation", { name: "Interview steps" })).toBeVisible();
  expect(screen.getByTestId("itv-workbench-step-intake")).toHaveTextContent("Import requirements");
  expect(screen.getByRole("button", { name: "Back to interviews" })).toBeVisible();
  swap("zh-CN"); swap("en"); fireEvent.click(screen.getByTestId("itv-workbench-step-outline"));
  expect(move).toHaveBeenCalledTimes(1); expect(move).toHaveBeenCalledWith("outline"); expect(screen.getByRole("heading", { name: "原始访谈 {count}" })).toBeVisible();
});
it("keeps the editable intake and pending confirm identity across language changes", async () => {
  let finish!: () => void;
  const confirm = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const change = vi.fn();
  show(<InterviewIntakeStep markdown={raw} onChange={change} onConfirm={confirm} pending={false} />);
  const input = screen.getByRole("textbox", { name: "Research requirements Markdown" }); expect(input).toHaveValue(raw);
  fireEvent.click(screen.getByRole("button", { name: "Next: confirm analysis" }));
  swap("zh-CN"); swap("en"); expect(screen.getByRole("textbox", { name: "Research requirements Markdown" })).toBe(input);
  expect(input).toHaveValue(raw); expect(confirm).toHaveBeenCalledTimes(1); expect(change).not.toHaveBeenCalled();
  await act(async () => finish());
});
it("retranslates an import error without another operation or draft loss", async () => {
  const upload = vi.fn(async () => { throw Error("PRIVATE_TRANSPORT_DETAIL"); });
  show(<InterviewIntakeStep markdown={raw} onChange={vi.fn()} onConfirm={async () => {}} pending={false} onUploadFile={upload} />);
  fireEvent.change(screen.getByLabelText("Import research file"), { target: { files: [new File(["data"], "原文件.txt")] } });
  expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is preserved");
  swap("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("已有草稿保留"); swap("en");
  expect(screen.getByRole("alert")).toHaveTextContent("Your draft is preserved"); expect(upload).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Research requirements Markdown" })).toHaveValue(raw);
});
it("localizes analysis empty and pending actions without invoking generation", () => {
  const generate = vi.fn(); show(<InterviewAnalysisStep document={null} pending onGenerate={generate} onConfirm={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "AI analysis" })).toBeVisible(); expect(screen.getByTestId("loading")).toHaveTextContent("Loading analysis…");
  swap("zh-CN"); swap("en"); expect(generate).not.toHaveBeenCalled();
});
it("localizes report controls while preserving canonical headings and body bytes", () => {
  const document = { documentId: "report-raw", step: "report", version: 4, contentHash: "a".repeat(64), markdown: raw, evidenceMode: "simulated", references: [] } as InterviewMarkdownDocument;
  show(<InterviewReportStep document={document} />);
  expect(screen.getByRole("navigation", { name: "Report contents" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Expand contents" })).toBeVisible();
  swap("zh-CN"); swap("en"); expect(screen.getByTestId("itv-source-report-markdown")).toHaveTextContent("原文结论");
  expect(document.markdown).toBe(raw); expect(document.contentHash).toBe("a".repeat(64));
});
it("localizes the actual history home and retains a failed read until explicit retry", async () => {
  api.history.mockRejectedValueOnce(Error("PRIVATE_HISTORY_DETAIL")); show(<InterviewStudioHome />);
  expect(await screen.findByRole("heading", { name: "Interviews" })).toBeVisible();
  expect(await screen.findByText(/Interview history could not be loaded/)).toBeVisible(); swap("zh-CN"); swap("en");
  expect(api.history).toHaveBeenCalledTimes(1); expect(screen.getByRole("button", { name: "New interview" })).toBeVisible();
});
it("localizes controlled text-import validation errors while preserving the requirement", async () => {
  const importFile=vi.fn(async()=>{throw Error("仅支持 UTF-8 TXT / Markdown 文件");});
  show(<InterviewIntakeStep markdown={raw} onChange={vi.fn()} onConfirm={async()=>{}} pending={false} onImportFile={importFile}/>);
  fireEvent.change(screen.getByLabelText("Import research file"),{target:{files:[new File(["data"],"unsupported.pdf")]}});
  expect(await screen.findByRole("alert")).toHaveTextContent("Only UTF-8 TXT / Markdown files are supported");swap("zh-CN");swap("en");
  expect(screen.getByRole("textbox",{name:"Research requirements Markdown"})).toHaveValue(raw);expect(importFile).toHaveBeenCalledTimes(1);
});

it.each(["constructor", "toString", "__proto__"])("preserves an unknown imported error named %s without treating it as a translation", async detail => {
  const importFile=vi.fn(async()=>{throw Error(detail);});
  show(<InterviewIntakeStep markdown={raw} onChange={vi.fn()} onConfirm={async()=>{}} pending={false} onImportFile={importFile}/>);
  fireEvent.change(screen.getByLabelText("Import research file"),{target:{files:[new File(["data"],"source.md")]}});
  expect(await screen.findByRole("alert")).toHaveTextContent(detail);
  swap("zh-CN");swap("en");expect(screen.getByRole("alert")).toHaveTextContent(detail);
  expect(screen.getByRole("textbox",{name:"Research requirements Markdown"})).toHaveValue(raw);expect(importFile).toHaveBeenCalledTimes(1);
});
