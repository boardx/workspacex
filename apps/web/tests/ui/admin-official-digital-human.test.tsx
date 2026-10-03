import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OfficialDigitalHumanPanel } from "@/components/admin/official-digital-human-panel";
import { AgentScreen } from "@/components/admin/agent-screen";

const mocks = vi.hoisted(() => ({ get: vi.fn(), enable: vi.fn(), upgrade: vi.fn(), refresh: vi.fn(), org: "org-a" }));
vi.mock("@/lib/agent-directory", async (original) => ({
  ...await original<typeof import("@/lib/agent-directory")>(),
  getOfficialRolePackOffer: mocks.get,
  enableOfficialRolePack: mocks.enable,
  upgradeOfficialRoleSelections: mocks.upgrade,
}));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: { currentOrgId: mocks.org, sessionToken: "token-a" }, identity: { orgRole: "admin" } }) }));
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
  mocks.upgrade.mockResolvedValue(undefined);
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
    expect(screen.getByText("官方数字人已启用。")).toBeInTheDocument();
    expect(screen.queryByText("所选官方数字人已升级。")).toBeNull();
    expect(mocks.enable).toHaveBeenCalledWith(offer, expect.any(Function), expect.objectContaining({ orgId: "org-a", sessionToken: "token-a", signal: expect.any(AbortSignal), isCurrent: expect.any(Function) }));
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
    expect(screen.queryByText("官方数字人已启用。")).toBeNull();
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
    expect(mocks.enable.mock.calls[0]![2].signal.aborted).toBe(true);
    expect(mocks.enable.mock.calls[0]![2].isCurrent()).toBe(false);
    finish();
    await waitFor(() => expect(screen.getByTestId("refresh-key")).toHaveTextContent("0"));
  });
});

const upgradeOffer = { ...offer, packVersion: "1.6.0", pending: [], upgrades: [
  {agentId:"pm",expectedPublishedVersionId:"pm-old",name:"产品经理",currentVersion:"1.5.0",targetVersion:"1.6.0",readySkillCount:2,pendingSkillCount:5},
  {agentId:"research",expectedPublishedVersionId:"r-old",name:"研究分析师",currentVersion:"1.5.0",targetVersion:"1.6.0",readySkillCount:0,pendingSkillCount:3},
]};
describe("官方角色显式选中升级",()=>{
 it("explains actual ready/pending changes and requires selection plus confirmation before upgrading only selected role",async()=>{
  mocks.get.mockResolvedValue(upgradeOffer);render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh}/>);
  const button=await screen.findByRole("button",{name:"升级所选官方数字人"});expect(button).toBeDisabled();
  expect(screen.getByText(/产品经理：1.5.0 → 1.6.0；可用技能 2，待验证技能 5/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox",{name:/产品经理/}));expect(button).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:/确认仅升级/}));
  mocks.get.mockResolvedValue({...upgradeOffer,upgrades:[]});fireEvent.click(button);
  await waitFor(()=>expect(mocks.refresh).toHaveBeenCalledTimes(1));
  expect(screen.getByText("所选官方数字人已升级。")).toBeInTheDocument();
  expect(screen.queryByText("官方数字人已启用。")).toBeNull();
  expect(mocks.upgrade).toHaveBeenCalledWith(upgradeOffer,[{agentId:"pm",expectedPublishedVersionId:"pm-old"}],expect.any(String),expect.objectContaining({orgId:"org-a",sessionToken:"token-a",isCurrent:expect.any(Function)}));
  expect(mocks.enable).not.toHaveBeenCalled();
 });
 it("retains idempotency identity on failed same-selection retry and does not announce successful upgrade",async()=>{
  mocks.get.mockResolvedValue(upgradeOffer);mocks.upgrade.mockRejectedValueOnce(new Error("conflict"));
  render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh}/>);
  fireEvent.click(await screen.findByRole("checkbox",{name:/产品经理/}));fireEvent.click(screen.getByRole("checkbox",{name:/确认仅升级/}));
  fireEvent.click(screen.getByRole("button",{name:"升级所选官方数字人"}));await screen.findByRole("alert");expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"升级所选官方数字人"}));await waitFor(()=>expect(mocks.upgrade).toHaveBeenCalledTimes(2));
  expect(mocks.upgrade.mock.calls[0]![2]).toBe(mocks.upgrade.mock.calls[1]![2]);
 });
 it("offers an explicit same-version verified-Skill refresh without implying a new role release",async()=>{
  const offer={...upgradeOffer,upgrades:[{agentId:"research",expectedPublishedVersionId:"research-v1.6",name:"研究与知识分析师",currentVersion:"1.6.0",targetVersion:"1.6.0",readySkillCount:1,pendingSkillCount:9}]};
  mocks.get.mockResolvedValue(offer);render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh}/>);
  const selection=await screen.findByRole("checkbox",{name:/研究与知识分析师：1.6.0（补齐已验证技能）/});
  expect(screen.queryByText(/1.6.0 → 1.6.0/)).toBeNull();
  const button=screen.getByRole("button",{name:"升级所选官方数字人"});expect(button).toBeDisabled();
  fireEvent.click(selection);fireEvent.click(screen.getByRole("checkbox",{name:/确认仅升级/}));fireEvent.click(button);
  await waitFor(()=>expect(mocks.upgrade).toHaveBeenCalledWith(offer,[{agentId:"research",expectedPublishedVersionId:"research-v1.6"}],expect.any(String),expect.objectContaining({orgId:"org-a"})));
 });
 it("members see pending state but cannot select or upgrade",async()=>{
  mocks.get.mockResolvedValue({...upgradeOffer,canEnable:false});render(<OfficialDigitalHumanPanel onEnabled={mocks.refresh}/>);
  await screen.findByText("请联系组织管理员升级。");expect(screen.getByRole("checkbox",{name:/产品经理/})).toBeDisabled();
  expect(screen.queryByRole("button",{name:"升级所选官方数字人"})).toBeNull();expect(mocks.upgrade).not.toHaveBeenCalled();
 });
});
