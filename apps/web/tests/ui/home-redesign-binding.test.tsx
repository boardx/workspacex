import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { homeConfig } from "@repo/contracts";
import { HomeView } from "@/components/home/home-screen";
import { RecommendedAgentsSection } from "@/components/org-admin/home-config-recommend-sections";
import { formToPreviewConfig, toFormState, toUpdateInput } from "@/components/org-admin/home-config-form-model";
import type { HomeConfig } from "@/lib/live-home-config";

vi.mock("next/navigation", () => ({ useRouter: () => ({push: vi.fn()}) }));
vi.mock("@/components/session/session-provider", () => ({useOptionalSession: () => null, useSession: () => ({})}));
vi.mock("@/components/shell/org-menu", () => ({useOrgAvatarUrl: () => null}));
vi.mock("@/lib/use-authed-image-src", () => ({useAuthedImageSrc: () => ({src:null})}));
vi.mock("@/components/home/use-home-work", () => ({
  useHomeWork: () => ({projects:{status:"ready",items:[]}}), useHomeTasks: () => ({status:"ready",items:null}),
}));
const config: HomeConfig = {orgId:"test", title:"测试组织", tagline:null, bannerHeadline:"一起协作",bannerTagline:"",themeColors:homeConfig.DEFAULT_HOME_THEME,bannerPreset:"slate",bannerColor:null,bannerImageUrl:null,quickActions:[],recommendedCapabilities:[],recommendedAgents:[{agentId:"a/1",name:"林顾问",roleLabel:"战略顾问",avatarKey:"person-1",note:"制定战略"}],sections:{recentWork:false,currentTasks:false},updatedAt:"2026-10-14",updatedBy:null};
afterEach(cleanup);
describe("首页人物呈现与后台配置绑定", () => {
  it("后台介绍修改同步到 HomeView 与提交体，头像角色和编码后的互动深链保持一致", () => {
    function Harness() {
      const [form,setForm] = React.useState(() => toFormState(config));
      return <><RecommendedAgentsSection form={form} onChange={setForm}/><HomeView config={formToPreviewConfig(form,"test")} orgId={null} displayName={null}/><output data-testid="payload">{JSON.stringify(toUpdateInput(form))}</output></>;
    }
    render(<Harness/>);
    fireEvent.change(screen.getByLabelText("林顾问的一句话介绍"),{target:{value:"从证据找到下一步行动"}});
    const link = screen.getByRole("link",{name:"与林顾问开始对话 · 战略顾问"});
    expect(link.getAttribute("href")).toBe("/chat?agent=a%2F1");
    expect(link.textContent).toContain("从证据找到下一步行动");
    expect(link.querySelector('[data-avatar-key="person-1"]')).not.toBeNull();
    expect(JSON.parse(screen.getByTestId("payload").textContent ?? "{}").recommendedAgents[0].note).toBe("从证据找到下一步行动");
    expect(link.textContent).not.toMatch(/在线|真人/);
  });
  it("移除后台推荐立即移除同一预览中的互动入口", () => {
    function Harness() { const [form,setForm] = React.useState(() => toFormState(config));return <><RecommendedAgentsSection form={form} onChange={setForm}/><HomeView config={formToPreviewConfig(form,"test")} orgId={null} displayName={null}/></>; }
    render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"移除 林顾问"}));
    expect(screen.queryByTestId("home-agents")).toBeNull();
  });
});
