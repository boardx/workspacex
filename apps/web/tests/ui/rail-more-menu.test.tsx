import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

let mockPath = "/chat";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPath,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

import { IconRail } from "@/components/shell/icon-rail";
import { MOCK_ORGS, mockIdentity } from "@/lib/identity";
import { navSegmentsForViewer } from "@/lib/navigation";

/**
 * 图标栏「更多」三点菜单（2026-09-30 人类直接要求：只把最重要的常驻，其余收进三点菜单）：
 * 常驻与收纳由 `NavItem.overflow` 一处决定；每个入口只在栏内或菜单内出现一次。
 */
const IDENTITY = { ...mockIdentity("org-yuanyang", null), orgRole: "admin" as const };
const ORGS = MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }));
const OVERFLOW_KEYS = ["whiteboard", "recording", "survey", "design-workbench", "feedback-drafts", "agent-directory", "work-skill-catalog"];

function renderRail() {
  return render(
    <IconRail identity={IDENTITY} organizations={ORGS} onSwitchOrganization={() => undefined} avatarInitial="X" />,
  );
}
const open = () => fireEvent.pointerDown(screen.getByTestId("rail-more"), { button: 0 });

describe("IconRail「更多」三点菜单", () => {
  afterEach(() => { cleanup(); mockPath = "/chat"; });

  it("栏内只常驻最重要的入口，收纳的入口不在栏里", () => {
    renderRail();
    const rail = screen.getByTestId("rail-scroll");
    for (const key of ["home", "chat", "projects", "research", "interview", "brain", "tasks", "admin"]) {
      expect(within(rail).getByTestId(`rail-${key}`)).toBeTruthy();
    }
    for (const key of OVERFLOW_KEYS) expect(screen.queryByTestId(`rail-${key}`)).toBeNull();
  });

  it("点开三点菜单后收纳的入口都在，按原分组给小标题，且不与栏内重复", () => {
    renderRail();
    open();
    const menu = screen.getByTestId("rail-more-menu");
    for (const key of OVERFLOW_KEYS) {
      expect(within(menu).getAllByTestId(`rail-${key}`)).toHaveLength(1);
    }
    expect(within(menu).getByText("STUDIO")).toBeTruthy();
    expect(within(menu).getByText("能力")).toBeTruthy();
    // 常驻入口不出现在菜单里
    expect(within(menu).queryByTestId("rail-chat")).toBeNull();
    // 全局每个 testid 只有一处
    for (const key of [...OVERFLOW_KEYS, "chat"]) expect(screen.getAllByTestId(`rail-${key}`)).toHaveLength(1);
  });

  it("当前页是被收纳的入口时，三点按钮高亮；否则不高亮", () => {
    mockPath = "/studio/board";
    renderRail();
    expect(screen.getByTestId("rail-more").getAttribute("aria-current")).toBe("page");
    cleanup();
    mockPath = "/chat";
    renderRail();
    expect(screen.getByTestId("rail-more").getAttribute("aria-current")).toBeNull();
  });

  it("每个一级入口只被收纳或常驻一次：overflow 标记是导航数据里的唯一事实", () => {
    const all = navSegmentsForViewer({ orgName: "x", orgRole: "admin", platformOperator: true }).flatMap((s) => s.items);
    expect(all.filter((i) => i.overflow).map((i) => i.key).sort()).toEqual([...OVERFLOW_KEYS].sort());
    // 治理入口（组织后台 / 平台后台）不收纳：只有对应角色才看得到它们，本来就不占普通成员的栏位
    expect(all.filter((i) => i.key === "admin" || i.key === "platform-admin").every((i) => !i.overflow)).toBe(true);
  });
});
