/**
 * 左上角组织头像的读路径（invite-link-and-reads delta ④ + 独立复核 D3）。
 *
 * 断的是「会错的那几件」：
 *   ① 非 admin 成员：头像 URL 从 `identity.org.avatarUrl`（resolveIdentity 登录即得）来，
 *      **零** `updateOrganization` 空补丁请求——旧实现里非 admin 永远回落首字，D3 判修。
 *   ② `identity.org.avatarUrl = null` 时回落组织名首字，同样零请求（不发注定 403 的探测）。
 *   ③ 刷新通道不退役：admin 上传新头像后 `invalidateOrgAvatar` 触发**恰好一次**
 *      admin-only 空补丁读；同样的失效对非 admin 实例**不**触发请求。
 *
 * 网络边界全部 mock（`live-org-admin` / `use-authed-image-src`），断言落在渲染出的 DOM
 * 与 mock 的调用次数上。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const { updateOrganization, useOptionalSession } = vi.hoisted(() => ({
  updateOrganization: vi.fn(),
  useOptionalSession: vi.fn(() => null as unknown),
}));

vi.mock("@/lib/live-org-admin", () => ({ updateOrganization }));
// 鉴权 blob 拉取原样透传 URL——本文件测的是「URL 从哪来」，不是 blob 管线（那有 D9 实测）。
vi.mock("@/lib/use-authed-image-src", () => ({
  useAuthedImageSrc: (url: string | null) => ({ src: url, failed: false }),
}));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession }));

import { OrgMenu, invalidateOrgAvatar } from "@/components/shell/org-menu";
import type { Identity } from "@/lib/identity";

function identityFor(orgId: string, orgRole: "admin" | "consultant", avatarUrl: string | null): Identity {
  return {
    displayName: "测试者",
    avatarUrl: null,
    orgRole,
    org: { id: orgId, name: "远洋新能源", kind: "organization", team: null, modelPolicy: "any", avatarUrl },
    projectRole: null,
    projectName: null,
    groupName: null,
  } as Identity;
}

function renderMenu(identity: Identity) {
  return render(
    <OrgMenu identity={identity} organizations={[{ id: identity.org.id, label: identity.org.name ?? "" }]} onSelect={() => {}} />,
  );
}

afterEach(() => {
  updateOrganization.mockReset();
  useOptionalSession.mockReturnValue(null);
});

describe("组织头像首选 identity.org.avatarUrl（D3）", () => {
  it("① 非 admin：identity 带 avatarUrl → 渲染真实头像，零 updateOrganization 请求", () => {
    useOptionalSession.mockReturnValue({ status: "authenticated" });
    renderMenu(identityFor("org-d3-nonadmin", "consultant", "/organizations/org-d3-nonadmin/avatar-file/a1"));
    const img = screen.getByTestId<HTMLImageElement>("org-menu-avatar");
    expect(img.getAttribute("src")).toContain("/organizations/org-d3-nonadmin/avatar-file/a1");
    // 🔴 D3 的核心：URL 是 identity 里带来的，不该有任何补充请求（更不该 403）。
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("② identity 无头像 → 回落组织名首字，同样零请求", () => {
    useOptionalSession.mockReturnValue({ status: "authenticated" });
    renderMenu(identityFor("org-d3-noavatar", "consultant", null));
    expect(screen.queryByTestId("org-menu-avatar")).toBeNull();
    expect(screen.getByTestId("org-switcher")).toHaveTextContent("远");
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("③ 刷新通道不退役：invalidateOrgAvatar 后 admin 实例恰好打一次空补丁读；非 admin 实例不打", async () => {
    useOptionalSession.mockReturnValue({ status: "authenticated" });
    updateOrganization.mockResolvedValue({ avatarUrl: "/organizations/org-d3-admin/avatar-file/a2" });

    renderMenu(identityFor("org-d3-admin", "admin", "/organizations/org-d3-admin/avatar-file/a1"));
    // 挂载本身不打请求——identity 已带 URL。
    expect(updateOrganization).not.toHaveBeenCalled();

    await act(async () => {
      invalidateOrgAvatar("org-d3-admin");
    });
    expect(updateOrganization).toHaveBeenCalledTimes(1);
    // 刷新后显示的是空补丁读回来的新值（上传后的即时刷新，D5 先例）。
    expect(screen.getByTestId<HTMLImageElement>("org-menu-avatar").getAttribute("src")).toContain("avatar-file/a2");

    // 非 admin 实例：同样的失效不触发注定 403 的请求，安静用 identity 旧值。
    updateOrganization.mockClear();
    renderMenu(identityFor("org-d3-nonadmin-2", "consultant", "/organizations/org-d3-nonadmin-2/avatar-file/a3"));
    await act(async () => {
      invalidateOrgAvatar("org-d3-nonadmin-2");
    });
    expect(updateOrganization).not.toHaveBeenCalled();
    expect(screen.getAllByTestId<HTMLImageElement>("org-menu-avatar").at(-1)!.getAttribute("src")).toContain("avatar-file/a3");
  });
});
