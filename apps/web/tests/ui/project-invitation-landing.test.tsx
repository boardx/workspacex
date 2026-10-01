/**
 * #4788 通用项目邀请（前端）· 落地页 `/projects/join?invite=`：无效 / 直接加入（含切组织）/ 邮箱不符 /
 * 注册（邮箱邀请带会话进项目；链接邀请要先验证邮箱）/ 已有账号（LOGIN_REQUIRED）/ 弱密码 / 名额满，
 * 以及 page.tsx 对工作坊 `?t=` 的分流。只 mock 网络边界、路由与会话。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";

const previewInvitation = vi.fn();
const acceptInvitation = vi.fn();
const activateInvitation = vi.fn();
const switchCurrentOrganization = vi.fn();
const replaceMock = vi.fn();
const startSession = vi.fn();
const switchOrganization = vi.fn();
const logout = vi.fn();
let sessionState: { status: string; session: null | { sessionToken: string; userId: string; orgIds: string[]; currentOrgId: string; expiresAt: string } };

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/join",
  useRouter: () => ({ push: vi.fn(), replace: replaceMock }),
}));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ ...sessionState, startSession, switchOrganization, logout }),
  useSession: () => ({ ...sessionState, startSession, switchOrganization, logout }),
}));
vi.mock("@/lib/session-api", () => ({ switchCurrentOrganization: (...a: unknown[]) => switchCurrentOrganization(...a) }));
vi.mock("@/lib/live-project-invitations", async (orig) => ({
  ...(await orig<typeof import("@/lib/live-project-invitations")>()),
  previewInvitation: (...a: unknown[]) => previewInvitation(...a),
  acceptInvitation: (...a: unknown[]) => acceptInvitation(...a),
  activateInvitation: (...a: unknown[]) => activateInvitation(...a),
}));

import { ProjectInvitationLanding } from "@/components/project/project-invitation-landing";
import ProjectJoinPage from "@/app/projects/join/page";

const SESSION = { sessionToken: "tok", userId: "u1", orgIds: ["org-1"], currentOrgId: "org-1", expiresAt: "2099-01-01T00:00:00.000Z" };
function preview(over: Record<string, unknown>) {
  return { valid: true, kind: "email", projectName: "用户访谈", inviterName: "林可", invitedEmail: "new@x.com", nextStep: "register", ...over };
}
const ANON = { status: "anonymous", session: null };

describe("#4788 项目邀请落地页", () => {
  beforeEach(() => {
    [previewInvitation, acceptInvitation, activateInvitation, switchCurrentOrganization, replaceMock, startSession, switchOrganization, logout]
      .forEach((m) => m.mockReset());
    startSession.mockResolvedValue(undefined);
    switchOrganization.mockResolvedValue(undefined);
    switchCurrentOrganization.mockResolvedValue({});
    logout.mockResolvedValue(undefined);
    sessionState = ANON;
    window.localStorage.clear();
  });

  it("无效 / 过期 / 没带令牌：同一句话 + 回首页", async () => {
    previewInvitation.mockResolvedValue({ valid: false, kind: null, projectName: null, inviterName: null, invitedEmail: null, nextStep: null });
    render(<ProjectInvitationLanding token="BAD" />);
    expect(await screen.findByTestId("project-join-invalid")).toHaveTextContent("邀请链接无效或已失效");
    expect(screen.getByTestId("project-join-home")).toHaveAttribute("href", "/projects");
  });

  it("没有令牌直接无效，不调预览", async () => {
    render(<ProjectInvitationLanding token={null} />);
    expect(await screen.findByTestId("project-join-invalid")).toBeInTheDocument();
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it("accept：显示项目名与邀请人；点「加入项目」→ 接受 → 进项目（同组织不切换）", async () => {
    sessionState = { status: "authenticated", session: SESSION };
    previewInvitation.mockResolvedValue(preview({ nextStep: "accept", kind: "link", invitedEmail: null }));
    acceptInvitation.mockResolvedValue({ projectId: "p9", orgId: "org-1", joinedOrg: false, alreadyMember: false });
    render(<ProjectInvitationLanding token="T" />);
    expect(await screen.findByTestId("project-join-headline")).toHaveTextContent("林可");
    expect(screen.getByTestId("project-join-headline")).toHaveTextContent("用户访谈");
    fireEvent.click(screen.getByTestId("project-join-accept-button"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
    expect(acceptInvitation).toHaveBeenCalledWith("T");
    expect(switchOrganization).not.toHaveBeenCalled();
    expect(switchCurrentOrganization).not.toHaveBeenCalled();
  });

  it("accept：项目在另一个组织 ⇒ 先切组织再进项目（已属该组织走 switchOrganization；刚加入则重建本地会话）", async () => {
    sessionState = { status: "authenticated", session: { ...SESSION, orgIds: ["org-1", "org-2"] } };
    previewInvitation.mockResolvedValue(preview({ nextStep: "accept" }));
    acceptInvitation.mockResolvedValue({ projectId: "p9", orgId: "org-2", joinedOrg: false, alreadyMember: false });
    const first = render(<ProjectInvitationLanding token="T" />);
    fireEvent.click(await screen.findByTestId("project-join-accept-button"));
    await waitFor(() => expect(switchOrganization).toHaveBeenCalledWith("org-2"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
    first.unmount();

    replaceMock.mockReset(); switchOrganization.mockReset();
    sessionState = { status: "authenticated", session: SESSION };
    acceptInvitation.mockResolvedValue({ projectId: "p9", orgId: "org-3", joinedOrg: true, alreadyMember: false });
    render(<ProjectInvitationLanding token="T" />);
    fireEvent.click(await screen.findByTestId("project-join-accept-button"));
    await waitFor(() => expect(startSession).toHaveBeenCalled());
    expect(switchCurrentOrganization).toHaveBeenCalledWith("org-3", "tok");
    expect(startSession.mock.calls[0]?.[0]).toMatchObject({ orgs: ["org-3", "org-1"], sessionToken: "tok" });
    expect(switchOrganization).not.toHaveBeenCalled();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
  });

  it("already_member：给进入项目入口", async () => {
    sessionState = { status: "authenticated", session: SESSION };
    previewInvitation.mockResolvedValue(preview({ nextStep: "already_member" }));
    acceptInvitation.mockResolvedValue({ projectId: "p9", orgId: "org-1", joinedOrg: false, alreadyMember: true });
    render(<ProjectInvitationLanding token="T" />);
    fireEvent.click(await screen.findByTestId("project-join-open"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
  });

  it("already_member：跨组织进入必须等待组织切换成功，失败不跳转且可重试", async () => {
    sessionState = { status: "authenticated", session: { ...SESSION, orgIds: ["org-1", "org-2"] } };
    previewInvitation.mockResolvedValue(preview({ nextStep: "already_member" }));
    acceptInvitation.mockResolvedValue({ projectId: "p9", orgId: "org-2", joinedOrg: false, alreadyMember: true });
    switchOrganization.mockRejectedValueOnce(new Error("offline"));
    render(<ProjectInvitationLanding token="T" />);
    fireEvent.click(await screen.findByTestId("project-join-open"));
    await screen.findByTestId("project-join-error");
    expect(switchOrganization).toHaveBeenCalledWith("org-2");
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-join-open")).not.toBeDisabled();
    fireEvent.click(screen.getByTestId("project-join-open"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
    expect(switchOrganization).toHaveBeenCalledTimes(2);
  });

  it("email_mismatch：说明受邀邮箱，可退出切换账号（回到带 next 的登录页）", async () => {
    sessionState = { status: "authenticated", session: SESSION };
    previewInvitation.mockResolvedValue(preview({ nextStep: "email_mismatch", invitedEmail: "other@x.com" }));
    render(<ProjectInvitationLanding token="T" />);
    expect(await screen.findByTestId("project-join-mismatch-email")).toHaveTextContent("other@x.com");
    fireEvent.click(screen.getByTestId("project-join-switch-account"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/projects/join?invite=T")}`));
    expect(logout).toHaveBeenCalled();
  });

  it("login：只给登录，next 带回本页", async () => {
    previewInvitation.mockResolvedValue(preview({ nextStep: "login" }));
    render(<ProjectInvitationLanding token="T" />);
    const a = await screen.findByTestId("project-join-login");
    expect(a).toHaveAttribute("href", `/login?next=${encodeURIComponent("/projects/join?invite=T")}`);
    expect(screen.queryByTestId("project-join-register-open")).toBeNull();
  });

  it("register（邮箱邀请）：邮箱预填只读；成功拿到会话 ⇒ 启动会话并进项目", async () => {
    previewInvitation.mockResolvedValue(preview({ nextStep: "register" }));
    activateInvitation.mockResolvedValue({
      userId: "u2", orgId: "org-1", projectId: "p9", verificationRequired: false, sessionId: "s1",
      session: { sessionToken: "t2", userId: "u2", orgs: ["org-1"], expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    render(<ProjectInvitationLanding token="T" />);
    const email = (await screen.findByTestId("project-join-email")) as HTMLInputElement;
    expect(email.value).toBe("new@x.com");
    expect(email.readOnly).toBe(true);
    fireEvent.change(screen.getByTestId("project-join-name"), { target: { value: "新同学" } });
    fireEvent.change(screen.getByTestId("project-join-pwd"), { target: { value: "Str0ng-pass-phrase" } });
    fireEvent.click(screen.getByTestId("project-join-register-submit"));
    await waitFor(() => expect(startSession).toHaveBeenCalled());
    expect(activateInvitation).toHaveBeenCalledWith({ token: "T", name: "新同学", password: "Str0ng-pass-phrase" });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/projects/p9"));
  });

  it("login_or_register（链接邀请）：先点「没有账号？注册」；邮箱可填；verificationRequired ⇒ 说明已发验证邮件且不启动会话", async () => {
    previewInvitation.mockResolvedValue(preview({ nextStep: "login_or_register", kind: "link", invitedEmail: null }));
    activateInvitation.mockResolvedValue({ userId: "u2", orgId: "org-1", projectId: "p9", verificationRequired: true, sessionId: null, session: null });
    render(<ProjectInvitationLanding token="T" />);
    expect(await screen.findByTestId("project-join-login")).toBeInTheDocument();
    expect(screen.queryByTestId("project-join-register-form")).toBeNull();
    fireEvent.click(screen.getByTestId("project-join-register-open"));
    const email = screen.getByTestId("project-join-email") as HTMLInputElement;
    expect(email.readOnly).toBe(false);
    expect(screen.getByTestId("project-join-register-submit")).toBeDisabled();
    fireEvent.change(email, { target: { value: "me@x.com" } });
    fireEvent.change(screen.getByTestId("project-join-name"), { target: { value: "我" } });
    fireEvent.change(screen.getByTestId("project-join-pwd"), { target: { value: "Str0ng-pass-phrase" } });
    fireEvent.click(screen.getByTestId("project-join-register-submit"));
    expect(await screen.findByTestId("project-join-verify")).toHaveTextContent("me@x.com");
    expect(activateInvitation).toHaveBeenCalledWith({ token: "T", name: "我", password: "Str0ng-pass-phrase", email: "me@x.com" });
    expect(startSession).not.toHaveBeenCalled();
    expect(screen.getByTestId("project-join-verify-login")).toHaveAttribute("href", "/login");
  });

  async function fillAndSubmit() {
    previewInvitation.mockResolvedValue(preview({ nextStep: "register" }));
    render(<ProjectInvitationLanding token="T" />);
    fireEvent.change(await screen.findByTestId("project-join-name"), { target: { value: "新同学" } });
    fireEvent.change(screen.getByTestId("project-join-pwd"), { target: { value: "weak" } });
    fireEvent.click(screen.getByTestId("project-join-register-submit"));
  }

  it("LOGIN_REQUIRED：已有账号 ⇒ 说明并引导去登录", async () => {
    activateInvitation.mockRejectedValue(new ApiError(409, "LOGIN_REQUIRED", { reasonCode: "LOGIN_REQUIRED" }));
    await fillAndSubmit();
    expect(await screen.findByTestId("project-join-register-error")).toHaveTextContent("已经注册过了");
    fireEvent.click(screen.getByTestId("project-join-goto-login"));
    expect(replaceMock).toHaveBeenCalledWith(`/login?next=${encodeURIComponent("/projects/join?invite=T")}`);
  });

  it("弱密码：字段级报错在密码框下，不当成邀请失效", async () => {
    activateInvitation.mockRejectedValue(new ApiError(400, null, { error: "validation_failed", fields: [{ path: "profile.password", code: "too_weak" }] }));
    await fillAndSubmit();
    expect(await screen.findByTestId("project-join-pwd-error")).toHaveTextContent("密码不符合要求");
    expect(screen.queryByTestId("project-join-invalid")).toBeNull();
  });

  it("SEAT_QUOTA_EXHAUSTED：显示契约人话；INVITATION_INVALID：整页切到无效态", async () => {
    activateInvitation.mockRejectedValueOnce(new ApiError(409, "SEAT_QUOTA_EXHAUSTED", { reasonCode: "SEAT_QUOTA_EXHAUSTED" }));
    await fillAndSubmit();
    expect(await screen.findByTestId("project-join-register-error")).toHaveTextContent("成员席位已满");
    activateInvitation.mockRejectedValueOnce(new ApiError(404, "INVITATION_INVALID", { reasonCode: "INVITATION_INVALID" }));
    fireEvent.click(screen.getByTestId("project-join-register-submit"));
    expect(await screen.findByTestId("project-join-invalid")).toBeInTheDocument();
  });

  it("预览失败（服务不可用）给重试，不说成邀请无效", async () => {
    previewInvitation.mockRejectedValue(new ApiError(503, "AUTH_SERVICE_UNAVAILABLE", { reasonCode: "AUTH_SERVICE_UNAVAILABLE" }));
    render(<ProjectInvitationLanding token="T" />);
    expect(await screen.findByTestId("project-join-unavailable")).toHaveTextContent("暂时不可用");
  });

  it("page：带 invite ⇒ 通用邀请落地页；只带 t ⇒ 工作坊落地页（原行为）", () => {
    previewInvitation.mockReturnValue(new Promise(() => undefined));
    const a = render(ProjectJoinPage({ searchParams: { invite: "X" } }) as React.ReactElement);
    expect(a.container.querySelector('[data-testid="project-join-invitation"]')).not.toBeNull();
    a.unmount();
    const b = render(ProjectJoinPage({ searchParams: { t: "W" } }) as React.ReactElement);
    expect(b.container.querySelector('[data-testid="project-join-invitation"]')).toBeNull();
    expect(b.container.querySelector('[data-testid="project-join"]')).not.toBeNull();
  });
});
