/**
 * 2026-09-20 人类直接要求（权限 review）：
 *   「只有平台管理员可以看到平台管理菜单，至于组织管理员才可以看到组织管理后台」。
 *
 * 断言的是**矩阵**，不是单点：四种查看者 × 三个治理入口。
 *   §1 判据本身（`navSegmentsForViewer`）：谁看得见 `admin` / `platform-admin`。
 *   §2 IconRail 渲染：普通顾问两个入口的 `rail-*` 锚点**压根不渲染**（不是 CSS 隐藏）。
 *   §3 组织菜单：非 admin 看不到「组织管理」项（`org-admin-entry`）。
 *   §4 反证：把查看者换成够格的那一位，同一处断言必须翻面——否则 §2/§3 的 null
 *      只能证明"没渲染"，不能证明"是被这条判据挡掉的"。
 *
 * ⚠ 这几条验的是**展示过滤**，不是权限（UC-0.3 R5：前端隐藏即安全是禁止的）。服务端
 *   那道门另有其人：平台面 `PlatformOperatorGuard`（403 `NOT_PLATFORM_SUPERUSER`）、
 *   组织面写操作要本组织 admin。菜单藏起来只决定"会不会被引导过去"。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { navSegmentsForViewer } from "@/lib/navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {}, back: () => {}, forward: () => {} }),
}));

/** 平台准入是一次网络读（`GET /platform/access`）；这里桩"我是谁"，判定仍由被测代码跑。 */
const platformOperator = vi.hoisted(() => ({ value: false }));
vi.mock("@/lib/live-platform-access", () => ({
  usePlatformAccess: () => ({
    platformSuperuser: platformOperator.value,
    platformAdmin: false,
    platformOperator: platformOperator.value,
  }),
}));

import { IconRail } from "@/components/shell/icon-rail";
import { MOCK_ORGS, mockIdentity, type OrgRole } from "@/lib/identity";

const ORGS = MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }));

function renderRail(orgRole: OrgRole, isPlatformOperator: boolean) {
  platformOperator.value = isPlatformOperator;
  return render(
    <IconRail
      identity={{ ...mockIdentity("org-yuanyang", null), orgRole }}
      organizations={ORGS}
      onSwitchOrganization={() => undefined}
      avatarInitial="X"
    />,
  );
}

const keys = (segments: ReturnType<typeof navSegmentsForViewer>) =>
  segments.flatMap((s) => s.items.map((i) => i.key));

afterEach(() => {
  cleanup();
  platformOperator.value = false;
});

describe("§1 判据：navSegmentsForViewer", () => {
  it("顾问（非组织 admin、非平台运维）：两个治理入口都不在清单里", () => {
    const k = keys(navSegmentsForViewer({ orgName: "远洋新能源", orgRole: "consultant", platformOperator: false }));
    expect(k).not.toContain("admin");
    expect(k).not.toContain("platform-admin");
    // 阳性对照：其余入口没被连坐过滤掉
    expect(k).toContain("chat");
  });

  it("组织管理员、非平台运维：有「组织后台」，没有「平台后台」", () => {
    const k = keys(navSegmentsForViewer({ orgName: "远洋新能源", orgRole: "admin", platformOperator: false }));
    expect(k).toContain("admin");
    expect(k).not.toContain("platform-admin");
  });

  it("平台运维、但在本组织只是顾问：有「平台后台」，没有「组织后台」——两条判据互不蕴含", () => {
    const k = keys(navSegmentsForViewer({ orgName: "远洋新能源", orgRole: "consultant", platformOperator: true }));
    expect(k).toContain("platform-admin");
    expect(k).not.toContain("admin");
  });

  it("平台准入还没查出来（undefined）：先不画平台入口——闪现再消失比晚半秒更糟", () => {
    const k = keys(navSegmentsForViewer({ orgName: "远洋新能源", orgRole: "admin" }));
    expect(k).not.toContain("platform-admin");
    expect(k).toContain("admin");
  });
});

describe("§2 IconRail：不够格的查看者，锚点压根不渲染", () => {
  it("顾问 + 非平台运维：rail-admin 与 rail-platform-admin 都不存在", () => {
    renderRail("consultant", false);
    expect(screen.queryByTestId("rail-admin")).toBeNull();
    expect(screen.queryByTestId("rail-platform-admin")).toBeNull();
    // 阳性对照：栏本身渲染了
    expect(screen.getByTestId("rail-chat")).toBeTruthy();
  });

  it("§4 反证 —— 同一处换成够格的查看者，两个锚点都出现", () => {
    renderRail("admin", true);
    expect(screen.getByTestId("rail-admin")).toBeTruthy();
    expect(screen.getByTestId("rail-platform-admin")).toBeTruthy();
  });
});

describe("§3 组织菜单：「组织管理」只对组织管理员", () => {
  function openOrgMenu() {
    const trigger = screen.getByTestId("org-switcher");
    // Radix DropdownMenuTrigger 靠 pointerdown 开菜单（jsdom 下 click 不触发）。
    fireEvent.pointerDown(trigger, { button: 0 });
  }

  it("顾问：菜单能打开（切换组织仍在），但没有 org-admin-entry", () => {
    renderRail("consultant", false);
    openOrgMenu();
    expect(screen.getByTestId("org-menu")).toBeTruthy();
    expect(screen.getByTestId(`org-switcher-option-${MOCK_ORGS[0]!.id}`)).toBeTruthy();
    expect(screen.queryByTestId("org-admin-entry")).toBeNull();
  });

  it("§4 反证 —— 组织管理员：同一处出现 org-admin-entry，指向 /org-admin", () => {
    renderRail("admin", false);
    openOrgMenu();
    expect(screen.getByTestId("org-admin-entry").getAttribute("href")).toBe("/org-admin");
  });
});
