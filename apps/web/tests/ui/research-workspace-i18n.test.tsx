import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ResearchTopicInformation } from "@/components/research-studio/research-topic-information";
import { GuidedResearchPlanEditor } from "@/components/research-studio/guided-research-plan-editor";
import { GuidedResearchLive } from "@/components/research-studio/guided-research-live";
import { ReportFileActions } from "@/components/report-files/report-file-actions";
import type { ReportFileJobState } from "@/lib/report-files-api";
import { researchReportDocument, researchReportMarkdown } from "@/lib/research-report-document";
import { ApiError } from "@/lib/api-client";
import { GuidedResearchSourceWorkspace } from "@/components/research-studio/guided-research-source-workspace";
import { runtimeFixture } from "../guided-runtime-fixture";

const api = vi.hoisted(() => ({ read: vi.fn(), execute: vi.fn(), file: vi.fn(), source: vi.fn() }));
vi.mock("@/lib/guided-research-api", async (original) => ({ ...await original<typeof import("@/lib/guided-research-api")>(), getResearchRuntime: api.read, executeResearchRuntime: api.execute }));
vi.mock("@/lib/report-files-api", async (original) => ({ ...await original<typeof import("@/lib/report-files-api")>(), generateReportFile: api.file, getReportFileSource: api.source }));
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>English test switch</button><button onClick={() => setLocale("zh-CN")}>中文测试切换</button></>; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function change(locale: "en" | "zh-CN") { fireEvent.click(screen.getByText(locale === "en" ? "English test switch" : "中文测试切换")); }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); api.source.mockRejectedValue(Error("offline")); });

it("displays fixed focus options in English but saves canonical values and raw custom focus once", async () => {
  let finish!: (saved: boolean) => void;
  const brief = { topic: "原主题", goal: "原始研究需求", focus: "自定义关注内容", region: "中国", timeRange: "2026" };
  const save = vi.fn((_value: typeof brief) => new Promise<boolean>(resolve => { finish = resolve; }));
  show(<ResearchTopicInformation brief={brief} disabled={false} onSave={save} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "User needs" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0]).toEqual({ ...brief, focus: "用户需求、自定义关注内容" });
  change("zh-CN"); expect(screen.getByRole("checkbox", { name: "用户需求" })).toBeChecked();
  change("en"); expect(screen.getByRole("status")).toHaveTextContent("Saving");
  expect(screen.getByLabelText("Research topic")).toHaveValue(brief.topic);
  expect(save).toHaveBeenCalledTimes(1); await act(async () => finish(true));
});

it("keeps plan draft and confirmation open across locales, and never translates saved plan text", async () => {
  const outline = runtimeFixture("outline").outline;
  const save = vi.fn().mockResolvedValue(true);
  show(<GuidedResearchPlanEditor value={outline} disabled={false} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: /^Edit plan 1/ }));
  const input = screen.getByRole("textbox", { name: "Plan 1" });
  fireEvent.change(input, { target: { value: "原始计划内容 {count}" } });
  change("zh-CN"); change("en"); expect(input).toHaveValue("原始计划内容 {count}");
  fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
  expect(screen.getByRole("heading", { name: "Save research plan?" })).toBeVisible();
  change("zh-CN"); change("en"); expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm save" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0]![0][0].title).toBe("原始计划内容 {count}");
});

it("translates saved report chrome and history without rewriting the report or replaying execution", async () => {
  const base = runtimeFixture("report", "research-workspace-language");
  const state = { ...base, completed: true, reportPrevious: { title: "上一版中文原报告", createdAt: "2026-01-01T00:00:00Z", text: "", chapters: [], aliases: [], sources: base.sources, outline: base.outline, report: { ...base.report!, title: "上一版中文原报告" } } };
  const canonicalBytes = JSON.stringify(state);
  const exported = () => researchReportMarkdown(researchReportDocument(state.report!, state.sources, state.outline, { brief: state.brief }));
  const originalExport = exported();
  api.read.mockResolvedValue(state);
  show(<GuidedResearchLive sessionId={state.sessionId} onBack={vi.fn()} />);
  const report = await screen.findByTestId("research-report-document");
  expect(report).toHaveTextContent(base.report!.title);
  expect(report).toHaveTextContent("执行摘要");
  expect(screen.getByTestId("guided-research-report-contents")).toHaveTextContent("Report contents");
  expect(screen.getByTestId("research-report-history")).toHaveTextContent("上一版中文原报告");
  const reads = api.read.mock.calls.length;
  change("zh-CN"); expect(report).toHaveTextContent("执行摘要");
  expect(screen.getByTestId("guided-research-report-contents")).toHaveTextContent("报告目录");
  change("en"); expect(report).toHaveTextContent("执行摘要");
  expect(screen.getByTestId("guided-research-report-contents")).toHaveTextContent("Report contents");
  expect(report).toHaveTextContent(base.report!.title);
  expect(api.read).toHaveBeenCalledTimes(reads); expect(api.execute).not.toHaveBeenCalled();
  expect(JSON.stringify(state)).toBe(canonicalBytes); expect(exported()).toBe(originalExport);
});

it("retains the exact report-file request while pending and retranslates its error after completion", async () => {
  const source = { kind: "research" as const, id: "research-file-language", reportVersion: 1, reportHash: "a".repeat(64) };
  let finish!: (job: ReportFileJobState) => void;
  api.file.mockImplementation(() => new Promise<ReportFileJobState>(resolve => { finish = resolve; }));
  show(<ReportFileActions source={source} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate PDF" }));
  expect(api.file).toHaveBeenCalledTimes(1);
  const submitted = api.file.mock.calls[0]!;
  expect(submitted[0]).toEqual(source); expect(submitted[1]).toBe("pdf");
  change("zh-CN"); change("en"); expect(screen.getByRole("button", { name: "Generating PDF…" })).toBeDisabled();
  expect(api.file).toHaveBeenCalledTimes(1); expect(api.file.mock.calls[0]).toBe(submitted);
  await act(async () => finish({ id: "file-job", source, format: "pdf", createdAt: "2026-11-04T00:00:00Z", status: "failed", errorCode: "INVALID_FILE" }));
  expect(screen.getByRole("alert")).toHaveTextContent("File generation failed");
  change("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("文件生成失败");
  expect(api.file).toHaveBeenCalledTimes(1);
});

it("retranslates a saved-session authorization failure without retrying until explicit input", async () => {
  api.read.mockRejectedValue(new ApiError(403, "FORBIDDEN", { privateDetail: "sensitive" }));
  show(<GuidedResearchLive sessionId="research-locale-denied" onBack={vi.fn()} />);
  expect(await screen.findByRole("status")).toHaveTextContent("You do not have access to this research");
  const reads = api.read.mock.calls.length;
  change("zh-CN"); expect(screen.getByRole("status")).toHaveTextContent("你暂时没有访问此研究的权限");
  change("en"); expect(api.read).toHaveBeenCalledTimes(reads);
  expect(screen.queryByText("sensitive")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  await waitFor(() => expect(api.read).toHaveBeenCalledTimes(reads + 1));
  expect(api.execute).not.toHaveBeenCalled();
});

it("translates source workspace chrome while retaining source titles, summaries and links", () => {
  const base = runtimeFixture("research");
  const source = { ...base.sources[0]!, id: "raw-source", title: "中文原始来源", presentation: undefined, document: undefined, url: "https://example.com/original-source", content: "中文来源原文" };
  show(<GuidedResearchSourceWorkspace state={{ ...base, sources: [source] }} actions={null} />);
  expect(screen.getByRole("heading", { name: "Research material" })).toBeVisible();
  expect(screen.getByTestId("research-source-description-raw-source")).toHaveAttribute("href", source.url);
  expect(screen.getByTestId("research-source-description-raw-source")).toHaveTextContent(source.title);
  change("zh-CN"); expect(screen.getByRole("heading", { name: "研究资料" })).toBeVisible();
  change("en"); expect(screen.getByTestId("research-source-description-raw-source")).toHaveAttribute("href", source.url);
  expect(screen.getByTestId("research-source-description-raw-source")).toHaveTextContent(source.title);
  expect(api.execute).not.toHaveBeenCalled();
});
