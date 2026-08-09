/**
 * issue #593 —— 侧边栏一级/二级信息架构复位。
 *
 * 故障形状：蓝本 / 技能 / 智能体 / 成员 / 资产 跟「对话」平级挂在**一级导航**上，
 * 而原型（`phases/requirements/WorkspaceX Standalone.html`）里它们全是**后台模块**。
 *
 * ⚠ 为什么本文件一条 `getByText("蓝本")` 都没有：那四个字**改之前改之后都在页面上**
 *   （改前在一级栏，改后在后台左栏），这种断言两边都绿 = 空转。
 *   §1 断言的是**关系**（在后台的二级里 ∧ 不在任何一级项里）。
 *
 * §2 是反证套件：把改动还原（把 templates 放回一级「编排」）判定**必须红且点名**。
 *   没有 §2，§1 可能只是在恒真判定上空转。
 *
 * 2026-08-09（issue #801）追加第六项 `canvas`（画布）：人类核对确认画布同样判定为
 * 后台二级模块，不占 STUDIO 一级——复用本文件已有的 `diffNavIa` 机械判定，不新起一份。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NAV_SEGMENTS, ADMIN_SECOND_LEVEL, TOP_LEVEL_NAV_ITEMS, type NavSegment } from "@/lib/navigation";
import { diffNavIa, topLevelKeys, secondLevelKeysOf, segmentLabelOf } from "@/lib/nav-ia";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));

afterEach(() => cleanup());

/**
 * 判定为「后台模块」的六项（前五项依据见 navigation.ts 底部 #593 长注 ①②③；
 * 第六项 `canvas` 依据见同文件顶部 2026-08-09 追记 / issue #801）。
 */
const MUST_BE_UNDER_ADMIN = ["templates", "skills", "agent-runtime", "org-admin", "asset-governance", "canvas"];

/* ══════════════════ §1 真实结构断言 ══════════════════ */

describe("§1 一级只留原型圈定的项，五项降为「后台」的二级", () => {
  it("五项都在「后台」的二级里，且都不在一级 —— 逐条差集为空", () => {
    expect(
      diffNavIa({ segments: NAV_SEGMENTS, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN }),
    ).toEqual([]);
  });

  it("两侧都非空 —— 空集会让「都不在一级」平凡为真", () => {
    expect(topLevelKeys(NAV_SEGMENTS).length).toBeGreaterThan(0);
    expect(secondLevelKeysOf(NAV_SEGMENTS, "admin").length).toBeGreaterThan(0);
  });

  it("一级「编排」组里只有「项目」—— 蓝本不再与它并列（原型 COLUMN 1）", () => {
    const orchestration = NAV_SEGMENTS.find((s) => s.label === "编排");
    expect(orchestration?.items.map((i) => i.key)).toEqual(["projects"]);
  });

  it("一级「治理」组里只有「后台」—— 技能/智能体/成员/资产不再与它并列", () => {
    const governance = NAV_SEGMENTS.find((s) => s.label === "治理");
    expect(governance?.items.map((i) => i.key)).toEqual(["admin"]);
  });

  it("「蓝本」不属于任何一级分组（segmentLabelOf 查不到它）", () => {
    expect(segmentLabelOf(NAV_SEGMENTS, "templates")).toBeUndefined();
    expect(segmentLabelOf(NAV_SEGMENTS, "admin")).toBe("治理");
  });
});

/* ══════════════════ §2 反证：还原改动必须红且点名 ══════════════════ */

/** 深拷贝一份可改的结构（icon 是函数引用，浅拷到 items 层即可）。 */
function cloneSegments(): NavSegment[] {
  return NAV_SEGMENTS.map((s) => ({
    label: s.label,
    items: s.items.map((i) => ({ ...i, children: i.children ? i.children.map((c) => ({ ...c })) : undefined })),
  }));
}

describe("§2 反证套件", () => {
  it("R-1 把「蓝本」放回一级「编排」（＝还原本次改动）⇒ 红，且点名 templates 仍在一级", () => {
    const segs = cloneSegments();
    const admin = segs.flatMap((s) => s.items).find((i) => i.key === "admin")!;
    const tpl = admin.children!.find((c) => c.key === "templates")!;
    admin.children = admin.children!.filter((c) => c.key !== "templates");
    segs.find((s) => s.label === "编排")!.items.push(tpl);

    const errors = diffNavIa({ segments: segs, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN });
    expect(errors.some((e) => e.includes("[仍在一级]") && e.includes("templates"))).toBe(true);
    expect(errors.some((e) => e.includes("[不在二级]") && e.includes("templates"))).toBe(true);
    // 只点名 templates —— 其余四项不该被连坐
    expect(errors.some((e) => e.includes("skills"))).toBe(false);
  });

  it("R-2 把「成员」放回一级「治理」⇒ 红且点名 org-admin", () => {
    const segs = cloneSegments();
    const admin = segs.flatMap((s) => s.items).find((i) => i.key === "admin")!;
    const org = admin.children!.find((c) => c.key === "org-admin")!;
    admin.children = admin.children!.filter((c) => c.key !== "org-admin");
    segs.find((s) => s.label === "治理")!.items.push(org);

    const errors = diffNavIa({ segments: segs, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN });
    expect(errors.some((e) => e.includes("[仍在一级]") && e.includes("org-admin"))).toBe(true);
  });

  it("R-3 从一级删掉但**没**挂到二级（＝换成敲 URL 才进得去的孤岛）⇒ 仍必须红", () => {
    const segs = cloneSegments();
    const admin = segs.flatMap((s) => s.items).find((i) => i.key === "admin")!;
    admin.children = admin.children!.filter((c) => c.key !== "skills");

    const errors = diffNavIa({ segments: segs, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN });
    expect(errors.some((e) => e.includes("[不在二级]") && e.includes("skills"))).toBe(true);
  });

  it("R-4 二级整组清空 ⇒ 红（不许因为「一级里也没有」而平凡为真）", () => {
    const segs = cloneSegments();
    segs.flatMap((s) => s.items).find((i) => i.key === "admin")!.children = [];
    const errors = diffNavIa({ segments: segs, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN });
    expect(errors.some((e) => e.includes("[空集]"))).toBe(true);
  });

  it("R-5 空导航 / 空要求集合 ⇒ 红（空集防线）", () => {
    expect(diffNavIa({ segments: [], parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN }).length).toBeGreaterThan(0);
    expect(diffNavIa({ segments: NAV_SEGMENTS, parentKey: "admin", mustBeSecondLevel: [] }).length).toBeGreaterThan(0);
  });

  it("R-6 父项「后台」自己被挪走 ⇒ 红（点名缺父项）", () => {
    const segs = cloneSegments().map((s) => ({ ...s, items: s.items.filter((i) => i.key !== "admin") }));
    const errors = diffNavIa({ segments: segs, parentKey: "admin", mustBeSecondLevel: MUST_BE_UNDER_ADMIN });
    expect(errors.some((e) => e.includes("[缺父项]"))).toBe(true);
  });
});

/* ══════════════════ §3 渲染：一级栏画不出它们，后台左栏画得出 ══════════════════ */

describe("§3 渲染层：入口有且只有一处", () => {
  it("IconRail 只画一级项 —— 五项的 rail-* 锚点一个都不存在（不是隐藏，是压根没渲染）", async () => {
    const { IconRail } = await import("@/components/shell/icon-rail");
    render(<IconRail avatarInitial="X" />);
    for (const key of MUST_BE_UNDER_ADMIN) {
      expect(screen.queryByTestId(`rail-${key}`)).toBeNull();
    }
    // 阳性对照：一级项确实画出来了，否则上面的 queryByTestId 全 null 只是因为没渲染
    expect(screen.getByTestId("rail-admin")).toBeTruthy();
    expect(screen.getByTestId("rail-chat")).toBeTruthy();
    expect(TOP_LEVEL_NAV_ITEMS.some((i) => i.key === "admin")).toBe(true);
  });

  it("AdminNav 画出五个二级入口，href 指向各束现行屏", async () => {
    const { AdminNav } = await import("@/components/admin/admin-nav");
    const { ADMIN_NAV_COUNT_SOURCES } = await import("@/lib/mock/admin");
    render(<AdminNav active="overview" countSources={ADMIN_NAV_COUNT_SOURCES} />);
    const expectedHref: Record<string, string> = Object.fromEntries(
      ADMIN_SECOND_LEVEL.map((i) => [i.key, i.href]),
    );
    for (const key of MUST_BE_UNDER_ADMIN) {
      const link = screen.getByTestId(`admin-sub-${key}`);
      expect(link.getAttribute("href")).toBe(expectedHref[key]);
    }
  });
});
