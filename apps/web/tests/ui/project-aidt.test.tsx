import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { listAidtProblems } from "@/features/aidt/lib/aidt-problem-entities";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { aidtHref } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ search: "", chatMount: "fallback", list: vi.fn(), chat: vi.fn(), rec: vi.fn(), design: vi.fn(), resources: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: React.ComponentType<any> }>) => {
  const Lazy = React.lazy(async () => ({ default: await load() as unknown as React.ComponentType<any> }));
  return function Dynamic(props: any) { return <React.Suspense fallback={<p>加载中</p>}><Lazy {...props} /></React.Suspense>; };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/project-aidt-chat", () => ({ ProjectAidtChat: (props: any) => { mocks.chat(props); return <div key={mocks.chatMount} data-testid="native-chat">{props.hostPanel?.open && props.hostPanel.content}</div>; } }));
vi.mock("@/components/rec/transcription-history", () => ({ TranscriptionHistory: (props: any) => { mocks.rec(props); return <div data-testid="native-rec" />; } }));
vi.mock("@/components/design-loop/detail-screen", () => ({ DesignDetailScreen: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/features/aidt/components/aidt-design-workspace", () => ({ AidtDesignWorkspace: (props: any) => { mocks.design(props); return <div data-testid="native-design" />; } }));
vi.mock("@/components/project/project-conversations", () => ({ ProjectConversations: () => <div data-testid="readonly-conversations" /> }));
vi.mock("@/components/project/project-evidence-section", () => ({ ProjectEvidenceSection: () => <div data-testid="native-evidence" /> }));
vi.mock("@/components/project/project-resource-section", () => ({
  ProjectResourceSection: (props: any) => { mocks.resources(props); return <div data-testid="native-resources" />; },
  describeProjectResourceFailure: () => "资源加载失败",
  projectResourceHref: (_kind: string, id: string, project: string) => `/studio/board/${id}?projectId=${project}`,
}));
beforeEach(() => { vi.clearAllMocks(); mocks.search = ""; mocks.chatMount = "fallback"; mocks.list.mockResolvedValue({ items: [] }); });
describe("native AIDT project workspace", () => {
  it("shows six steps with project-safe URLs and no fictional progress", () => {
    render(<AidtDashboard href={(id) => aidtHref("p/1", id)} />);
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByTestId("aidt-step-2")).toHaveAttribute("href", "/aidt/p%2F1?step=2");
    expect(screen.queryByText(/100%|已完成/)).toBeNull();
  });
  it("opens the problem directory by default, with an explicit entry to the legacy workspace", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true");
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    const read = vi.spyOn(stages, "readAidtStage").mockResolvedValue({ stage: null });
    try {
      render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
      expect(await screen.findByTestId("aidt-problem-directory")).toBeVisible();
      expect(screen.getByRole("link", { name: "打开早期阶段对话" })).toHaveAttribute("href", "/aidt/p1?step=1&history=1");
      expect(screen.queryByTestId("native-chat")).toBeNull();
      expect(mocks.chat).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("saves problem cards before opening them and keeps their identity across rename and deletion", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true");
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    let saved: AidtSharedStage | null = null;
    const read = vi.spyOn(stages, "readAidtStage").mockImplementation(async (_, id) => ({ stage: id === 1 ? saved : null }));
    const save = vi.spyOn(stages, "saveAidtStage").mockRejectedValueOnce(new Error("offline")).mockImplementation(async input => {
      expect(input.expectedRevision).toBe(saved?.revision ?? 0);
      saved = { projectId: input.projectId, stageId: 1, revision: input.expectedRevision + 1,
        updatedBy: "student-test", updatedAt: "2026-11-21T00:00:00.000Z", content: input.content, sourceStageRevisions: [] };
      return { stage: saved, replayed: false };
    });
    try {
      const view = render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
      expect(await screen.findByRole("heading", { name: "先新建一个问题" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "新建问题" }));
      const input = screen.getByRole("textbox", { name: "问题名称" });
      const create = screen.getByRole("button", { name: "创建问题" });
      expect(create).toBeDisabled();
      fireEvent.change(input, { target: { value: "自习空间" } });
      fireEvent.click(create);
      expect(await screen.findByTestId("err-aidt-problem-save")).toBeVisible();
      expect(input).toHaveValue("自习空间");
      expect(screen.queryByRole("link", { name: "自习空间" })).toBeNull();
      fireEvent.click(create);
      const card = await screen.findByRole("link", { name: "自习空间" });
      await waitFor(() => expect(card).toHaveFocus());
      const href = card.getAttribute("href");
      expect(href).toMatch(/^\/aidt\/p1\?step=1&entity=/);
      expect(save.mock.calls[1]![0].operationId).toBe(save.mock.calls[0]![0].operationId);

      fireEvent.click(screen.getByRole("button", { name: "编辑问题 自习空间" }));
      expect(screen.getByRole("textbox", { name: "问题名称" })).toHaveValue("自习空间");
      fireEvent.change(screen.getByRole("textbox", { name: "问题名称" }), { target: { value: "图书馆自习空间" } });
      fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
      expect(await screen.findByRole("link", { name: "图书馆自习空间" })).toHaveAttribute("href", href);

      mocks.search = href!.split("?")[1]!;
      view.rerender(<ProjectAidt projectId="p1" sub="aidt-1" canWrite activeEntityId={new URLSearchParams(mocks.search).get("entity")!} />);
      expect(await screen.findByRole("heading", { name: "图书馆自习空间" }, { timeout: 5000 })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "返回问题列表" })).toHaveAttribute("href", "/aidt/p1?step=1");
      mocks.search = "";
      view.rerender(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
      fireEvent.click(screen.getByRole("button", { name: "删除问题 图书馆自习空间" }));
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      expect(screen.getByRole("link", { name: "图书馆自习空间" })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "删除问题 图书馆自习空间" }));
      fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
      expect(await screen.findByRole("heading", { name: "先新建一个问题" })).toBeVisible();
      const archived = listAidtProblems(save.mock.calls[3]![0].content.draft);
      expect(archived).toEqual([{ id: new URLSearchParams(href!.split("?")[1]).get("entity"), title: "图书馆自习空间", archived: true }]);

      view.unmount();
      render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite={false} />);
      expect(await screen.findByRole("heading", { name: "暂无问题" })).toBeVisible();
      expect(screen.queryByRole("button", { name: "新建问题" })).toBeNull();
    } finally { read.mockRestore(); save.mockRestore(); vi.unstubAllEnvs(); }
  });
  it.each([true, false])("opens the first-party legacy report link with its saved manuscript (canWrite=%s)", async canWrite => {
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    const markdown = "# 已有小组研究报告\nQA人工修订正文，不得被目录或重新整理替换。";
    const read = vi.spyOn(stages, "readAidtStage").mockImplementation(async (_projectId, stageId) => ({ stage: stageId === 6 ? {
      projectId: "p1", stageId: 6, revision: 4, updatedBy: "student-test", updatedAt: "2026-11-21T00:00:00.000Z", sourceStageRevisions: [],
      content: { schemaVersion: 1, draft: { fields: {}, ideas: [], selectedIdeaId: "" }, summaryReport: { markdown, sourceStageRevisions: [] } },
    } : null }));
    const save = vi.spyOn(stages, "saveAidtStage");
    try {
      mocks.search = "step=6&tool=report";
      render(<ProjectAidt projectId="p1" sub="aidt-6" canWrite={canWrite} />);
      const editor = await screen.findByLabelText("小组报告草稿");
      await waitFor(() => expect(editor).toHaveValue(markdown));
      expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("小组报告已保存 · 待确认");
      expect(screen.queryByTestId("aidt-step-entity-directory")).toBeNull();
      if (canWrite) {
        expect(editor).toBeEnabled();
        expect(mocks.chat).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p1", step: expect.objectContaining({ id: 6 }), purpose: undefined }));
      } else {
        expect(editor).toBeDisabled();
        expect(screen.getByTestId("aidt-report-save")).toBeDisabled();
        expect(mocks.chat).not.toHaveBeenCalled();
      }
      fireEvent.click(screen.getByRole("button", { name: "阅读预览" }));
      expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toHaveTextContent("QA人工修订正文");
      expect(save).not.toHaveBeenCalled();
    } finally { read.mockRestore(); save.mockRestore(); }
  });
  it.each(["resolved", "failed"])("preserves actual project report review when a delayed Chat host remounts (%s)", async host => {
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    const markdown = "# 服务器已保存正文\n本次仍未开展真实测试。";
    const sources = [{ stageId: 1 as const, revision: 1 }];
    const stage6 = { projectId: "p1", stageId: 6 as const, revision: 1, updatedBy: "student-test", updatedAt: "2026-11-21T00:00:00.000Z", sourceStageRevisions: [],
      content: { schemaVersion: 1 as const, draft: { fields: {}, ideas: [], selectedIdeaId: "" }, summaryReport: { markdown, sourceStageRevisions: sources } } };
    const stage1 = { ...stage6, stageId: 1 as const, content: { schemaVersion: 1 as const, draft: { fields: { initial: "已保存的问题来源" }, ideas: [], selectedIdeaId: "" } } };
    const read = vi.spyOn(stages, "readAidtStage").mockImplementation(async (_project, stageId) => ({ stage: stageId === 6 ? stage6 : stageId === 1 ? stage1 : null }));
    const save = vi.spyOn(stages, "saveAidtStage").mockImplementation(async input => ({ stage: { ...stage6, revision: 2, content: input.content, sourceStageRevisions: input.sourceStageRevisions }, replayed: false }));
    try {
      mocks.search = "step=6&tool=report";
      const page = render(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
      await waitFor(() => expect(screen.getByLabelText("小组报告草稿")).toHaveValue(markdown));
      await waitFor(() => expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("小组报告已保存 · 待确认"));
      fireEvent.click(screen.getByRole("button", { name: "阅读预览" }));
      fireEvent.click(screen.getByRole("button", { name: "确认审阅此版本" }));
      const previous = screen.getByRole("button", { name: "确认小组报告" });
      expect(save).not.toHaveBeenCalled();
      mocks.chatMount = host;
      page.rerender(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
      const current = screen.getByRole("button", { name: "确认小组报告" });
      expect(current).not.toBe(previous);
      expect(screen.getByRole("article", { name: "小组报告阅读预览" })).toHaveTextContent("本次仍未开展真实测试");
      fireEvent.click(current);
      await waitFor(() => expect(screen.getByTestId("aidt-report-save-state")).toHaveTextContent("小组报告已确认 · V2"));
      expect(save).toHaveBeenCalledOnce();
      expect(save.mock.calls[0]![0]).toMatchObject({ projectId: "p1", stageId: 6, expectedRevision: 1,
        content: { summaryReport: { markdown, sourceStageRevisions: sources, confirmedAtRevision: 2 } } });
    } finally { read.mockRestore(); save.mockRestore(); }
  });
  it("follows the existing visible preview-report link into the report instead of the test directory", async () => {
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    const read = vi.spyOn(stages, "readAidtStage").mockResolvedValue({ stage: null });
    const original = window.location.href;
    try {
      mocks.search = "step=6&tool=outcome&history=1";
      window.history.replaceState(null, "", `/aidt/p1?${mocks.search}`);
      const view = render(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
      const link = await screen.findByRole("link", { name: "预览小组报告" });
      expect(link).toHaveAttribute("href", "/aidt/p1?step=6&tool=report");
      fireEvent.click(link);
      expect(window.location.pathname + window.location.search).toBe("/aidt/p1?step=6&tool=report");
      mocks.search = window.location.search.slice(1);
      view.rerender(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
      expect(await screen.findByTestId("aidt-report-preview")).toBeVisible();
      expect(screen.getByLabelText("小组报告草稿")).toBeEnabled();
      expect(screen.queryByTestId("aidt-step-entity-directory")).toBeNull();
    } finally { read.mockRestore(); window.history.replaceState(null, "", original); }
  });
  it.each([
    [1, "step=1&tool=outcome"], [1, "step=1&tool=chat"],
    [2, "step=2"], [3, "step=3"], [4, "step=4"], [5, "step=5"],
    [6, "step=6"], [6, "step=6&tool=outcome"], [6, "step=6&summary=1"], [6, "step=6&summary=1&tool=report"],
  ])("retains the intended entity directory for stage %s query %s", async (stageId, query) => {
    const stages = await import("@/features/aidt/lib/live-aidt-stages");
    const read = vi.spyOn(stages, "readAidtStage").mockResolvedValue({ stage: null });
    try {
      mocks.search = String(query);
      render(<ProjectAidt projectId="p1" sub={`aidt-${stageId}`} canWrite />);
      expect(await screen.findByTestId("aidt-step-entity-directory")).toBeVisible();
      expect(screen.queryByTestId("aidt-report-preview")).toBeNull();
      expect(screen.queryByTestId("native-chat")).toBeNull();
      if (String(query).includes("summary=1")) expect(await screen.findByRole("link", { name: "打开小组研究报告" })).toHaveAttribute("href", "/aidt/p1?step=6&summary=1&entity=group-report");
    } finally { read.mockRestore(); }
  });
  it("passes the actual project, step and current thread into canonical Chat v2", async () => {
    mocks.search = "thread=t1&history=1";
    render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
    await screen.findByTestId("native-chat");
    expect(mocks.chat).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p1", thread: "t1", step: expect.objectContaining({ id: 3 }) }));
    const link = screen.getByTestId("aidt-stage-desktop-4");
    expect(link.getAttribute("href")).not.toContain("thread=");
  });
  it("reuses the recorder only for an explicit writable recording selection", async () => {
    mocks.search = "tool=record&history=1";
    const { rerender } = render(<ProjectAidt projectId="p1" sub="aidt-2" canWrite />);
    await screen.findByTestId("native-rec");
    expect(mocks.rec).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", uiState: "default" }));
    await screen.findByTestId("native-chat");
    expect(screen.getByTestId("aidt-tool-panel")).toBeVisible();
    expect(mocks.chat.mock.calls.at(-1)![0].hostPanel.open).toBe(true);
    rerender(<ProjectAidt projectId="p1" sub="aidt-2" canWrite={false} />);
    expect(screen.queryByTestId("native-rec")).toBeNull();
    expect(screen.getByTestId("aidt-readonly")).toBeVisible();
    expect(screen.getByTestId("native-resources")).toBeVisible();
  });
  it("a failed resource read is an error, never empty or an editable design", async () => {
    mocks.search = "tool=design&resource=d1&history=1";
    mocks.list.mockRejectedValue(new Error("offline"));
    render(<ProjectAidt projectId="p1" sub="aidt-5" canWrite />);
    expect(await screen.findByTestId("aidt-resource-error")).toHaveTextContent("资源加载失败");
    expect(mocks.design).not.toHaveBeenCalled();
  });
  it("checks project association before opening the real design, and rejects foreign resources", async () => {
    mocks.search = "tool=design&resource=d1&history=1";
    const { rerender } = render(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
    expect(await screen.findByText(/该资源未关联当前项目/)).toBeVisible();
    mocks.list.mockResolvedValue({ items: [{ id: "d1", kind: "design" }] });
    rerender(<ProjectAidt projectId="p2" sub="aidt-6" canWrite />);
    await screen.findByTestId("native-design");
    expect(mocks.list).toHaveBeenLastCalledWith("p2");
    expect(mocks.design).toHaveBeenCalledWith(expect.objectContaining({ projectId: "d1", teachingProjectId: "p2", stageId: 6, sessionToken: "token-test" }));
  });
  it("retains step and thread when opening a Board, and opens saved transcripts in place", async () => {
    mocks.search = "tool=whiteboard&thread=t1&history=1";
    render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
    await screen.findByTestId("native-resources");
    const props = mocks.resources.mock.calls.at(-1)![0];
    const board = new URL(props.resourceHref("whiteboard", "b1"), "https://local");
    expect(board.searchParams.get("aidtStep")).toBe("3");
    expect(board.searchParams.get("aidtThread")).toBe("t1");
    expect(props.resourceHref("personal_transcription", "s1")).toContain("resource=s1");
  });
  it("does not mount mutating native tools for an archived or non-writing view", async () => {
    mocks.search = "tool=chat&history=1";
    render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite={false} />);
    await waitFor(() => expect(screen.getByTestId("readonly-conversations")).toBeVisible());
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.rec).not.toHaveBeenCalled();
  });
});

it("keeps the Chat focused on one problem with a link to project overview", async () => {
  mocks.search = "tool=chat&history=1";
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  await screen.findByTestId("native-chat");
  expect(screen.queryByRole("navigation", { name: "设计思维步骤" })).toBeNull();
  expect(screen.getByRole("link", { name: "项目总览" })).toHaveAttribute("href", "/aidt/p1");
  expect(screen.queryByRole("link", { name: "返回本步对话" })).toBeNull();
});

it("keeps the dashboard focused on six steps without the self-review accordion", () => {
  render(<AidtDashboard href={(id) => aidtHref("p1", id)} />);
  expect(screen.queryByTestId("aidt-self-review")).toBeNull();
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("lets people choose an iteration destination within the same group", async () => {
  mocks.search = "history=1";
  render(<ProjectAidt projectId="group-a" sub="aidt-6" canWrite />);
  await screen.findByTestId("native-chat");
  const link = screen.getByTestId("aidt-stage-desktop-2");
  expect(link).toHaveAttribute("href", "/aidt/group-a?step=2&history=1");
});

it("keeps UI outcome drafts during tool navigation and clears them on a different group", async () => {
  mocks.search = "tool=outcome&history=1";
  const { rerender } = render(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  const input = screen.getByLabelText("初始问题");
  fireEvent.change(input, { target: { value: "只属于A组的本页草稿" } });
  mocks.search = "tool=chat&history=1";
  rerender(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  expect(screen.queryByLabelText("初始问题")).toBeNull();
  mocks.search = "tool=outcome&history=1";
  rerender(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("只属于A组的本页草稿");
  rerender(<ProjectAidt projectId="group-b" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("");
});
it("the student UI does not surface simulated interviews or deep research as first-edition study evidence", async () => {
  mocks.search = "tool=itv&history=1";
  render(<ProjectAidt projectId="p1" sub="aidt-2" canWrite />);
  await screen.findByTestId("native-chat");
  expect(screen.queryByRole("link", { name: "AI 模拟访谈" })).toBeNull();
  expect(mocks.resources).not.toHaveBeenCalled();
});
it("uses one closed native Inspector host instead of a second assistant or tool wall", async () => {
  mocks.search = "history=1";
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await screen.findByTestId("native-chat");
  expect(screen.getByTestId("aidt-assistant-panel")).toBeVisible();
  expect(screen.queryByRole("button", { name: "AI 引导师" })).toBeNull();
  expect(screen.queryByTestId("aidt-shared-stage")).toBeNull();
  expect(screen.queryByTestId("aidt-tools")).toBeNull();
  expect(document.getElementById("aidt-artifact-shelf")).toBeNull();
  expect(mocks.chat.mock.calls.at(-1)![0].hostPanel).toEqual(expect.objectContaining({ title: "工作坊问题", open: false }));
});
it("keeps the same Chat mounted while outcomes open and close in its native host panel", async () => {
  mocks.search = "history=1";
  const view = render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  const chat = await screen.findByTestId("native-chat");
  mocks.search = "tool=outcome&history=1"; view.rerender(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  await screen.findByTestId("aidt-stage-output");
  expect(screen.getByTestId("native-chat")).toBe(chat);
  expect(screen.getByTestId("aidt-tools")).toHaveTextContent("更多工具");
  expect(screen.queryByTestId("aidt-personal-checkpoints")).toBeNull();
  mocks.search = "history=1"; view.rerender(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  expect(screen.getByTestId("native-chat")).toBe(chat);
  expect(screen.queryByTestId("aidt-stage-output")).toBeNull();
});

it("keeps failed shared reads visible and actionable on Chat without restoring the full save toolbar", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); const client = await import("@/features/aidt/lib/live-aidt-stages"); const read = vi.spyOn(client, "readAidtStage").mockRejectedValue(new Error("offline"));
  try {
    mocks.search = "thread=real-thread&history=1"; render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); const alert = await screen.findByTestId("aidt-shared-chat-alert"); expect(alert).toHaveAttribute("role", "alert"); expect(alert).toHaveTextContent("读取失败"); expect(screen.getByRole("link", { name: "进入成果核对" })).toHaveAttribute("href", "/aidt/p1?step=1&tool=outcome&thread=real-thread&history=1"); expect(screen.queryByTestId("aidt-shared-stage")).toBeNull(); expect(screen.getByRole("button", { name: "重试读取" })).toBeVisible();
  } finally { read.mockRestore(); vi.unstubAllEnvs(); }
});
it("retains the complete save and restore controls where the student edits stage outcomes", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); const client = await import("@/features/aidt/lib/live-aidt-stages"); const read = vi.spyOn(client, "readAidtStage").mockResolvedValue({ stage: null });
  try {
    mocks.search = "tool=outcome&history=1"; render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await waitFor(() => expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("尚未保存")); expect(screen.getByTestId("aidt-shared-stage")).toBeVisible(); expect(screen.getByTestId("aidt-shared-save")).toBeVisible(); expect(screen.getByTestId("native-chat")).toBeVisible(); expect(screen.getByLabelText("初始问题")).toBeVisible();
  } finally { read.mockRestore(); vi.unstubAllEnvs(); }
});

it("keeps the saved learning round across tools and native resources but clears it on manual stage changes", async () => {
  mocks.search = "tool=whiteboard&thread=t1&returnRevision=3&history=1";
  render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
  await screen.findByTestId("native-resources");
  const props = mocks.resources.mock.calls.at(-1)![0];
  for (const value of [props.resourceHref("whiteboard", "b1"), props.transformCreateHref("/studio/board/new?projectId=p1")]) {
    const target = new URL(value, "https://workspace.invalid");
    expect(target.searchParams.get("aidtReturnRevision")).toBe("3");
    expect(target.searchParams.get("aidtStep")).toBe("3");
  }
  expect(new URL(props.resourceHref("personal_transcription", "s1"), "https://workspace.invalid").searchParams.get("returnRevision")).toBe("3");
  expect(mocks.chat.mock.calls.at(-1)![0].returnRevision).toBe("3");
  await waitFor(() => expect(mocks.chat).toHaveBeenLastCalledWith(expect.objectContaining({ returnRevision: "3" })));
  expect(screen.getByTestId("aidt-stage-desktop-4").getAttribute("href")).not.toContain("returnRevision");
});

it("starts with conversation space instead of a workflow wall or a second reference drawer", async () => {
  mocks.search = "history=1";
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await screen.findByTestId("native-chat");
  expect(screen.queryByText("本步目标与学习提示")).toBeNull();
  expect(screen.queryByLabelText("当前学习任务")).toBeNull();
  expect(document.getElementById("aidt-artifact-shelf")).toBeNull();
  expect(screen.queryByTestId("aidt-tool-panel")).toBeNull();
  expect(mocks.chat.mock.calls.at(-1)![0].hostPanel.open).toBe(false);
});

it("closes the native tools menu when workspace navigation commits before the menu's bubble handler", async () => {
  const original = window.location.href;
  window.history.replaceState(null, "", "/aidt/p1?step=1&tool=outcome&thread=t1&history=1");
  mocks.search = "step=1&tool=outcome&thread=t1&history=1";
  try {
    render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
    const chat = await screen.findByTestId("native-chat");
    fireEvent.pointerDown(screen.getByTestId("aidt-tools"), { button: 0, ctrlKey: false });
    const board = await screen.findByRole("menuitem", { name: "白板" });
    fireEvent.click(board);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(new URL(window.location.href).searchParams.get("tool")).toBe("whiteboard");
    expect(new URL(window.location.href).searchParams.get("thread")).toBe("t1");
    expect(new URL(window.location.href).searchParams.get("history")).toBe("1");
    expect(screen.getByTestId("native-chat")).toBe(chat);
  } finally { window.history.replaceState(null, "", original); }
});


it("confirms one workshop problem through the native inspector and marks completion after the saved version", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true");
  const stages = await import("@/features/aidt/lib/live-aidt-stages");
  const read = vi.spyOn(stages, "readAidtStage").mockResolvedValue({ stage: null });
  const save = vi.spyOn(stages, "saveAidtStage").mockImplementation(async input => ({
    replayed: false, stage: {
      projectId: input.projectId, stageId: 1, revision: 1, content: input.content,
      sourceStageRevisions: input.sourceStageRevisions,
      updatedBy: "student-test", updatedAt: "2026-11-20T00:00:00.000Z",
    },
  }));
  try {
    mocks.search = "tool=outcome&history=1";
    render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
    await screen.findByTestId("native-chat");
    const ask = screen.getByRole("button", { name: "用 AI 追问" });
    const confirm = screen.getByRole("button", { name: "确认本轮成果并保存" });
    expect(ask).toBeDisabled();
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("初始问题"), { target: { value: "新生为什么很少去借设备？" } });
    expect(ask).toBeEnabled();
    fireEvent.change(screen.getByTestId("aidt-problem-reflection-why"), { target: { value: "影响新生完成作业" } });
    fireEvent.click(screen.getByTestId("aidt-problem-source-observation"));
    fireEvent.change(screen.getByTestId("aidt-problem-reflection-details"), { target: { value: "看到两位同学在设备室门口停留后离开" } });
    fireEvent.click(screen.getByTestId("aidt-problem-reflection-confirm"));
    fireEvent.change(screen.getByLabelText("拟确认的工作坊问题"), { target: { value: "新生第一次借设备时遇到哪些困难？" } });
    expect(screen.queryByRole("link", { name: "继续第2步" })).toBeNull();
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByRole("link", { name: "继续第2步" })).toHaveAttribute("href", "/aidt/p1?step=2");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].content.draft.fields.rewrittenTheme).toBe("新生第一次借设备时遇到哪些困难？");
    expect(screen.getByTestId("aidt-round-completion")).toHaveTextContent("已确认并保存");
    fireEvent.click(await screen.findByRole("button", { name: "修订问题" }));
    fireEvent.change(screen.getByLabelText("拟确认的工作坊问题"), { target: { value: "准备再考虑借设备和归还设备" } });
    expect(screen.queryByRole("link", { name: "继续第2步" })).toBeNull();
    expect(await screen.findByTestId("aidt-last-confirmed-problem")).toHaveTextContent("新生第一次借设备时遇到哪些困难？");
  } finally {
    read.mockRestore();
    save.mockRestore();
    vi.unstubAllEnvs();
  }
});
