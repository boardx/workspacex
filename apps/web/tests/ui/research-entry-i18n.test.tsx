import * as React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { GuidedResearchFlow } from "@/components/research-studio/guided-research-flow";
import { ResearchIntake } from "@/components/research-studio/research-intake";
import { GuidedResearchSixStepShell } from "@/components/research-studio/guided-research-six-step-shell";
import { StudioMetadataDialog } from "@/components/studio/studio-history-management";
import { TagField } from "@/components/ui/tag-input";
import type { GuidedResearchSession } from "@/lib/guided-research-api";
import { research } from "@repo/contracts";
import { runtimeFixture } from "../guided-runtime-fixture";
import { InterviewVoiceInput } from "@/components/itv/interview-voice-input";
import type { AsrDraftStreamHandlers } from "@/lib/live-asr-draft";

const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), runtime: vi.fn(), skill: vi.fn(), voice: vi.fn() }));
vi.mock("@/lib/live-asr-draft", async (original) => ({ ...await original<typeof import("@/lib/live-asr-draft")>(), openAsrDraftStream: api.voice }));
let voiceHandlers: AsrDraftStreamHandlers;
vi.mock("@/lib/guided-research-api", async (original) => ({
  ...await original<typeof import("@/lib/guided-research-api")>(),
  listGuidedResearchSessions: api.list, createGuidedResearchSession: api.create,
  getResearchRuntime: api.runtime, runGuidedResearchSkillTurn: api.skill,
}));

function Language() {
  const { setLocale } = useI18n();
  return <><button onClick={() => setLocale("en")}>English test switch</button><button onClick={() => setLocale("zh-CN")}>中文测试切换</button></>;
}
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function changeLanguage(locale: "en" | "zh-CN") { fireEvent.click(screen.getByText(locale === "en" ? "English test switch" : "中文测试切换")); }
const rawTitle = "欧洲储能原始名称 {count}";
const rawTag = "客户原始标签";
function session(overrides: Partial<GuidedResearchSession> = {}): GuidedResearchSession {
  return {
    sessionId: "research-language", title: rawTitle, tags: [rawTag],
    brief: { topic: "研究原始主题", goal: "研究原始目标与材料", timeRange: "2026", region: "欧洲", focus: "用户原始关注点" },
    briefVersion: 1, briefConfirmedAt: null, directions: { candidateVersion: null, confirmedVersion: null, versions: [] },
    outline: { candidateVersion: null, confirmedVersion: null, versions: [] }, stage: "outline", resumeStage: "outline", status: "active", progress: 40,
    sourceCount: 1, reportId: null, createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T01:00:00Z", ...overrides,
  } as GuidedResearchSession;
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  api.list.mockResolvedValue({ items: [] }); api.runtime.mockResolvedValue({ ...runtimeFixture("brief", "created"), version: 0 });
  vi.stubGlobal("WebSocket", class {}); vi.stubGlobal("AudioContext", class {});
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
  api.voice.mockImplementation(async (handlers: AsrDraftStreamHandlers) => { voiceHandlers = handlers; return { stop: async () => undefined }; });
});
afterEach(() => vi.unstubAllGlobals());

describe("research entry locale is presentation-only", () => {
  it("translates list status/actions while preserving raw data, filtering, sorting and request count", async () => {
    api.list.mockResolvedValue({ items: [session()] });
    show(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Research" })).toBeVisible();
    const card = await screen.findByTestId("research-history-research-language");
    expect(card).toHaveTextContent(rawTitle); expect(card).toHaveTextContent(rawTag);
    expect(card).toHaveTextContent("Research plan"); expect(card).toHaveTextContent("1 source");
    expect(within(card).getByRole("button", { name: "View research plan" })).toBeVisible();
    fireEvent.change(screen.getByTestId("research-history-search"), { target: { value: rawTitle } });
    fireEvent.click(screen.getByTestId(`research-history-tag-${rawTag}`));
    fireEvent.click(screen.getByTestId("research-history-sort"));
    changeLanguage("zh-CN");
    expect(screen.getByRole("heading", { name: "研究列表" })).toBeVisible();
    expect(screen.getByTestId("research-history-search")).toHaveValue(rawTitle);
    expect(screen.getByTestId(`research-history-tag-${rawTag}`)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("research-history-sort")).toHaveTextContent("最早更新");
    changeLanguage("en");
    expect(screen.getByTestId("research-history-sort")).toHaveTextContent("Oldest updated");
    expect(card).toHaveTextContent(rawTitle); expect(api.list).toHaveBeenCalledTimes(1);
  });

  it("retranslates a failed load without replaying the read until explicit retry", async () => {
    api.list.mockRejectedValueOnce(Error("private transport detail"));
    show(<GuidedResearchFlow step="home" onStepChange={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Research history could not be loaded.");
    changeLanguage("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("历史研究加载失败");
    expect(api.list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByTestId("research-history-empty"); expect(api.list).toHaveBeenCalledTimes(2);
    changeLanguage("en"); expect(screen.getByTestId("research-history-empty")).toHaveTextContent("No research yet.");
    expect(screen.queryByText("private transport detail")).not.toBeInTheDocument();
  });

  it("preserves an open metadata draft and uncommitted tag across locale changes and pending save", async () => {
    let finish!: () => void;
    const onSave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const initialTags = [rawTag];
    show(<StudioMetadataDialog business="research" prefix="research" open initialName={rawTitle} initialTags={initialTags} tagLimits={{ maxTags: 5, maxTagLength: 20 }} onOpenChange={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("heading", { name: "Edit research" })).toBeVisible();
    fireEvent.change(screen.getByTestId("research-edit-name"), { target: { value: "编辑的中文原名" } });
    fireEvent.change(screen.getByTestId("research-edit-tag-input"), { target: { value: "最后未提交标签" } });
    changeLanguage("zh-CN"); changeLanguage("en");
    expect(screen.getByTestId("research-edit-name")).toHaveValue("编辑的中文原名");
    expect(screen.getByTestId("research-edit-tag-input")).toHaveValue("最后未提交标签");
    fireEvent.click(screen.getByTestId("research-edit-submit"));
    expect(onSave).toHaveBeenCalledWith({ name: "编辑的中文原名", tags: [rawTag, "最后未提交标签"] });
    changeLanguage("zh-CN"); changeLanguage("en");
    expect(screen.getByTestId("research-edit-submit")).toHaveTextContent("Saving…");
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("updates tag notices on locale changes and keeps IME input as user data", () => {
    const onChange = vi.fn();
    show(<TagField value={[rawTag]} onChange={onChange} draft={rawTag} onDraftChange={vi.fn()} testIdPrefix="raw-tags" maxTags={5} maxTagLength={20} />);
    const input = screen.getByRole("textbox", { name: "Add tag" });
    fireEvent.compositionStart(input); changeLanguage("zh-CN"); changeLanguage("en");
    expect(screen.getByRole("textbox", { name: "Add tag" })).toBe(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("raw-tags-hint")).toHaveTextContent("This tag already exists");
    changeLanguage("zh-CN"); expect(screen.getByTestId("raw-tags-hint")).toHaveTextContent("已经有");
    expect(input).toHaveValue(rawTag); expect(onChange).not.toHaveBeenCalled();
  });

  it("retains the pending create identity, original fields and navigation while labels switch", async () => {
    let finish!: (result: GuidedResearchSession) => void;
    api.create.mockImplementation(() => new Promise<GuidedResearchSession>(resolve => { finish = resolve; }));
    const navigate = vi.fn(); const brief = { topic: "", goal: "私有研究原文 {count}", timeRange: "2026", region: "中国", focus: "原始输入" };
    show(<ResearchIntake initialBrief={brief} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onNavigate={navigate} onPending={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Tell AI what you want to research" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Research goal" })).toHaveValue(brief.goal);
    fireEvent.click(screen.getByTestId("research-confirm-brief"));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    const submitted = api.create.mock.calls[0]![0];
    expect(submitted.brief).toEqual({ ...brief, topic: research.DEFAULT_RESEARCH_NAME });
    expect(submitted.title).toBe(research.DEFAULT_RESEARCH_NAME);
    changeLanguage("zh-CN"); changeLanguage("en");
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.create.mock.calls[0]![0]).toBe(submitted);
    await act(async () => finish(session({ sessionId: "created" })));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("outline", "created"));
  });

  it("retranslates import validation and retains the original requirement", async () => {
    const goal = "原需求不会因失败导入被删除";
    show(<ResearchIntake initialBrief={{ topic: "", goal, timeRange: "", region: "", focus: "" }} session={null} workflow={null} onSession={vi.fn()} onWorkflow={vi.fn()} onNavigate={vi.fn()} onPending={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Upload requirement file"), { target: { files: [new File(["private data"], "not-supported.pdf")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose a TXT, Markdown or CSV text file.");
    changeLanguage("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("请选择 TXT");
    expect(screen.getByTestId("research-brief-goal")).toHaveValue(goal); expect(api.create).not.toHaveBeenCalled();
  });

  it("translates navigation and unsaved-change recovery without changing route ids or private title", () => {
    const back = vi.fn();
    show(<GuidedResearchSixStepShell current="import" available={["import", "plan"]} researchName={rawTitle} hasUnsavedChanges onBack={back} onNavigate={vi.fn()} main={<span>用户原始文档</span>} />);
    expect(screen.getByRole("heading", { name: rawTitle })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Research steps" })).toHaveTextContent("Research plan");
    fireEvent.click(screen.getByTestId("research-flow-back"));
    expect(screen.getByRole("heading", { name: "Unsaved research changes" })).toBeVisible();
    changeLanguage("zh-CN"); expect(screen.getByRole("heading", { name: "研究内容尚未保存" })).toBeVisible();
    expect(back).not.toHaveBeenCalled(); changeLanguage("en");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(back).not.toHaveBeenCalled(); expect(screen.getByRole("heading", { name: rawTitle })).toBeVisible();
  });

  it("changes voice controls without restarting capture or translating confirmed transcript", async () => {
    const append = vi.fn();
    show(<InterviewVoiceInput sessionToken="fixture-session" onAppend={append} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
    const stopControl = await screen.findByRole("button", { name: "Stop and append text" });
    act(() => voiceHandlers.onFinal("中文逐字稿原文 {count}"));
    changeLanguage("zh-CN"); expect(screen.getByRole("button", { name: "停止并追加文字" })).toBeVisible();
    changeLanguage("en"); expect(api.voice).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Stop and append text" })).toBe(stopControl);
    fireEvent.click(screen.getByRole("button", { name: "Stop and append text" }));
    act(() => voiceHandlers.onFinished());
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append).toHaveBeenCalledWith("中文逐字稿原文 {count}");
  });

  it("retranslates provider errors and recoverable transcript actions without reconnecting", async () => {
    const append = vi.fn();
    show(<InterviewVoiceInput sessionToken="fixture-session" onAppend={append} />);
    fireEvent.click(screen.getByRole("button", { name: "Voice input" }));
    await screen.findByRole("button", { name: "Stop and append text" });
    act(() => { voiceHandlers.onFinal("保留的原始转录"); voiceHandlers.onError("ASR_NOT_CONFIGURED"); });
    expect(screen.getByRole("alert")).toHaveTextContent("Voice transcription is not configured");
    changeLanguage("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("尚未配置语音转写服务");
    changeLanguage("en"); expect(api.voice).toHaveBeenCalledTimes(1); expect(append).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep confirmed transcript" }));
    expect(append).toHaveBeenCalledWith("保留的原始转录");
  });
});

it("translates completed step accessibility text while keeping the step controls mounted", () => {
  show(<GuidedResearchSixStepShell current="report" completed available={["import", "plan", "report"]} researchName={rawTitle} onNavigate={vi.fn()} main={<span>原始报告</span>} />);
  const progress = screen.getByTestId("research-flow-progress");
  expect(progress).not.toHaveTextContent("已完成");
  const plan = within(progress).getByRole("button", { name: /Completed.*Research plan/ });
  changeLanguage("zh-CN"); expect(progress).toHaveTextContent("已完成");
  changeLanguage("en"); expect(within(progress).getByRole("button", { name: /Completed.*Research plan/ })).toBe(plan);
  expect(screen.getByRole("heading", { name: rawTitle })).toBeVisible();
});
