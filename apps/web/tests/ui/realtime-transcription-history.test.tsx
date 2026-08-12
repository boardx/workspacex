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
  openAsr: vi.fn(),
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { sessionToken: "session-token", currentOrgId: "org-yuanyang" } }),
}));

vi.mock("@/lib/live-personal-transcriptions", () => ({
  createPersonalTranscription: api.create,
  listPersonalTranscriptions: api.list,
  readPersonalTranscription: api.read,
}));

vi.mock("@/lib/BoardxRealtimeAsrClient", () => ({
  openBoardxRealtimeAsr: api.openAsr,
}));

const EUROPE = {
  sessionId: "europe-entry",
  name: "欧洲市场进入讨论",
  tags: ["客户", "市场研究"],
  status: "completed",
  durationMs: 3_492_000,
  createdAt: "2026-08-11T06:30:00.000Z",
  updatedAt: "2026-08-11T07:28:12.000Z",
} as const;

beforeEach(() => {
  api.create.mockReset();
  api.list.mockReset();
  api.read.mockReset();
  api.openAsr.mockReset();
  api.openAsr.mockResolvedValue({ captureId: "capture-live", stop: vi.fn().mockResolvedValue(undefined) });
  api.list.mockResolvedValue({ items: [EUROPE], nextCursor: null });
  api.read.mockResolvedValue({
    ...EUROPE,
    captures: [{
      captureId: "capture-1",
      status: "completed",
      startedAt: "2026-08-11T06:30:00.000Z",
      endedAt: "2026-08-11T07:28:12.000Z",
      durationMs: 3_492_000,
      segments: [{
        segmentId: "segment-1",
        captureId: "capture-1",
        ordinal: 1,
        text: "这是数据库中保存的真实逐字稿。",
        startMs: 4_000,
        endMs: 8_000,
        createdAt: "2026-08-11T06:30:08.000Z",
      }],
    }],
  });
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
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("已完成");
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
