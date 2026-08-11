import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RecApp } from "@/components/rec/rec-app";
import { mockIdentity } from "@/lib/identity";

vi.mock("next/navigation", () => ({
  usePathname: () => "/rec",
  useRouter: () => ({ replace: vi.fn() }),
}));

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
  it("用历史卡片替代旧演示页，并能打开包含名称与标签的创建弹窗", () => {
    renderHistory();

    expect(screen.getByTestId("rec-history-page")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^rec-history-card-/)).toHaveLength(11);

    fireEvent.click(screen.getByTestId("rec-create-open"));

    expect(screen.getByTestId("rec-create-dialog")).toBeVisible();
    expect(screen.getByTestId("rec-create-name")).toHaveValue("");
    expect(screen.getByTestId("rec-create-name-count")).toHaveTextContent("0/100");
    expect(screen.getByTestId("rec-create-tag-count")).toHaveTextContent("0/5");
    expect(screen.getByTestId("rec-create-submit")).toBeDisabled();
  });

  it("提交新建转录后立即进入该场实时转录工作台，而不是停留在历史卡片页", () => {
    renderHistory();

    fireEvent.click(screen.getByTestId("rec-create-open"));
    fireEvent.change(screen.getByTestId("rec-create-name"), { target: { value: "江西九江" } });
    fireEvent.click(screen.getByTestId("rec-create-submit"));

    expect(screen.getByTestId("rec-live-workspace")).toBeVisible();
    expect(screen.getByTestId("rec-live-title")).toHaveTextContent("江西九江");
    expect(screen.queryByTestId("rec-history-page")).not.toBeInTheDocument();
  });

  it("点击历史卡片的打开按钮进入对应转录详情，而不是停留在无响应按钮", () => {
    renderHistory();

    fireEvent.click(screen.getByTestId("rec-history-open-europe-entry"));

    expect(screen.getByTestId("rec-live-workspace")).toBeVisible();
    expect(screen.getByTestId("rec-live-title")).toHaveTextContent("欧洲市场进入讨论");
    expect(screen.getByTestId("rec-live-status")).toHaveTextContent("已完成");
  });
});
