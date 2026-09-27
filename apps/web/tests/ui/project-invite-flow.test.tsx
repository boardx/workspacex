/**
 * 项目中枢 R2 —— 邀请流程的前端两端：
 *   · 设置 tab 的「邀请成员」面板：引导师签发 → 链接以令牌拼成 `/projects/join?t=`；非引导师视角没有面板；
 *     服务端 403 如实显示。
 *   · 落地页 `/projects/join?t=`：已登录 ⇒ 自动接受并进项目；未登录 ⇒ 跳登录并带 next；
 *     四种链接失效同一句话（契约 E1）。
 * 只 mock 网络边界（`@/lib/live-project-invite`）、路由与会话。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const issueProjectInviteLink = vi.fn();
const revokeProjectInviteLinks = vi.fn();
const acceptProjectInvite = vi.fn();
const replaceMock = vi.fn();
let sessionStatus: "loading" | "anonymous" | "authenticated" = "authenticated";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/join",
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
}));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ status: sessionStatus, session: sessionStatus === "authenticated" ? { userId: "u1", currentOrgId: "org-1" } : null }),
  useSession: () => ({ session: { userId: "u1", currentOrgId: "org-1" } }),
}));
vi.mock("@/lib/live-project-invite", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-invite")>()),
  issueProjectInviteLink: (...a: unknown[]) => issueProjectInviteLink(...a),
  revokeProjectInviteLinks: (...a: unknown[]) => revokeProjectInviteLinks(...a),
  acceptProjectInvite: (...a: unknown[]) => acceptProjectInvite(...a),
}));

import { TabSettings } from "@/components/project/tab-settings";
import { ProjectJoinScreen } from "@/components/project/project-join-screen";

describe("R2 设置 tab · 邀请成员面板", () => {
  beforeEach(() => { issueProjectInviteLink.mockReset(); revokeProjectInviteLinks.mockReset(); });

  it("引导师视角：签发后显示以令牌拼成的 /projects/join?t= 链接（不用服务端的原型 url）", async () => {
    issueProjectInviteLink.mockResolvedValue({ linkId: "l1", url: "https://workspacex.invalid/w/p1?r=member&t=TOK", token: "TOK", inviteCode: "KCK-8F21", qrPayload: null });
    render(<TabSettings view="facilitator" projectId="p1" />);
    fireEvent.click(screen.getByTestId("project-invite-issue"));
    const url = await screen.findByTestId("project-invite-link-url");
    expect((url as HTMLInputElement).value).toBe(`${window.location.origin}/projects/join?t=TOK`);
    expect(issueProjectInviteLink).toHaveBeenCalledWith({ projectId: "p1", kind: "main", groupId: null, identity: "member", validity: "7d" });
    expect(screen.getByTestId("project-invite-link-block")).toHaveTextContent("KCK-8F21");
  });

  it("组员 / 观察者视角没有邀请面板（只有引导师能签发）", () => {
    render(<TabSettings view="member" projectId="p1" />);
    expect(screen.queryByTestId("project-invite-panel")).toBeNull();
    render(<TabSettings view="observer" projectId="p1" />);
    expect(screen.queryByTestId("project-invite-panel")).toBeNull();
  });

  it("服务端 403 PROJECT_ROLE_INSUFFICIENT 如实显示，不显示假链接", async () => {
    issueProjectInviteLink.mockRejectedValue(new ApiError(403, "PROJECT_ROLE_INSUFFICIENT", {}));
    render(<TabSettings view="facilitator" projectId="p1" />);
    fireEvent.click(screen.getByTestId("project-invite-issue"));
    expect(await screen.findByTestId("project-invite-error")).toHaveTextContent("只有本项目的引导师");
    expect(screen.queryByTestId("project-invite-link-url")).toBeNull();
  });

  it("重置全部：调 revoke(linkId=null) 并显示条数", async () => {
    revokeProjectInviteLinks.mockResolvedValue({ revokedLinkIds: ["a", "b"], onsiteSessions: 0, survivesUntilStageId: null });
    render(<TabSettings view="facilitator" projectId="p1" />);
    fireEvent.click(screen.getByTestId("project-invite-revoke-all"));
    expect(await screen.findByTestId("project-invite-revoked")).toHaveTextContent("已重置 2 条");
    expect(revokeProjectInviteLinks).toHaveBeenCalledWith("p1", null);
  });
});

describe("R2 落地页 /projects/join", () => {
  beforeEach(() => { acceptProjectInvite.mockReset(); replaceMock.mockReset(); sessionStatus = "authenticated"; });
  afterEach(() => { sessionStatus = "authenticated"; });

  it("已登录：自动接受并进项目", async () => {
    acceptProjectInvite.mockResolvedValue({ projectId: "p-9", projectRole: "member", groupId: null, alreadyMember: false });
    render(<ProjectJoinScreen token="TOK" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p-9"));
    expect(acceptProjectInvite).toHaveBeenCalledWith("TOK");
    expect(screen.getByTestId("project-join-done")).toHaveTextContent("已加入项目");
  });

  it("已经是成员：幂等，照样进项目并说明", async () => {
    acceptProjectInvite.mockResolvedValue({ projectId: "p-9", projectRole: "member", groupId: null, alreadyMember: true });
    render(<ProjectJoinScreen token="TOK" />);
    expect(await screen.findByTestId("project-join-done")).toHaveTextContent("你已经在这个项目里了");
  });

  it("未登录：跳登录并把本页带在 next 里", async () => {
    sessionStatus = "anonymous";
    render(<ProjectJoinScreen token="TOK" />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/login?next=%2Fprojects%2Fjoin%3Ft%3DTOK"));
    expect(acceptProjectInvite).not.toHaveBeenCalled();
  });

  it.each(["INVITE_NOT_FOUND", "LINK_REVOKED", "LINK_EXPIRED", "LINK_ALREADY_USED"])(
    "链接失效 %s：对参与者渲染成同一句「找引导师重发」（不泄露项目是否存在）",
    async (code) => {
      acceptProjectInvite.mockRejectedValue(new ApiError(403, code, {}));
      render(<ProjectJoinScreen token="TOK" />);
      expect(await screen.findByTestId("project-join-error")).toHaveTextContent("请找引导师重新发一条");
      expect(replaceMock).not.toHaveBeenCalled();
    },
  );

  it("不是组织成员 / 已归档：各自说明", async () => {
    acceptProjectInvite.mockRejectedValue(new ApiError(403, "NO_ORG_MEMBERSHIP", {}));
    render(<ProjectJoinScreen token="TOK" />);
    expect(await screen.findByTestId("project-join-error")).toHaveTextContent("不是这个项目所属组织的成员");
  });

  it("没带令牌：直接说明，不请求", () => {
    render(<ProjectJoinScreen token={null} />);
    expect(screen.getByTestId("project-join-error")).toHaveTextContent("没有带邀请令牌");
    expect(acceptProjectInvite).not.toHaveBeenCalled();
  });
});
