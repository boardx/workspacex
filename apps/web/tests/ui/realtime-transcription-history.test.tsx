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
}));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { sessionToken: "session-token", currentOrgId: "org-yuanyang" } }),
}));

vi.mock("@/lib/live-personal-transcriptions", () => ({
  createPersonalTranscription: api.create,
  listPersonalTranscriptions: api.list,
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
  api.list.mockResolvedValue({ items: [EUROPE], nextCursor: null });
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
    expect(screen.queryByTestId("rec-history-page")).not.toBeInTheDocument();
  });

  it("点击 API 返回的历史卡片进入对应转录详情", async () => {
    renderHistory();

    fireEvent.click(await screen.findByTestId("rec-history-open-europe-entry"));

    expect(screen.getByTestId("rec-live-workspace")).toBeVisible();
    expect(screen.getByTestId("rec-live-title")).toHaveTextContent("欧洲市场进入讨论");
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("已完成");
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
});
