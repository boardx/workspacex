/**
 * F11 —— 「成员与配额」屏上「名册 + 待处理邀请」区块的真栈实现
 * （`MemberInvitesPanel`，替掉此前贴着「演示数据」标记的 `lib/mock/org-admin.ORG_MEMBERS`）。
 *
 * 反证重点（每条都对应一次真实的骗人模式）：
 *  ① 名册/活跃数来自 `listOrgMembers` 的真实响应，不是写死的 48/41；
 *  ② 待处理邀请（pending/awaiting-review/send-failed）来自 `listOrgInvites`，
 *     已用/已撤销的邀请不出现在这块摘要里；
 *  ③ 只有 pending/send-failed 有 [重发]，且真的发 `POST …/invites/:id/resend`；
 *  ④ 非组织 admin（`listOrgInvites` 403）时不伪造邀请列表，说清「仅管理员可见」；
 *  ⑤ [邀请成员] 打开的是真实 `InviteMemberForm`（邮箱 + 组织角色），不是本地假弹层。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-f11" }));

vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: sessionState.currentOrgId } }),
}));

import { MemberInvitesPanel } from "@/components/admin/member-invites-panel";

interface Invite {
  inviteId: string; email: string; status: string; invitedBy: string;
  invitedByUserId: string; expiresAt: string;
}

function invite(overrides: Partial<Invite> = {}): Invite {
  return {
    inviteId: "inv-1", email: "chenmo@x.test", status: "pending",
    invitedBy: "管理员 高琳", invitedByUserId: "u-admin", expiresAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u-linke", displayName: "林可", email: "linke@x.test", orgRole: "consultant",
    teamId: null, joinedAt: "2026-01-01", status: "active", ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn();

function routed(opts: { members?: unknown[]; invites?: Invite[] | { status: number }; resend?: () => Response } = {}) {
  const members = opts.members ?? [member()];
  return (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (method === "GET" && u.includes("/members")) return Promise.resolve(jsonResponse({ members }));
    if (method === "GET" && u.includes("/invites")) {
      if (opts.invites && !Array.isArray(opts.invites)) return Promise.resolve(jsonResponse({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" }, opts.invites.status));
      return Promise.resolve(jsonResponse({ invites: opts.invites ?? [] }));
    }
    if (method === "POST" && /\/invites\/[^/]+\/resend$/.test(u)) {
      return Promise.resolve(opts.resend?.() ?? jsonResponse({ newTokenIssued: true, cooldownSec: 60, activationToken: "tok-resent" }));
    }
    if (method === "POST" && u.endsWith("/invites")) {
      return Promise.resolve(jsonResponse({ status: "issued", quotaReserved: 1, activationToken: "tok-new" }));
    }
    return Promise.resolve(jsonResponse({}, 404));
  };
}

beforeEach(() => {
  sessionState.currentOrgId = "org-f11";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MemberInvitesPanel —— 名册 + 待处理邀请（真栈）", () => {
  it("① 名册/活跃数来自 listOrgMembers 的真实响应", async () => {
    fetchMock.mockImplementation(routed({
      members: [member({ userId: "u-a", status: "active" }), member({ userId: "u-b", status: "active" }), member({ userId: "u-c", status: "suspended" })],
    }));
    render(<MemberInvitesPanel />);

    const counts = await screen.findByTestId("admin-members-roster-count");
    expect(counts).toHaveTextContent("成员 3 人");
    expect(counts).toHaveTextContent("活跃 2 人");
  });

  it("② 只有未终结的邀请（pending/awaiting-review/send-failed）出现，已用/已撤销不出现", async () => {
    fetchMock.mockImplementation(routed({
      invites: [
        invite({ inviteId: "inv-p", status: "pending", email: "chenmo@x.test" }),
        invite({ inviteId: "inv-ar", status: "awaiting-review", email: "yeqing@x.test" }),
        invite({ inviteId: "inv-sf", status: "send-failed", email: "zhenghao@x.test" }),
        invite({ inviteId: "inv-used", status: "used", email: "used@x.test" }),
        invite({ inviteId: "inv-revoked", status: "revoked", email: "revoked@x.test" }),
      ],
    }));
    render(<MemberInvitesPanel />);

    const list = await screen.findByTestId("admin-members-list");
    expect(within(list).getByTestId("admin-member-pending-inv-p")).toHaveTextContent("chenmo@x.test");
    expect(within(list).getByTestId("admin-member-pending-inv-ar")).toHaveTextContent("待复核");
    expect(within(list).getByTestId("admin-member-pending-inv-sf")).toHaveTextContent("发送失败");
    expect(within(list).queryByTestId("admin-member-pending-inv-used")).toBeNull();
    expect(within(list).queryByTestId("admin-member-pending-inv-revoked")).toBeNull();
    expect(within(list).getByTestId("admin-members-roster-count")).toHaveTextContent("待处理邀请 3 条");
  });

  it("③ 只有 pending/send-failed 有 [重发]，点击真的发 POST …/resend", async () => {
    fetchMock.mockImplementation(routed({
      invites: [
        invite({ inviteId: "inv-p", status: "pending" }),
        invite({ inviteId: "inv-ar", status: "awaiting-review" }),
      ],
    }));
    render(<MemberInvitesPanel />);

    await screen.findByTestId("admin-member-pending-inv-p");
    expect(screen.getByTestId("admin-member-resend-inv-p")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-member-resend-inv-ar")).toBeNull();

    fireEvent.click(screen.getByTestId("admin-member-resend-inv-p"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => /\/invites\/inv-p\/resend$/.test(String(c[0])) && c[1]?.method === "POST");
      expect(call).toBeDefined();
    });
    expect(await screen.findByTestId("org-admin-invite-link-block")).toBeTruthy();
  });

  it("④ 非组织 admin（listOrgInvites 403）：不伪造邀请列表，说清仅管理员可见", async () => {
    fetchMock.mockImplementation(routed({ invites: { status: 403 } }));
    render(<MemberInvitesPanel />);

    await waitFor(() => expect(screen.getByTestId("admin-members-invites-denied")).toBeTruthy());
    expect(screen.queryByTestId("admin-members-list")).not.toBeNull();
    expect(screen.queryByTestId(/admin-member-pending-/)).toBeNull();
  });

  it("⑤ [邀请成员] 打开的是真实 InviteMemberForm（邮箱 + 组织角色），不是本地假弹层", async () => {
    fetchMock.mockImplementation(routed());
    render(<MemberInvitesPanel />);

    await screen.findByTestId("admin-members-roster-count");
    fireEvent.click(screen.getByTestId("admin-members-invite-open"));

    const dialog = await screen.findByTestId("admin-members-invite-dialog");
    expect(within(dialog).getByTestId("org-admin-invite-form")).toBeInTheDocument();
    expect(within(dialog).getByTestId("org-admin-invite-email")).toBeInTheDocument();
    expect(within(dialog).getByTestId("org-admin-invite-role")).toBeInTheDocument();
  });
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(r => { resolve = r; });
  return { promise, resolve };
}

it("组织切换立即隐藏旧邀请、关闭弹窗并清除激活链接", async () => {
  const pending = deferredResponse();
  fetchMock.mockImplementation(routed({ invites: [invite()] }));
  const view = render(<MemberInvitesPanel />);
  await screen.findByText("chenmo@x.test");
  fireEvent.click(screen.getByTestId("admin-member-resend-inv-1"));
  await screen.findByText(/新的激活链接/);
  fireEvent.click(screen.getByTestId("admin-members-invite-open"));
  expect(screen.getByTestId("admin-members-invite-dialog")).toBeInTheDocument();
  fetchMock.mockImplementation(() => pending.promise);
  sessionState.currentOrgId = "org-new";
  view.rerender(<MemberInvitesPanel />);
  expect(screen.queryByText("chenmo@x.test")).not.toBeInTheDocument();
  expect(screen.queryByTestId("admin-members-invite-dialog")).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/tok-resent/)).not.toBeInTheDocument();
  expect(screen.getByText("正在读取成员…")).toBeInTheDocument();
  view.unmount();
  await act(async () => pending.resolve(jsonResponse({ members: [] })));
});

it("旧组织成员响应完成后不再发邀请请求或覆盖新组织", async () => {
  const old = deferredResponse();
  fetchMock.mockImplementation(() => old.promise);
  const view = render(<MemberInvitesPanel />);
  sessionState.currentOrgId = "org-new";
  fetchMock.mockImplementation(routed({ invites: [invite({ email: "new@x.test", inviteId: "inv-new" })] }));
  view.rerender(<MemberInvitesPanel />);
  await screen.findByText("new@x.test");
  const count = fetchMock.mock.calls.length;
  await act(async () => old.resolve(jsonResponse({ members: [member()] })));
  expect(fetchMock).toHaveBeenCalledTimes(count);
  expect(screen.getByText("new@x.test")).toBeInTheDocument();
});

it("旧组织重发完成后不向新组织显示链接或重新载入", async () => {
  const old = deferredResponse();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => init?.method === "POST" ? old.promise : routed({ invites: [invite()] })(url, init));
  const view = render(<MemberInvitesPanel />);
  await screen.findByText("chenmo@x.test");
  fireEvent.click(screen.getByTestId("admin-member-resend-inv-1"));
  sessionState.currentOrgId = "org-new";
  fetchMock.mockImplementation(routed({ invites: [] }));
  view.rerender(<MemberInvitesPanel />);
  await screen.findByTestId("admin-members-roster-count");
  const count = fetchMock.mock.calls.length;
  await act(async () => old.resolve(jsonResponse({ newTokenIssued: true, cooldownSec: 60, activationToken: "old-org-link" })));
  expect(fetchMock).toHaveBeenCalledTimes(count);
  expect(screen.queryByText(/已对 chenmo/)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue(/old-org-link/)).not.toBeInTheDocument();
});

it.each(['members', 'invites'])('%s 读取错误显示人话而不暴露内部码', async endpoint => {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => String(url).includes(`/${endpoint}`)
    ? Promise.resolve(jsonResponse({ reasonCode: "INTERNAL_ORG_SERVICE_FAILURE" }, 500))
    : routed()(url, init));
  render(<MemberInvitesPanel />);
  const panel = await screen.findByTestId("admin-members-load-failed");
  expect(panel).toHaveTextContent("服务器出错了，稍后再试一次");
  expect(panel).not.toHaveTextContent("INTERNAL_ORG_SERVICE_FAILURE");
  expect(panel).not.toHaveTextContent("http_500");
});

it("成员404错误提示重新选择组织", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ reasonCode: "ORG_NOT_FOUND" }, 404));
  render(<MemberInvitesPanel />);
  expect(await screen.findByTestId("admin-members-load-failed")).toHaveTextContent("这个组织找不到了，请重新选择组织。");
});

it.each([500, 404])('重发%s错误显示可操作文案而不暴露内部码', async status => {
  fetchMock.mockImplementation(routed({ invites: [invite()], resend: () => jsonResponse({ reasonCode: "INVITE_INTERNAL_FAILURE" }, status) }));
  render(<MemberInvitesPanel />);
  await screen.findByText("chenmo@x.test");
  fireEvent.click(screen.getByTestId("admin-member-resend-inv-1"));
  const expected = status === 404 ? "这条邀请找不到了，请刷新成员列表。" : "重发失败：服务器出错了，稍后再试一次";
  await screen.findByText(expected);
  expect(screen.getByTestId("admin-members-toast")).not.toHaveTextContent("INVITE_INTERNAL_FAILURE");
});
