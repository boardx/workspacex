import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidt } from "@/features/aidt/components/project-aidt";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { aidtHref } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ search: "", list: vi.fn(), chat: vi.fn(), rec: vi.fn(), design: vi.fn(), resources: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "org-test", userId: "student-test", sessionToken: "token-test" } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/dynamic", () => ({ default: (load: () => Promise<{ default: React.ComponentType<any> }>) => {
  const Lazy = React.lazy(async () => ({ default: await load() as unknown as React.ComponentType<any> }));
  return function Dynamic(props: any) { return <React.Suspense fallback={<p>加载中</p>}><Lazy {...props} /></React.Suspense>; };
} }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list }));
vi.mock("@/features/aidt/components/project-aidt-chat", () => ({ ProjectAidtChat: (props: any) => { mocks.chat(props); return <div data-testid="native-chat" />; } }));
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
beforeEach(() => { vi.clearAllMocks(); mocks.search = ""; mocks.list.mockResolvedValue({ items: [] }); });
describe("native AIDT project workspace", () => {
  it("shows six steps with project-safe URLs and no fictional progress", () => {
    render(<AidtDashboard href={(id) => aidtHref("p/1", id)} />);
    expect(screen.getAllByRole("link")).toHaveLength(6);
    expect(screen.getByTestId("aidt-step-2")).toHaveAttribute("href", "/aidt/p%2F1?step=2");
    expect(screen.queryByText(/100%|已完成/)).toBeNull();
  });
  it("passes the actual project, step and current thread into canonical Chat v2", async () => {
    mocks.search = "thread=t1";
    render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
    await screen.findByTestId("native-chat");
    expect(mocks.chat).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: "p1", thread: "t1", step: expect.objectContaining({ id: 3 }) }));
    const link = screen.getByTestId("aidt-stage-desktop-4");
    expect(link.getAttribute("href")).not.toContain("thread=");
  });
  it("reuses the recorder only for an explicit writable recording selection", async () => {
    mocks.search = "tool=record";
    const { rerender } = render(<ProjectAidt projectId="p1" sub="aidt-2" canWrite />);
    await screen.findByTestId("native-rec");
    expect(mocks.rec).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p1", uiState: "default" }));
    await screen.findByTestId("native-chat");
    expect(screen.getByTestId("aidt-tool-panel")).toBeVisible();
    expect(screen.getByRole("link", { name: "关闭工具，回到对话" }).getAttribute("href")).toContain("tool=chat");
    rerender(<ProjectAidt projectId="p1" sub="aidt-2" canWrite={false} />);
    expect(screen.queryByTestId("native-rec")).toBeNull();
    expect(screen.getByTestId("aidt-readonly")).toBeVisible();
    expect(screen.getByTestId("native-resources")).toBeVisible();
  });
  it("a failed resource read is an error, never empty or an editable design", async () => {
    mocks.search = "tool=design&resource=d1";
    mocks.list.mockRejectedValue(new Error("offline"));
    render(<ProjectAidt projectId="p1" sub="aidt-5" canWrite />);
    expect(await screen.findByRole("alert")).toHaveTextContent("资源加载失败");
    expect(mocks.design).not.toHaveBeenCalled();
  });
  it("checks project association before opening the real design, and rejects foreign resources", async () => {
    mocks.search = "tool=design&resource=d1";
    const { rerender } = render(<ProjectAidt projectId="p1" sub="aidt-6" canWrite />);
    expect(await screen.findByRole("alert")).toHaveTextContent("未关联当前项目");
    mocks.list.mockResolvedValue({ items: [{ id: "d1", kind: "design" }] });
    rerender(<ProjectAidt projectId="p2" sub="aidt-6" canWrite />);
    await screen.findByTestId("native-design");
    expect(mocks.list).toHaveBeenLastCalledWith("p2");
    expect(mocks.design).toHaveBeenCalledWith(expect.objectContaining({ projectId: "d1", teachingProjectId: "p2", stageId: 6, sessionToken: "token-test" }));
  });
  it("retains step and thread when opening a Board, and opens saved transcripts in place", async () => {
    mocks.search = "tool=whiteboard&thread=t1";
    render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
    await screen.findByTestId("native-resources");
    const props = mocks.resources.mock.calls.at(-1)![0];
    const board = new URL(props.resourceHref("whiteboard", "b1"), "https://local");
    expect(board.searchParams.get("aidtStep")).toBe("3");
    expect(board.searchParams.get("aidtThread")).toBe("t1");
    expect(props.resourceHref("personal_transcription", "s1")).toContain("resource=s1");
  });
  it("does not mount mutating native tools for an archived or non-writing view", async () => {
    mocks.search = "tool=chat";
    render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite={false} />);
    await waitFor(() => expect(screen.getByTestId("readonly-conversations")).toBeVisible());
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.rec).not.toHaveBeenCalled();
  });
});

it("keeps a named keyboard-focusable six-step navigation without a duplicate return action on Chat", async () => {
  mocks.search = "tool=chat";
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  await screen.findByTestId("native-chat");
  expect(screen.getByRole("navigation", { name: "设计思维步骤" })).toBeVisible();
  expect(screen.getByTestId("aidt-stage-desktop-1")).toHaveAttribute("aria-current", "step");
  expect(screen.queryByRole("link", { name: "返回本步对话" })).toBeNull();
});

it("offers formative outcome checks without pretending group confirmation or grading is saved", () => {
  render(<AidtDashboard href={(id) => aidtHref("p1", id)} />);
  const review = screen.getByTestId("aidt-self-review");
  expect(review).toHaveTextContent("不是自动完成判定");
  expect(review).toHaveTextContent("教师评分尚未提供");
  expect(screen.queryByRole("checkbox")).toBeNull();
});
it("lets people choose an iteration destination within the same group", async () => {
  render(<ProjectAidt projectId="group-a" sub="aidt-6" canWrite />);
  await screen.findByTestId("native-chat");
  const link = screen.getByTestId("aidt-stage-desktop-2");
  expect(link).toHaveAttribute("href", "/aidt/group-a?step=2");
});

it("keeps UI outcome drafts during tool navigation and clears them on a different group", async () => {
  mocks.search = "tool=outcome";
  const { rerender } = render(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  const input = screen.getByLabelText("初始问题");
  fireEvent.change(input, { target: { value: "只属于A组的本页草稿" } });
  mocks.search = "tool=chat";
  rerender(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  expect(screen.queryByLabelText("初始问题")).toBeNull();
  mocks.search = "tool=outcome";
  rerender(<ProjectAidt projectId="group-a" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("只属于A组的本页草稿");
  rerender(<ProjectAidt projectId="group-b" sub="aidt-1" canWrite />);
  expect(screen.getByLabelText("初始问题")).toHaveValue("");
});
it("the student UI does not surface simulated interviews or deep research as first-edition study evidence", async () => {
  mocks.search = "tool=itv";
  render(<ProjectAidt projectId="p1" sub="aidt-2" canWrite />);
  await screen.findByTestId("native-chat");
  expect(screen.queryByRole("link", { name: "AI 模拟访谈" })).toBeNull();
  expect(mocks.resources).not.toHaveBeenCalled();
});
it("keeps the default native Chat clear of duplicate assistant and structured-save rows while preserving advanced access", async () => {
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await screen.findByTestId("native-chat");
  expect(screen.getByTestId("aidt-assistant-panel")).toBeVisible(); expect(screen.queryByRole("button", { name: "AI 引导师" })).toBeNull(); expect(screen.queryByTestId("aidt-shared-stage")).toBeNull(); expect(screen.queryByTestId("aidt-shared-unavailable")).toBeNull();
  const tools = screen.getByTestId("aidt-tools"); expect(tools).toContainElement(screen.getByTestId("aidt-personal-checkpoints")); expect(tools).not.toHaveAttribute("open"); expect(screen.getByTestId("aidt-open-output")).toHaveAttribute("href", "/aidt/p1?step=1&tool=outcome");
});
it("widens the reference shelf without remounting the stage chat", async () => {
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />);
  const chat = await screen.findByTestId("native-chat");
  expect(screen.getByRole("button", { name: "引用与产物" })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "引用与产物" }));
  const handle = screen.getByRole("separator", { name: "调整引用与产物宽度" });
  expect(handle).toHaveAttribute("aria-valuenow", "320");
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(handle).toHaveAttribute("aria-valuenow", "352");
  fireEvent.click(screen.getByRole("button", { name: "关闭成果" }));
  expect(screen.getByRole("button", { name: "引用与产物" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByTestId("native-chat")).toBe(chat);
});

it("keeps failed shared reads visible and actionable on Chat without restoring the full save toolbar", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); const client = await import("@/features/aidt/lib/live-aidt-stages"); const read = vi.spyOn(client, "readAidtStage").mockRejectedValue(new Error("offline"));
  try {
    mocks.search = "thread=real-thread"; render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); const alert = await screen.findByTestId("aidt-shared-chat-alert"); expect(alert).toHaveAttribute("role", "alert"); expect(alert).toHaveTextContent("读取失败"); expect(screen.getByRole("link", { name: "进入成果核对" })).toHaveAttribute("href", "/aidt/p1?step=1&tool=outcome&thread=real-thread"); expect(screen.getByTestId("aidt-open-output")).toHaveTextContent("读取失败"); expect(screen.queryByTestId("aidt-shared-stage")).toBeNull(); expect(screen.getByRole("button", { name: "重试读取" })).toBeVisible();
  } finally { read.mockRestore(); vi.unstubAllEnvs(); }
});
it("retains the complete save and restore controls where the student edits stage outcomes", async () => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_AIDT", "true"); const client = await import("@/features/aidt/lib/live-aidt-stages"); const read = vi.spyOn(client, "readAidtStage").mockResolvedValue({ stage: null });
  try {
    mocks.search = "tool=outcome"; render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await waitFor(() => expect(screen.getByTestId("aidt-shared-status")).toHaveTextContent("尚未保存")); expect(screen.getByTestId("aidt-shared-stage")).toBeVisible(); expect(screen.getByTestId("aidt-shared-save")).toBeVisible(); expect(screen.getByRole("button", { name: "AI 引导师" })).toBeVisible(); expect(screen.getByLabelText("初始问题")).toBeVisible();
  } finally { read.mockRestore(); vi.unstubAllEnvs(); }
});

it("keeps the saved learning round across tools and native resources but clears it on manual stage changes", async () => {
  mocks.search = "tool=whiteboard&thread=t1&returnRevision=3";
  render(<ProjectAidt projectId="p1" sub="aidt-3" canWrite />);
  await screen.findByTestId("native-resources");
  const props = mocks.resources.mock.calls.at(-1)![0];
  for (const value of [props.resourceHref("whiteboard", "b1"), props.transformCreateHref("/studio/board/new?projectId=p1")]) {
    const target = new URL(value, "https://workspace.invalid");
    expect(target.searchParams.get("aidtReturnRevision")).toBe("3");
    expect(target.searchParams.get("aidtStep")).toBe("3");
  }
  expect(new URL(props.resourceHref("personal_transcription", "s1"), "https://workspace.invalid").searchParams.get("returnRevision")).toBe("3");
  expect(screen.getByRole("link", { name: "关闭工具，回到对话" }).getAttribute("href")).toContain("returnRevision=3");
  await waitFor(() => expect(mocks.chat).toHaveBeenLastCalledWith(expect.objectContaining({ returnRevision: "3" })));
  expect(screen.getByTestId("aidt-stage-desktop-4").getAttribute("href")).not.toContain("returnRevision");
});

it("starts with conversation space instead of a workflow wall or open reference drawer", async () => {
  render(<ProjectAidt projectId="p1" sub="aidt-1" canWrite />); await screen.findByTestId("native-chat");
  expect(screen.queryByText("本步目标与学习提示")).toBeNull();
  expect(screen.queryByLabelText("当前学习任务")).toBeNull();
  expect(screen.getByRole("button", {name:"引用与产物"})).toHaveAttribute("aria-expanded","false");
  expect(document.getElementById("aidt-artifact-shelf")).toHaveAttribute("hidden");
  expect(screen.getAllByTestId("aidt-open-output")).toHaveLength(1);
  expect(screen.getByTestId("aidt-tools")).not.toHaveAttribute("open");
});
