import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HomeView } from "@/components/home/home-screen";
import { homeThemeStyle } from "@/lib/home-theme";
import { orgHomeFixture } from "@/tests/fixtures/org-home-redesign";

vi.mock("next/navigation", () => ({ useRouter: () => ({push: vi.fn()}) }));
vi.mock("@/components/session/session-provider", () => ({useOptionalSession: () => null, useSession: () => ({})}));
vi.mock("@/components/shell/org-menu", () => ({useOrgAvatarUrl: () => null}));
vi.mock("@/lib/use-authed-image-src", () => ({useAuthedImageSrc: () => ({src:null})}));
vi.mock("@/components/home/use-home-work", () => ({
  useHomeWork: () => ({projects:{status:"ready",items:[]}}), useHomeTasks: () => ({status:"ready",items:null}),
}));
afterEach(cleanup);
describe("前台人物展示读取既有配置", () => {
  it("展示配置里的角色、用途、头像及编码后的对话入口，不修改输入配置", () => {
    const config = structuredClone(orgHomeFixture);
    const first = config.recommendedAgents[0];
    if (first === undefined) throw new Error("The presentation fixture must include an agent");
    first.agentId = "a/1";
    const before = JSON.stringify(config);
    render(<HomeView config={config} orgId={null} displayName={null}/>);
    const link = screen.getByRole("link",{name:"与林知远开始对话 · 战略顾问"});
    expect(link.getAttribute("href")).toBe("/chat?agent=a%2F1");
    expect(link.textContent).toContain(first.note);
    expect(link.querySelector('[data-avatar-key="person-1"]')).not.toBeNull();
    expect(link.textContent).not.toMatch(/在线|真人/);
    expect(JSON.stringify(config)).toBe(before);
  });
  it("收到新配置时更新人物信息与入口，不保留过期角色或介绍", () => {
    const view = render(<HomeView config={orgHomeFixture} orgId={null} displayName={null}/>);
    const updated = {...orgHomeFixture,recommendedAgents:[{...orgHomeFixture.recommendedAgents[0],agentId:"new/agent",name:"新伙伴",roleLabel:"研究顾问",note:"根据已配置资料帮助梳理研究问题",avatarKey:"person-2"}]};
    view.rerender(<HomeView config={updated} orgId={null} displayName={null}/>);
    const link = screen.getByRole("link",{name:"与新伙伴开始对话 · 研究顾问"});
    expect(link.getAttribute("href")).toBe("/chat?agent=new%2Fagent");
    expect(link.textContent).toContain("根据已配置资料帮助梳理研究问题");
    expect(screen.queryByTestId("home-agent-fixture-strategy")).toBeNull();
  });
  it("组织未推荐数字人时不编造人物列表", () => {
    render(<HomeView config={{...orgHomeFixture,recommendedAgents:[]}} orgId={null} displayName={null}/>);
    expect(screen.queryByTestId("home-agents")).toBeNull();
  });
  it("应用既有主题配置，品牌色与键盘焦点色来自同一主题", () => {
    const colors = {...orgHomeFixture.themeColors!,primary:"#135B78"};
    render(<HomeView config={{...orgHomeFixture,themeColors:colors}} orgId={null} displayName={null}/>);
    const style = screen.getByTestId("home-screen").style;
    const expected = homeThemeStyle(colors) as Record<string,string>;
    expect(style.getPropertyValue("--primary")).toBe(expected["--primary"]);
    expect(style.getPropertyValue("--ring")).toBe(expected["--ring"]);
  });
});
