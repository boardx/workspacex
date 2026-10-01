import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfficialDigitalHumanPanel } from "@/components/admin/official-digital-human-panel";
import { AgentScreen } from "@/components/admin/agent-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), enable: vi.fn(), refresh: vi.fn(), org: "org-a" }));
vi.mock("@/lib/agent-directory", async (original) => ({
  ...await original<typeof import("@/lib/agent-directory")>(),
  getOfficialRolePackOffer: mocks.get,
  enableOfficialRolePack: mocks.enable,
}));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: { currentOrgId: mocks.org }, identity: { orgRole: "admin" } }) }));
vi.mock("@/components/admin/capability-catalog-screen", () => ({
  CapabilityCatalogScreen: ({ headerActions, definitionsRefreshKey }: { headerActions: React.ReactNode; definitionsRefreshKey: number }) => <div>{headerActions}<span data-testid="refresh-key">{definitionsRefreshKey}</span></div>,
}));
const offer = {
  packId: "official-role-pack", packVersion: "1.0.0", canEnable: true,
  requiredSkillPacks: [{ packId: "work-product", packVersion: "1.0.0" }],
  pending: [{ roleRef: "D003", name: "Product Manager", roleLabel: "Product", avatar: { key: "dh-03-product-manager" }, roleCategory: "product", tags: [], workflowAllowlist: ["W029"] }],
};

beforeEach(() => {
  mocks.org = "org-a";
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(offer);
  mocks.enable.mockResolvedValue(undefined);
});

describe("后台官方数字人发现与启用", () => {
  it("显式打开才读取；启用传完整依赖要约并刷新后台目录", async () => {
    render(<AgentScreen state="default" />);
    expect(mocks.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "官方数字人" }));
    expect(await screen.findByText("产品经理")).toBeInTheDocument();
    expect(mocks.enable).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({ ...offer, pending: [] });
    fireEvent.click(screen.getByRole("button", { name: "启用官方数字人" }));
    await screen.findByText("本组织已启用全部官方数字人。");
    expect(mocks.enable).toHaveBeenCalledWith(offer, expect.any(Function));
    expect(screen.getByTestId("refresh-key")).toHaveTextContent("1");
  });

  it("服务端拒绝启用时只提示管理员，不展示导入按钮", async () => {
    mocks.get.mockResolvedValue({ ...offer, canEnable: false });
    render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh} />);
    await screen.findByText("请联系组织管理员启用。");
    expect(screen.queryByRole("button", { name: "启用官方数字人" })).toBeNull();
    expect(mocks.enable).not.toHaveBeenCalled();
  });

  it("部分导入失败允许重试，失败不会宣称成功或刷新目录", async () => {
    mocks.enable.mockRejectedValueOnce(new Error("import failed"));
    render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "启用官方数字人" }));
    await screen.findByRole("alert");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("官方数字人已启用，目录已刷新。")).toBeNull();
    mocks.get.mockResolvedValue({ ...offer, pending: [] });
    fireEvent.click(screen.getByRole("button", { name: "启用官方数字人" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(mocks.enable).toHaveBeenCalledTimes(2);
  });

  it("读取失败显示重新加载，不能伪装成已启用", async () => {
    mocks.get.mockRejectedValueOnce(new Error("unavailable"));
    render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "重新加载" }));
    await screen.findByText("产品经理");
    expect(mocks.enable).not.toHaveBeenCalled();
  });

  it("切换组织立即关闭旧要约，旧导入完成不刷新新组织", async () => {
    let finish!: () => void;
    mocks.enable.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<AgentScreen state="default" />);
    fireEvent.click(screen.getByRole("button", { name: "官方数字人" }));
    fireEvent.click(await screen.findByRole("button", { name: "启用官方数字人" }));
    mocks.org = "org-b";
    view.rerender(<AgentScreen state="default" />);
    expect(screen.queryByText("产品经理")).toBeNull();
    finish();
    await waitFor(() => expect(screen.getByTestId("refresh-key")).toHaveTextContent("0"));
  });
});
