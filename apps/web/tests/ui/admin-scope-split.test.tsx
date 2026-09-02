/**
 * 2026-09-02 人类直接裁决（看真实后台截图后原话）：「把目前的后台切割为两部分，两个菜单入口，
 * 一个是组织的后台管理，一个是平台的后台管理，在 nav bar 要可以看到两个菜单，进来不同的功能。
 * 组织的管理和平台的管理是不同的」。
 *
 * 断言的是**关系**，不是数量：
 *   §1 一级导航「治理」段里两个入口都画出来（rail-admin / rail-platform-admin），href 不同。
 *   §2 `ADMIN_NAV` 每一组都归属且只归属一个面；两面都非空（空集会让下面的差集平凡为真）。
 *   §3 `AdminNav` 按面渲染：组织面画不出平台面的项，反之亦然——同一入口不许在两面都出现。
 *   §4 平台面左栏每一项的 href 都有路由落点（`PLATFORM_ADMIN_ROUTES`）——只补左栏不给落点 = 404。
 *   §5 反证：把一组的 scope 改错，§3 的判定必须红且点名。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NAV_SEGMENTS } from "@/lib/navigation";
import {
  ADMIN_NAV, ADMIN_NAV_COUNT_SOURCES, ADMIN_MODULE_SCOPE, adminNavForScope, type AdminScope,
} from "@/lib/mock/admin";
import { ADMIN_NAV_TESTID } from "@/components/admin/asset-kind-nav";
import { PLATFORM_ADMIN_ROUTES, platformAdminHref } from "@/lib/platform-admin-routes";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

afterEach(() => cleanup());

const SCOPES: AdminScope[] = ["org", "platform"];

/** 某一面**不该**画出来的项键 = 另一面声明的全部项键。 */
function foreignKeys(scope: AdminScope): string[] {
  return ADMIN_NAV.filter((g) => g.scope !== scope).flatMap((g) => g.items.map((i) => i.key));
}

describe("§1 一级导航：治理段有两个入口", () => {
  it("IconRail 同时画出 rail-admin 与 rail-platform-admin，且 href 不同", async () => {
    const { IconRail } = await import("@/components/shell/icon-rail");
    const { mockIdentity, MOCK_ORGS } = await import("@/lib/identity");
    render(
      <IconRail
        identity={mockIdentity("org-yuanyang", null)}
        organizations={MOCK_ORGS.map((o) => ({ id: o.id, label: o.name }))}
        onSwitchOrganization={() => undefined}
        avatarInitial="X"
      />,
    );
    const org = screen.getByTestId("rail-admin");
    const platform = screen.getByTestId("rail-platform-admin");
    expect(org.getAttribute("href")).toBe("/admin");
    expect(platform.getAttribute("href")).toBe("/platform-admin");
    expect(org.textContent).toContain("组织后台");
    expect(platform.textContent).toContain("平台后台");
  });

  it("平台后台一级项没有 children —— 它的二级全部在 ADMIN_NAV 的 platform 面里，不抄第二份", () => {
    const item = NAV_SEGMENTS.flatMap((s) => s.items).find((i) => i.key === "platform-admin");
    expect(item).toBeDefined();
    expect(item!.children).toBeUndefined();
  });

  it("平台后台的 href 不以 /admin 开头 —— 否则 IconRail 的前缀匹配会把两个入口同时点亮", () => {
    const item = NAV_SEGMENTS.flatMap((s) => s.items).find((i) => i.key === "platform-admin")!;
    expect(item.href.startsWith("/admin")).toBe(false);
  });
});

describe("§2 每一组归属且只归属一个面，两面都非空", () => {
  it("两面各自都至少有一组（空集防线）", () => {
    for (const scope of SCOPES) expect(adminNavForScope(scope).length).toBeGreaterThan(0);
  });

  it("ADMIN_MODULE_SCOPE 覆盖全部模块键，且与分组 scope 一致", () => {
    for (const g of ADMIN_NAV) for (const i of g.items) expect(ADMIN_MODULE_SCOPE[i.key]).toBe(g.scope);
  });

  it("反馈与迭代 / 平台成员在平台面；AI 能力与组织两组在组织面", () => {
    expect(ADMIN_MODULE_SCOPE.feedback).toBe("platform");
    expect(ADMIN_MODULE_SCOPE.platform).toBe("platform");
    expect(ADMIN_MODULE_SCOPE.overview).toBe("org");
    expect(ADMIN_MODULE_SCOPE.agent).toBe("org");
    expect(ADMIN_MODULE_SCOPE.members).toBe("org");
  });
});

describe("§3 AdminNav 按面渲染：入口只在一面出现", () => {
  for (const scope of SCOPES) {
    it(`scope=${scope}：自己面的项全部画出，另一面的项一个都不画`, async () => {
      const { AdminNav } = await import("@/components/admin/admin-nav");
      const own = adminNavForScope(scope).flatMap((g) => g.items);
      render(<AdminNav active={own[0]!.key} scope={scope} countSources={ADMIN_NAV_COUNT_SOURCES} />);
      expect(screen.getByTestId("admin-nav").getAttribute("data-admin-scope")).toBe(scope);
      for (const i of own) expect(screen.getByTestId(ADMIN_NAV_TESTID[i.key]).getAttribute("href")).toBe(i.href);
      const foreign = foreignKeys(scope);
      expect(foreign.length).toBeGreaterThan(0);
      for (const key of foreign) expect(screen.queryByTestId(ADMIN_NAV_TESTID[key as keyof typeof ADMIN_NAV_TESTID])).toBeNull();
    });
  }

  it("不传 scope 时按 active 所属面推断：active=feedback ⇒ 平台面标题", async () => {
    const { AdminNav } = await import("@/components/admin/admin-nav");
    render(<AdminNav active="feedback" countSources={ADMIN_NAV_COUNT_SOURCES} />);
    expect(screen.getByTestId("admin-nav-title").textContent).toBe("平台后台");
    expect(screen.queryByTestId(ADMIN_NAV_TESTID.overview)).toBeNull();
  });

  it("组织面标题是「组织后台」，且仍画「组织」组的总览", async () => {
    const { AdminNav } = await import("@/components/admin/admin-nav");
    render(<AdminNav active="overview" countSources={ADMIN_NAV_COUNT_SOURCES} />);
    expect(screen.getByTestId("admin-nav-title").textContent).toBe("组织后台");
    expect(screen.getByTestId(ADMIN_NAV_TESTID.overview)).toBeTruthy();
  });
});

describe("§4 平台面每一项都有路由落点", () => {
  it("adminNavForScope('platform') 的 href 集合 == PLATFORM_ADMIN_ROUTES 派生的 href 集合（双向）", () => {
    const navHrefs = adminNavForScope("platform").flatMap((g) => g.items.map((i) => i.href)).sort();
    const routeHrefs = Object.keys(PLATFORM_ADMIN_ROUTES).map(platformAdminHref).sort();
    expect(navHrefs.length).toBeGreaterThan(0);
    expect(navHrefs).toEqual(routeHrefs);
  });

  it("路由段映射到的模块键都属于平台面", () => {
    for (const key of Object.values(PLATFORM_ADMIN_ROUTES)) expect(ADMIN_MODULE_SCOPE[key]).toBe("platform");
  });
});

describe("§5 反证", () => {
  it("R-1 把「运营」组误归回组织面 ⇒ 组织面会画出 feedback（与 §3 的判定相反）", () => {
    const tampered = ADMIN_NAV.map((g) => (g.group === "运营" ? { ...g, scope: "org" as const } : g));
    const orgKeys = tampered.filter((g) => g.scope === "org").flatMap((g) => g.items.map((i) => i.key));
    expect(orgKeys).toContain("feedback");
    // 真实数据里没有
    expect(adminNavForScope("org").flatMap((g) => g.items.map((i) => i.key))).not.toContain("feedback");
  });
});
