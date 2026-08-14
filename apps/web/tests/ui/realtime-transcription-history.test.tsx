import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RecApp } from "@/components/rec/rec-app";
import { mockIdentity } from "@/lib/identity";

vi.mock("next/navigation", () => ({
  usePathname: () => "/rec",
  useRouter: () => ({ replace: vi.fn() }),
}));

const api = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  listTags: vi.fn(),
  updateMetadata: vi.fn(),
  deleteTranscription: vi.fn(),
  openAsr: vi.fn(),
  handlers: null as null | {
    onFinal: (event: { captureId: string; segmentId: string; ordinal: number; text: string; startMs: number; endMs: number }) => void;
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
}));

vi.mock("@/lib/BoardxRealtimeAsrClient", () => ({
  openBoardxRealtimeAsr: api.openAsr,
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
  api.openAsr.mockReset();
  api.handlers = null;
  api.openAsr.mockImplementation(async (_sessionId: string, options: { handlers: typeof api.handlers }) => {
    api.handlers = options.handlers;
    return { captureId: "capture-live", stop: vi.fn().mockResolvedValue(undefined) };
  });
  api.list.mockResolvedValue({ items: [EUROPE], nextCursor: null });
  api.listTags.mockResolvedValue({ tags: ["客户", "市场研究"] });
  api.read.mockResolvedValue({
    ...EUROPE,
    content: "这是数据库中保存的真实逐字稿。",
  });
  api.update.mockImplementation(async (_sessionId: string, content: string) => ({ ...EUROPE, content }));
  api.updateMetadata.mockImplementation(async (_sessionId: string, input: { name: string; tags: string[] }) => ({
    ...EUROPE, name: input.name, tags: input.tags,
  }));
  api.deleteTranscription.mockResolvedValue({ deleted: true });
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
    expect(screen.getAllByTestId(/^rec-history-card-/)).toHaveLength(1);

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

  it("详情页开始按钮可用并启动该用户转录的 BoardX 实时客户端", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    const button = await screen.findByTestId("rec-live-toggle");
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(api.openAsr).toHaveBeenCalledWith(
      "europe-entry",
      expect.objectContaining({ sessionToken: "session-token" }),
    ));
  });

  it("相同最终事件只追加一次正文", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    fireEvent.click(await screen.findByTestId("rec-live-toggle"));
    await waitFor(() => expect(api.handlers).not.toBeNull());
    const event = { captureId: "capture-live", segmentId: "final-1", ordinal: 1,
      text: "重复事件也只显示一次。", startMs: 0, endMs: 1_000 };
    api.handlers!.onFinal(event);
    api.handlers!.onFinal(event);
    await waitFor(() => expect(screen.getByTestId("rec-live-content")).toHaveTextContent(
      "这是数据库中保存的真实逐字稿。 重复事件也只显示一次。",
    ));
    expect(screen.getByTestId("rec-live-content")).not.toHaveTextContent("重复事件也只显示一次。 重复事件也只显示一次。");
  });

  it("编辑完整正文后调用 owner-only 内容更新 API", async () => {
    renderHistory();
    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));
    fireEvent.click(await screen.findByTestId("rec-live-edit"));
    fireEvent.change(screen.getByTestId("rec-live-editor"), { target: { value: "修改后的全文" } });
    fireEvent.click(screen.getByTestId("rec-live-save"));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("europe-entry", "修改后的全文", "session-token"));
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
