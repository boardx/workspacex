import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecApp } from "@/components/rec/rec-app";
import { mockIdentity } from "@/lib/identity";

vi.mock("next/navigation", () => ({
  usePathname: () => "/rec",
  useRouter: () => ({ replace: vi.fn() }),
  // #728：TopBar 新增读 useSearchParams 解析 /chat?projectId=…（本屏是 /rec，不需要
  // 真的解析，但 TopBar 无条件调用这个 hook，缺席会在挂载阶段直接抛错）。
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  listTags: vi.fn(),
  updateMetadata: vi.fn(),
  deleteTranscription: vi.fn(),
  stopTranscription: vi.fn(),
  openAsr: vi.fn(),
  stopAsr: vi.fn(),
  openAsrDraft: vi.fn(),
  stopAsrDraft: vi.fn(),
  draftHandlers: null as null | {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (reason: string) => void;
    onFinished: () => void;
  },
  handlers: null as null | {
    onState: (state: "idle" | "connecting" | "recording" | "stopping" | "error") => void;
    onInterim: (text: string) => void;
    onFinal: (event: { captureId: string; segmentId: string; ordinal: number; text: string; startMs: number; endMs: number }) => void;
    onError: (reason: string) => void;
  },
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { sessionToken: "session-token", currentOrgId: "org-yuanyang" } }),
}));

vi.mock("@/lib/live-personal-transcriptions", () => ({
  createPersonalTranscription: api.create,
  listPersonalTranscriptions: api.list,
  readPersonalTranscription: api.read,
  updatePersonalTranscriptionContent: api.update,
  listPersonalTranscriptionTags: api.listTags,
  updatePersonalTranscriptionMetadata: api.updateMetadata,
  deletePersonalTranscription: api.deleteTranscription,
  stopPersonalTranscription: api.stopTranscription,
}));

vi.mock("@/lib/BoardxRealtimeAsrClient", () => ({
  openBoardxRealtimeAsr: api.openAsr,
}));

vi.mock("@/lib/live-asr-draft", () => ({
  openAsrDraftStream: api.openAsrDraft,
}));

const EUROPE = {
  sessionId: "europe-entry",
  name: "欧洲市场进入讨论",
  tags: ["客户", "市场研究"],
  status: "idle",
  durationMs: 3_492_000,
  createdAt: "2026-08-11T06:30:00.000Z",
  updatedAt: "2026-08-11T07:28:12.000Z",
} as const;

beforeEach(() => {
  api.create.mockReset();
  api.list.mockReset();
  api.read.mockReset();
  api.update.mockReset();
  api.listTags.mockReset();
  api.updateMetadata.mockReset();
  api.deleteTranscription.mockReset();
  api.stopTranscription.mockReset();
  api.openAsr.mockReset();
  api.stopAsr.mockReset();
  api.openAsrDraft.mockReset();
  api.stopAsrDraft.mockReset();
  api.draftHandlers = null;
  api.handlers = null;
  api.stopAsr.mockResolvedValue(undefined);
  api.openAsr.mockImplementation(async (_sessionId: string, options: { handlers: typeof api.handlers }) => {
    api.handlers = options.handlers;
    return { captureId: "capture-live", stop: api.stopAsr };
  });
  api.stopAsrDraft.mockResolvedValue(undefined);
  api.openAsrDraft.mockImplementation(async (handlers: typeof api.draftHandlers) => {
    api.draftHandlers = handlers;
    return { stop: api.stopAsrDraft };
  });
  api.list.mockResolvedValue({ items: [EUROPE], nextCursor: null });
  api.listTags.mockResolvedValue({ tags: ["客户", "市场研究"] });
  api.read.mockResolvedValue({
    ...EUROPE,
    content: "这是数据库中保存的真实逐字稿。",
  });
  api.update.mockImplementation(async (_sessionId: string, content: string) => ({ ...EUROPE, content }));
  api.updateMetadata.mockImplementation(async (_sessionId: string, input: { name: string; tags: string[] }) => {
    const updated = { ...EUROPE, name: input.name, tags: input.tags };
    api.list.mockResolvedValue({ items: [updated], nextCursor: null });
    return updated;
  });
  api.deleteTranscription.mockResolvedValue({ deleted: true });
  api.stopTranscription.mockImplementation(async (sessionId: string) => ({
    ...EUROPE,
    sessionId,
    status: "idle",
  }));
});

function renderHistory() {
  render(
    <RecApp
      identity={mockIdentity("org-yuanyang", null)}
      uiState="default"
      screen="live"
      carrier="interview"
      view="facilitator"
      qs={{}}
    />,
  );
}

describe("实时转录历史工作台", () => {
  it("历史卡片来自真实 API，并能打开包含名称与标签的创建弹窗", async () => {
    renderHistory();

    expect(screen.getByTestId("rec-history-page")).toBeInTheDocument();
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({}, "session-token"));
    expect(await screen.findAllByTestId(/^rec-history-card-/)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("rec-create-open"));

    expect(screen.getByTestId("rec-create-dialog")).toBeVisible();
    expect(screen.getByTestId("rec-create-name")).toHaveValue("");
    expect(screen.getByTestId("rec-create-name-count")).toHaveTextContent("0/100");
    expect(screen.getByTestId("rec-create-tag-count")).toHaveTextContent("0/5");
    expect(screen.getByTestId("rec-create-submit")).toBeDisabled();
  });

  it("提交新建转录走真实 API，保留自定义标签并立即进入该场工作台", async () => {
    api.create.mockResolvedValue({
      sessionId: "jiujiang",
      name: "江西九江",
      tags: ["客户成功"],
      status: "idle",
      durationMs: 0,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    renderHistory();

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("rec-create-open"));
    fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: "江西九江" } });
    fireEvent.change(screen.getByTestId("rec-create-tags"), { target: { value: "客户成功" } });
    fireEvent.keyDown(screen.getByTestId("rec-create-tags"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("rec-create-submit"));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(
      { name: "江西九江", tags: ["客户成功"] },
      "session-token",
    ));
    expect(await screen.findByTestId("rec-live-workspace")).toBeVisible();
    expect(screen.getByTestId("rec-live-title")).toHaveTextContent("江西九江");
    expect(screen.getByText(/\u5ba2户成功/)).toBeVisible();
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("待开始");
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("开始转录");
    expect(screen.queryByText(/已连接/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("rec-history-page")).not.toBeInTheDocument();
  });

  it("提交时把尚未按回车确认的标签一并传给创建 API", async () => {
    api.create.mockResolvedValue({
      sessionId: "jiujiang-draft-tag",
      name: "江西九江",
      tags: ["江西"],
      status: "idle",
      durationMs: 0,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    renderHistory();

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("rec-create-open"));
    fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: "江西九江" } });
    fireEvent.change(screen.getByTestId("rec-create-tags"), { target: { value: "江西" } });
    fireEvent.click(screen.getByTestId("rec-create-submit"));

    await waitFor(() => expect(api.create).toHaveBeenCalledWith(
      { name: "江西九江", tags: ["江西"] },
      "session-token",
    ));
  });

  it("点击 API 返回的历史卡片进入对应转录详情", async () => {
    renderHistory();

    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));

    await waitFor(() => expect(api.read).toHaveBeenCalledWith("europe-entry", "session-token"));
    expect(screen.getByTestId("rec-live-workspace")).toBeVisible();
    expect(screen.getByTestId("rec-live-title")).toHaveTextContent("欧洲市场进入讨论");
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("可续录");
    expect(screen.getByText("这是数据库中保存的真实逐字稿。")).toBeVisible();
    expect(screen.queryByText(/本次转录已完成，可以继续生成总结/)).not.toBeInTheDocument();
  });

  it("详情页使用个人持久化 ASR，并按 segmentId 去重拼接 final 文本", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    const button = await screen.findByTestId("rec-live-toggle");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.openAsr).toHaveBeenCalledWith(
      "europe-entry",
      expect.objectContaining({
        sessionToken: "session-token",
        handlers: expect.objectContaining({
          onState: expect.any(Function),
          onInterim: expect.any(Function),
          onFinal: expect.any(Function),
          onError: expect.any(Function),
        }),
      }),
    ));
    expect(api.openAsrDraft).not.toHaveBeenCalled();
    expect(screen.queryByTestId("rec-live-transient-notice")).not.toBeInTheDocument();

    api.handlers!.onInterim("正在识别");
    expect(await screen.findByTestId("rec-live-interim")).toHaveTextContent("正在识别");
    api.handlers!.onFinal({ captureId: "capture-live", segmentId: "segment-1", ordinal: 1, text: "第一句。", startMs: 0, endMs: 1_000 });
    api.handlers!.onFinal({ captureId: "capture-live", segmentId: "segment-1", ordinal: 1, text: "第一句。", startMs: 0, endMs: 1_000 });
    api.handlers!.onFinal({ captureId: "capture-live", segmentId: "segment-2", ordinal: 2, text: "第二句。", startMs: 1_000, endMs: 2_000 });
    await waitFor(() => expect(screen.getByTestId("rec-live-content")).toHaveTextContent(
      "这是数据库中保存的真实逐字稿。 第一句。 第二句。",
    ));
    expect(screen.queryByTestId("rec-live-interim")).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it("停止后等待个人 ASR 完成并重新读取持久化正文", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    fireEvent.click(await screen.findByTestId("rec-live-toggle"));
    await waitFor(() => expect(api.handlers).not.toBeNull());
    api.handlers!.onState("recording");
    await waitFor(() => expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("停止转录"));
    api.read.mockClear();
    api.read.mockResolvedValue({
      ...EUROPE,
      content: "这是数据库中保存的真实逐字稿。 已持久化的尾部结果。",
    });

    fireEvent.click(screen.getByTestId("rec-live-toggle"));

    await waitFor(() => expect(api.stopAsr).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.read).toHaveBeenCalledWith("europe-entry", "session-token"));
    expect(screen.getByTestId("rec-live-content")).toHaveTextContent("已持久化的尾部结果");
  });

  it("编辑完整正文调用持久化 API 并显示服务端结果", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    fireEvent.click(await screen.findByTestId("rec-live-edit"));
    fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "修改后的全文" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("europe-entry", "修改后的全文", "session-token"));
    expect(screen.getByTestId("rec-live-content")).toHaveTextContent("修改后的全文");
  });

  it("刷新后仍从 API 读回已创建转录，不依赖组件内存", async () => {
    api.list.mockResolvedValueOnce({ items: [], nextCursor: null }).mockResolvedValueOnce({
      items: [{ ...EUROPE, sessionId: "persisted", name: "刷新后仍在" }],
      nextCursor: null,
    });
    const first = render(
      <RecApp identity={mockIdentity("org-yuanyang", null)} uiState="default" screen="live" carrier="interview" view="facilitator" qs={{}} />,
    );
    await screen.findByTestId("rec-history-empty");
    first.unmount();

    renderHistory();

    expect(await screen.findByText("刷新后仍在")).toBeVisible();
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("沿服务端游标读取全部历史，并把搜索与标签传给 API", async () => {
    api.list
      .mockResolvedValueOnce({ items: [EUROPE], nextCursor: "cursor-2" })
      .mockResolvedValueOnce({
        items: [{ ...EUROPE, sessionId: "older", name: "更早的持久化转录" }],
        nextCursor: null,
      })
      .mockResolvedValue({ items: [], nextCursor: null });
    renderHistory();

    await waitFor(() => expect(api.listTags).toHaveBeenCalledWith("session-token"));

    expect(await screen.findByText("更早的持久化转录")).toBeVisible();
    expect(api.list).toHaveBeenNthCalledWith(1, {}, "session-token");
    expect(api.list).toHaveBeenNthCalledWith(2, { cursor: "cursor-2" }, "session-token");

    fireEvent.change(screen.getByTestId("rec-history-search"), { target: { value: "合规要求" } });
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ query: "合规要求" }, "session-token"));

    fireEvent.click(screen.getByTestId("rec-history-tag-客户"));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith(
      { query: "合规要求", tag: "客户" },
      "session-token",
    ));
  });

  it("标签筛选只展示当前用户 API 返回的真实标签", async () => {
    api.listTags.mockResolvedValue({ tags: ["客户成功", "江西"] });
    renderHistory();

    expect(await screen.findByTestId("rec-history-tag-客户成功")).toBeVisible();
    expect(screen.getByTestId("rec-history-tag-江西")).toBeVisible();
    expect(screen.queryByTestId("rec-history-tag-客户")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rec-history-tag-高优先级")).not.toBeInTheDocument();
  });

  it("卡片菜单可修改名称与标签并刷新真实标签", async () => {
    renderHistory();
    fireEvent.pointerDown(await screen.findByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-edit-europe-entry"));
    expect(screen.getByTestId("rec-edit-dialog")).toBeVisible();
    fireEvent.change(screen.getByTestId("rec-edit-name"), { target: { value: "欧洲市场复盘" } });
    fireEvent.change(screen.getByTestId("rec-edit-tags"), { target: { value: "合规" } });
    fireEvent.keyDown(screen.getByTestId("rec-edit-tags"), { key: "Enter" });
    fireEvent.click(screen.getByTestId("rec-edit-submit"));

    await waitFor(() => expect(api.updateMetadata).toHaveBeenCalledWith("europe-entry", {
      name: "欧洲市场复盘",
      tags: ["客户", "市场研究", "合规"],
    }, "session-token"));
    expect(await screen.findByText("欧洲市场复盘")).toBeVisible();
    expect(api.listTags).toHaveBeenCalledTimes(2);
  });

  it("修改后按当前标签重新读取列表，不保留已不匹配的卡片", async () => {
    const OTHER = {
      ...EUROPE,
      sessionId: "other-entry",
      name: "仍属于客户标签的转录",
    } as const;
    api.list
      .mockResolvedValueOnce({ items: [EUROPE, OTHER], nextCursor: null })
      .mockResolvedValueOnce({ items: [EUROPE, OTHER], nextCursor: null })
      .mockResolvedValueOnce({ items: [OTHER], nextCursor: null });
    api.updateMetadata.mockResolvedValue({
      ...EUROPE,
      name: "欧洲市场复盘",
      tags: ["市场研究"],
    });
    renderHistory();

    fireEvent.click(await screen.findByTestId("rec-history-tag-客户"));
    await waitFor(() => expect(api.list).toHaveBeenCalledWith({ tag: "客户" }, "session-token"));
    fireEvent.pointerDown(screen.getByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-edit-europe-entry"));
    fireEvent.click(screen.getByLabelText("移除标签 客户"));
    fireEvent.click(screen.getByTestId("rec-edit-submit"));

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId("rec-history-card-europe-entry")).not.toBeInTheDocument();
    expect(screen.getByTestId("rec-history-card-other-entry")).toBeVisible();
  });

  it("永久删除前二次确认，成功后移除卡片并刷新标签", async () => {
    renderHistory();
    fireEvent.pointerDown(await screen.findByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-delete-europe-entry"));
    expect(screen.getByTestId("rec-delete-dialog")).toHaveTextContent("欧洲市场进入讨论");
    expect(api.deleteTranscription).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rec-delete-confirm"));

    await waitFor(() => expect(api.deleteTranscription).toHaveBeenCalledWith("europe-entry", "session-token"));
    expect(screen.queryByTestId("rec-history-card-europe-entry")).not.toBeInTheDocument();
    expect(api.listTags).toHaveBeenCalledTimes(2);
  });

  it("遗留的转录中卡片可以结束状态，也可以直接永久删除", async () => {
    const recording = { ...EUROPE, status: "recording" as const };
    api.list.mockResolvedValue({ items: [recording], nextCursor: null });
    api.read.mockResolvedValue({ ...recording, content: "遗留正文" });
    renderHistory();

    fireEvent.pointerDown(await screen.findByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-stop-europe-entry"));
    await waitFor(() => expect(api.stopTranscription).toHaveBeenCalledWith("europe-entry", "session-token"));
    expect(screen.getByTestId("rec-history-card-europe-entry")).toHaveTextContent("可续录");

    api.list.mockResolvedValue({ items: [recording], nextCursor: null });
    fireEvent.pointerDown(screen.getByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-delete-europe-entry"));
    fireEvent.click(screen.getByTestId("rec-delete-confirm"));
    await waitFor(() => expect(api.deleteTranscription).toHaveBeenCalledWith("europe-entry", "session-token"));
  });

  it("重新打开遗留转录后，停止按钮会调用服务端恢复操作", async () => {
    const recording = { ...EUROPE, status: "recording" as const };
    api.list.mockResolvedValue({ items: [recording], nextCursor: null });
    api.read.mockResolvedValue({ ...recording, content: "遗留正文" });
    renderHistory();

    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    fireEvent.click(await screen.findByTestId("rec-live-toggle"));

    await waitFor(() => expect(api.stopTranscription).toHaveBeenCalledWith("europe-entry", "session-token"));
    expect(screen.getByTestId("rec-live-toggle")).toHaveTextContent("继续转录");
    expect(api.stopAsrDraft).not.toHaveBeenCalled();
  });

  it("删除成功后即使标签刷新失败也关闭弹窗并保留删除结果", async () => {
    api.listTags
      .mockResolvedValueOnce({ tags: ["客户", "市场研究"] })
      .mockRejectedValueOnce(new Error("TAG_REFRESH_FAILED"));
    renderHistory();
    fireEvent.pointerDown(await screen.findByTestId("rec-history-more-europe-entry"), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByTestId("rec-history-delete-europe-entry"));
    fireEvent.click(screen.getByTestId("rec-delete-confirm"));

    await waitFor(() => expect(api.deleteTranscription).toHaveBeenCalledWith("europe-entry", "session-token"));
    await waitFor(() => expect(screen.queryByTestId("rec-delete-dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("rec-history-card-europe-entry")).not.toBeInTheDocument();
  });

  it("项目录制旧屏仍可通过显式模式访问", () => {
    render(
      <RecApp
        identity={mockIdentity("org-yuanyang", "facilitator")}
        uiState="default"
        screen="prep"
        carrier="interview"
        view="facilitator"
        qs={{ mode: "project" }}
      />,
    );

    expect(screen.getByTestId("rec-prep")).toBeVisible();
    expect(screen.queryByTestId("rec-history-page")).not.toBeInTheDocument();
  });
});
