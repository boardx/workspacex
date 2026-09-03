/**
 * F132 —— 后台左栏「AI 能力」组的项集合 ＝ 契约 `AssetKind` 六值（**双向相等**）。
 *
 * ## 这条 feature 的本体就是一道门控，所以反证是交付物本身
 *
 * `asset-governance/domain.md` I-2 要的是双向。单向（「左栏每一项都是合法 `AssetKind`」）
 * **在改这次之前的代码上就是绿的**——那 4 项确实都合法，而故障是**缺 2 项**。
 * 所以本文件分两半：
 *   §1 真实断言：今天的 `ADMIN_NAV` 与今天的 `AssetKind` 双向相等，且六个入口真的渲染出来了。
 *   §2 **反证套件**：把任一侧改坏，门控**必须红，且点名是哪一项**。
 *      没有 §2，§1 可能只是在一个恒真的判定上空转（本仓已九次「全绿但空转」）。
 *
 * ⚠ 本文件**不写** `toHaveLength(6)`（coding-standards 修订 E-4 / contract-design 硬规则 7）：
 *   长度断言在「删一个、加一个」时全绿，且会把一次经 ADR 评审的正当新增当成失败。
 *   §2 的 R-6 就是这条的反证：六对六、长度相同、成员不同 ⇒ 必须红。
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AssetKind } from "@repo/contracts/asset-governance";
import { QueryClientTestWrapper } from "../render-with-query";
import { AdminNav } from "@/components/admin/admin-nav";
import {
  ADMIN_NAV_TESTID,
  ASSET_KIND_NAV_KEY,
  actualAssetNavKeys,
  diffAssetNav,
  expectedAssetNavKeys,
} from "@/components/admin/asset-kind-nav";
import { ADMIN_NAV, AI_CAPABILITY_GROUP } from "@/lib/mock/admin";

/* ══════════════════ §1 真实断言 ══════════════════ */

describe("§1 左栏「AI 能力」组 ↔ AssetKind：双向集合相等", () => {
  it("双向差集为空（今天的 ADMIN_NAV 与今天的契约）", () => {
    expect(diffAssetNav({ actual: actualAssetNavKeys(), expected: expectedAssetNavKeys() })).toEqual([]);
  });

  it("两侧都非空 —— 空集会让双向差集平凡为真", () => {
    expect(actualAssetNavKeys().length).toBeGreaterThan(0);
    expect(AssetKind.options.length).toBeGreaterThan(0);
  });

  it("六个入口是**渲染出来的事实**，不只是常量表里的字符串", () => {
    render(<AdminNav active="agent" />, { wrapper: QueryClientTestWrapper });
    for (const kind of AssetKind.options) {
      const testid = ADMIN_NAV_TESTID[ASSET_KIND_NAV_KEY[kind]];
      // 失败时消息里带 kind，好知道是哪一种资产没画出来
      expect(screen.queryByTestId(testid), `AssetKind「${kind}」的左栏入口 ${testid} 没渲染出来`)
        .not.toBeNull();
    }
    cleanup();
  });

  it("每个左栏入口都是可点的链接（补了入口却没有 href 等于没补）", () => {
    render(<AdminNav active="agent" />, { wrapper: QueryClientTestWrapper });
    for (const kind of AssetKind.options) {
      const el = screen.getByTestId(ADMIN_NAV_TESTID[ASSET_KIND_NAV_KEY[kind]]);
      expect(el.getAttribute("href"), `AssetKind「${kind}」的左栏入口没有 href`).toBeTruthy();
    }
    cleanup();
  });

  it("testid 表与项键一致（字面量表不许悄悄写错行）", () => {
    for (const [key, testid] of Object.entries(ADMIN_NAV_TESTID)) {
      expect(testid).toBe(`admin-nav-${key}`);
    }
  });

  it("ADMIN_NAV 里每一项都能在 testid 表里取到名字（新增项忘登记 ⇒ 渲染出 undefined）", () => {
    for (const g of ADMIN_NAV) {
      for (const item of g.items) {
        expect(ADMIN_NAV_TESTID[item.key], `左栏项「${item.key}」没在 ADMIN_NAV_TESTID 里登记`)
          .toBeTruthy();
      }
    }
  });

  it("组名单点声明：ADMIN_NAV 里确有这个组（组名漂了 ⇒ 门控会检查一个空组）", () => {
    expect(ADMIN_NAV.some((g) => g.group === AI_CAPABILITY_GROUP)).toBe(true);
  });

  /**
   * ⚠ 这里**刻意没有**「源码里不许出现 toHaveLength(N)」那条元断言。
   * 第一版写了，它当场把自己打红——红的原因不是有人写了长度断言，而是
   * `asset-kind-nav.ts` 里**解释「为什么不许写长度断言」的那句注释**命中了正则。
   * 这正是 coding-standards 记的那条：过度触发的门控会被静音。E-4 由 §2 的 R-6
   * 从行为侧守住（长度相同、成员不同 ⇒ 必须红），比扫源码文本可靠。
   */
});

/* ══════════════════ §2 反证套件 ══════════════════ */

const KINDS = AssetKind.options as readonly string[];
const OK_ACTUAL = actualAssetNavKeys();
const OK_EXPECTED = expectedAssetNavKeys();

describe("§2 反证：把任一侧改坏，门控必须红且点名", () => {
  it("R-1 从左栏删掉「项目蓝本」⇒ 红，且点名 blueprint", () => {
    const errors = diffAssetNav({
      actual: OK_ACTUAL.filter((k) => k !== "blueprint"),
      expected: OK_EXPECTED,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("[缺项]");
    expect(errors.join("\n")).toContain("blueprint");
    // 点名的是**缺的那一个**，不是笼统一句「集合不等」
    expect(errors.some((e) => e.includes("admin-nav-blueprint"))).toBe(true);
  });

  it("R-2 从左栏删掉「画布模板」⇒ 红，且点名 canvas-template / canvasadmin", () => {
    const errors = diffAssetNav({
      actual: OK_ACTUAL.filter((k) => k !== "canvasadmin"),
      expected: OK_EXPECTED,
    });
    expect(errors.some((e) => e.includes("[缺项]") && e.includes("canvas-template"))).toBe(true);
    expect(errors.some((e) => e.includes("admin-nav-canvasadmin"))).toBe(true);
  });

  it("R-3 往左栏加一个不在 AssetKind 里的项 ⇒ 红，且点名那一项", () => {
    const errors = diffAssetNav({ actual: [...OK_ACTUAL, "tarot"], expected: OK_EXPECTED });
    expect(errors.some((e) => e.includes("[多项]") && e.includes("tarot"))).toBe(true);
  });

  it("R-4a AssetKind 加了取值、映射表跟了、左栏没跟 ⇒ 红，且点名新取值", () => {
    const errors = diffAssetNav({
      actual: OK_ACTUAL,
      expected: expectedAssetNavKeys(
        [...KINDS, "workflow"],
        { ...ASSET_KIND_NAV_KEY, workflow: "workflowadmin" },
      ),
    });
    expect(errors.some((e) => e.includes("[缺项]") && e.includes("workflow"))).toBe(true);
  });

  it("R-4b AssetKind 加了取值、连映射表都没跟 ⇒ 红，且报缺映射", () => {
    const errors = diffAssetNav({
      actual: OK_ACTUAL,
      expected: expectedAssetNavKeys([...KINDS, "workflow"]),
    });
    expect(errors.some((e) => e.includes("[缺映射]") && e.includes("workflow"))).toBe(true);
  });

  it("R-4c AssetKind 删掉一个取值而左栏还画着 ⇒ 红（反向也要挡）", () => {
    const errors = diffAssetNav({
      actual: OK_ACTUAL,
      expected: expectedAssetNavKeys(KINDS.filter((k) => k !== "mcp")),
    });
    expect(errors.some((e) => e.includes("[多项]") && e.includes("mcp"))).toBe(true);
  });

  it("R-5 空集不许平凡为真：两侧都空 ⇒ 必须红", () => {
    const errors = diffAssetNav({ actual: [], expected: [] });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("[空集]");
  });

  it("R-5b 单侧为空也红（左栏空 / 契约空 各一次）", () => {
    expect(diffAssetNav({ actual: [], expected: OK_EXPECTED }).join("\n")).toContain("[空集]");
    expect(diffAssetNav({ actual: OK_ACTUAL, expected: [] }).join("\n")).toContain("[空集]");
  });

  it("R-6 六对六、长度相同、成员不同 ⇒ 必须红（这正是 toHaveLength 会漏掉的）", () => {
    const swapped = OK_ACTUAL.map((k) => (k === "blueprint" ? "tarot" : k));
    expect(swapped.length).toBe(OK_ACTUAL.length); // 长度一模一样
    const errors = diffAssetNav({ actual: swapped, expected: OK_EXPECTED });
    expect(errors.some((e) => e.includes("[缺项]") && e.includes("blueprint"))).toBe(true);
    expect(errors.some((e) => e.includes("[多项]") && e.includes("tarot"))).toBe(true);
  });

  it("R-7 只打乱顺序不算错 —— 本 feature 只锁集合，顺序待 Q-11 裁", () => {
    expect(diffAssetNav({ actual: [...OK_ACTUAL].reverse(), expected: OK_EXPECTED })).toEqual([]);
  });
});
