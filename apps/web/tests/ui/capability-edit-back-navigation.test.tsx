/**
 * 人类实测反馈（2026-08-30）：从 `/skill`（screen=library，「Skill 库」真实数据屏）
 * 点「编辑源码」进入 `/admin/skill/[id]`，点「返回」却跳到了 `/skill?screen=catalog`
 * ——另一个屏，不是刚才那个。`CapabilityEditPage` 此前把「返回」写死回
 * `CATALOG_HREF[kind]`（按 kind 猜的唯一落点），与「这次真的是从哪个界面点进来的」
 * 是两回事。
 *
 * 修法：调用方（`skill-catalog-live.tsx` 的 `editSourceHref` / `capability-catalog
 * -screen.tsx` 的 `editHrefFor`）把自己当前的 URL 编码进 `?from=`；两个 `[id]/page.tsx`
 * 解析、用 `safeRelativePath` 校验后作为 `backHref` prop 传给 `CapabilityEditPage`，
 * 优先于它自己按 kind 猜的默认目的地。
 *
 * 本文件直接测 `CapabilityEditPage` 本身：
 *  ① 传了合法 `backHref` → 「返回」链接用它，不用 `CATALOG_HREF[kind]`；
 *  ② 不传（deep link 直接打开这个 URL，没有"之前的界面"）→ 落回旧的默认目的地，
 *     行为不变（向后兼容）。
 * `?from=` 的解析 + `safeRelativePath` 校验单独在 `safe-relative-path.test.ts` 里测。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-back-nav", orgRole: "admin" }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: { org: { id: sessionState.currentOrgId, name: "真实组织" }, orgRole: sessionState.orgRole },
  }),
}));

const { listCapabilities } = vi.hoisted(() => ({ listCapabilities: vi.fn() }));
vi.mock("@/lib/live-capabilities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-capabilities")>()),
  listCapabilities,
}));

import { CapabilityEditPage } from "@/components/admin/capability-edit-page";

const SKILL_ROW = {
  id: "sk_back_nav",
  orgId: sessionState.currentOrgId,
  kind: "skill" as const,
  name: "返回导航测试 Skill",
  scope: "org-wide" as const,
  enabled: true,
  endpoint: null,
  disabledReason: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe("CapabilityEditPage「返回」目的地——不再写死回按 kind 猜的默认值", () => {
  it("传了 backHref：not-found 态与 ready 态的「返回」都指向调用方给的真实来源", async () => {
    // not-found：`id` 在 `listCapabilities` 结果里找不到——这正是截图复现的那个场景
    // （`/skill` 库屏传来的 `skills.id` 与旧代码下 `capability_listings.id` 对不上时）。
    listCapabilities.mockResolvedValue([]);
    render(<CapabilityEditPage kind="skill" id={SKILL_ROW.id} backHref="/skill" />);
    await waitFor(() => expect(screen.getByTestId("admin-skill-edit-not-found")).toBeInTheDocument());
    expect(screen.getByTestId("admin-skill-edit-back").getAttribute("href")).toBe("/skill");
  });

  it("ready 态（compact）：「返回」同样用调用方给的 backHref，不是 CATALOG_HREF['skill']", async () => {
    listCapabilities.mockResolvedValue([SKILL_ROW]);
    render(<CapabilityEditPage kind="skill" id={SKILL_ROW.id} compact backHref="/skill" />);
    await waitFor(() => expect(screen.getByTestId("admin-skill-edit-compact-header")).toBeInTheDocument());
    const backLinks = screen.getAllByTestId("admin-skill-edit-back");
    for (const link of backLinks) expect(link.getAttribute("href")).toBe("/skill");
  });

  it("不传 backHref（直接打开这个 URL，没有「之前的界面」）：落回旧的默认目的地，行为不变", async () => {
    listCapabilities.mockResolvedValue([]);
    render(<CapabilityEditPage kind="skill" id={SKILL_ROW.id} />);
    await waitFor(() => expect(screen.getByTestId("admin-skill-edit-not-found")).toBeInTheDocument());
    expect(screen.getByTestId("admin-skill-edit-back").getAttribute("href")).toBe("/skill?screen=catalog");
  });

  it("agent kind 同样支持 backHref 覆盖（不只是 skill 专属）", async () => {
    const AGENT_ROW = { ...SKILL_ROW, id: "agent_back_nav", kind: "agent" as const };
    listCapabilities.mockResolvedValue([]);
    render(<CapabilityEditPage kind="agent" id={AGENT_ROW.id} backHref="/platform-admin/agent?tab=roster" />);
    await waitFor(() => expect(screen.getByTestId("admin-agent-edit-not-found")).toBeInTheDocument());
    expect(screen.getByTestId("admin-agent-edit-back").getAttribute("href")).toBe("/platform-admin/agent?tab=roster");
  });
});
