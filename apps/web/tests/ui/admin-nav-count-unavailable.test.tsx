/**
 * F133 —— 左栏计数与组织额度条：取不到显示「—」而不是 0，单类计数失败不拖垮整个左栏。
 *
 * ## 这条 feature 的本体就是错误处理的容错性
 *
 * `asset-governance` 契约 `listAdminNav.out.groups[].items[].count` 是
 * `number | "—"` 的联合，`null` 不合法。「—」＝取不到，`0` ＝查询成功且恰好为空——
 * 合并成 0 会让一次后端故障看起来像一个空目录，用户不会去报障，他会以为东西还没建。
 *
 * §1 正常路径：所有来源都健康时，每一项显示的是真实数字（不是随手写的占位符）。
 * §2 反证：把某一项的数据源改成抛错——
 *   - 该项必须显示「—」，不是 0、不是崩溃。
 *   - **其余项必须仍显示数字**——只断言「—」出现，一个整体 catch 一次、
 *     全员判「—」的实现也会绿，必须同时断言兄弟项没被拖下水。
 * §3 单元测试覆盖 `resolveAdminNavCount` / `resolveAdminNavCounts` 本身的边界
 *   （抛错、NaN、负数、小数——这些都不是「合法但为 0」，都该算取不到）。
 */
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminNavForScope, ADMIN_NAV_COUNT_SOURCES } from "@/lib/mock/admin";
import { ADMIN_NAV_TESTID } from "@/components/admin/asset-kind-nav";
import {
  resolveAdminNavCount,
  resolveAdminNavCounts,
  type AdminNavCountSource,
} from "@/lib/admin-nav-counts";

// 2026-09-02 后台切成两面：`AdminNav` 只画 active 所属面的项；本文件 active 全是 AI 能力项（平台面），所以只遍历平台面的键。
const ALL_KEYS = adminNavForScope("platform").flatMap((g) => g.items.map((i) => i.key));

/* ══════════════════ §1 正常路径 ══════════════════ */

/**
 * ⚠ #881 起 `AdminNav` 的**缺省**计数来源不再是 `ADMIN_NAV_COUNT_SOURCES`（静态 mock），
 * 而是当前组织的真实计数（口径未裁决的项一律「—」）。
 * 本节验的是「渲染出的数字 == 其来源求值结果」这条**装配**不变量，与来源是谁无关，
 * 所以这里把健康来源**显式注入**——这既保持了原意，也让本节不再隐式依赖那个已经改掉的缺省值。
 */
const HEALTHY = ADMIN_NAV_COUNT_SOURCES;

describe("§1 一切健康时：每一项显示真实数字", () => {
  it("渲染出的每一项计数，与其数据源当场求值的结果一致", () => {
    render(<AdminNav active="agent" countSources={HEALTHY} />);
    for (const key of ALL_KEYS) {
      const expected = ADMIN_NAV_COUNT_SOURCES[key]();
      const el = screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`);
      expect(el.textContent, `左栏项「${key}」的计数与其数据源不一致`).toBe(String(expected));
    }
    cleanup();
  });

  it("健康路径下不出现「—」——反证套件才应该看到它", () => {
    render(<AdminNav active="agent" countSources={HEALTHY} />);
    for (const key of ALL_KEYS) {
      expect(screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`).textContent).not.toBe("—");
    }
    cleanup();
  });
});

/* ══════════════════ §2 反证：单类失败不拖垮整个左栏 ══════════════════ */

describe("§2 反证：把一个数据源改成抛错", () => {
  it("挂掉的那一项显示「—」，且其余项仍显示各自的真实数字（不是全员「—」）", () => {
    const broken: Record<string, AdminNavCountSource> = { ...ADMIN_NAV_COUNT_SOURCES };
    broken.mcp = () => {
      throw new Error("MCP 计数查询超时（模拟故障）");
    };
    render(<AdminNav active="mcp" countSources={broken as typeof ADMIN_NAV_COUNT_SOURCES} />);

    // 挂掉的那一项：「—」，不是 0、不是崩溃
    expect(screen.getByTestId(`${ADMIN_NAV_TESTID.mcp}-count`).textContent).toBe("—");

    // 其余项：照常显示数字——这才是「单类失败不拖垮整个左栏」的可检验形式。
    // 只断言 mcp 是「—」的测试，一个「catch 一次、全员判—」的实现也会绿；
    // 这里逐一断言兄弟项**不是**「—」，且等于各自数据源的真实值。
    for (const key of ALL_KEYS) {
      if (key === "mcp") continue;
      const expected = ADMIN_NAV_COUNT_SOURCES[key]();
      const el = screen.getByTestId(`${ADMIN_NAV_TESTID[key]}-count`);
      expect(el.textContent, `mcp 计数失败后，「${key}」不应受影响`).toBe(String(expected));
      expect(el.textContent).not.toBe("—");
    }
    cleanup();
  });

  it("换一个不同的项抛错（agent），验证失败点会跟着换而不是恒定的某一项", () => {
    const broken: Record<string, AdminNavCountSource> = { ...ADMIN_NAV_COUNT_SOURCES };
    broken.agent = () => {
      throw new Error("Agent 计数查询挂了（模拟故障）");
    };
    render(<AdminNav active="agent" countSources={broken as typeof ADMIN_NAV_COUNT_SOURCES} />);

    expect(screen.getByTestId(`${ADMIN_NAV_TESTID.agent}-count`).textContent).toBe("—");
    // mcp 这次没坏，必须显示数字
    expect(screen.getByTestId(`${ADMIN_NAV_TESTID.mcp}-count`).textContent).toBe(
      String(ADMIN_NAV_COUNT_SOURCES.mcp()),
    );
    cleanup();
  });

  it("组件不因单项抛错而崩溃或整体不渲染（左栏其余部分仍在 DOM 里）", () => {
    const broken: Record<string, AdminNavCountSource> = { ...ADMIN_NAV_COUNT_SOURCES };
    broken.skill = () => {
      throw new Error("Skill 计数查询挂了");
    };
    expect(() =>
      render(<AdminNav active="skill" countSources={broken as typeof ADMIN_NAV_COUNT_SOURCES} />),
    ).not.toThrow();
    expect(screen.getByTestId("admin-nav")).toBeTruthy();
    // 所有六个 + 四个入口本身仍然都渲染出来了（F132 的双向断言不能被本 feature 带崩）
    for (const key of ALL_KEYS) {
      expect(screen.getByTestId(ADMIN_NAV_TESTID[key])).toBeTruthy();
    }
    cleanup();
  });
});

/* ══════════════════ §3 resolveAdminNavCount(s) 本身的边界 ══════════════════ */

describe("§3 resolveAdminNavCount：「—」与 0 是两件事", () => {
  it("抛错 ⇒ 「—」", () => {
    expect(
      resolveAdminNavCount(() => {
        throw new Error("boom");
      }),
    ).toBe("—");
  });

  it("真实返回 0 ⇒ 就是 0，不被误判成「—」（这是本 feature 最容易踩的反例）", () => {
    expect(resolveAdminNavCount(() => 0)).toBe(0);
  });

  it("返回正整数 ⇒ 原样返回", () => {
    expect(resolveAdminNavCount(() => 42)).toBe(42);
  });

  it("返回 NaN / 负数 / 小数 ⇒ 按「取不到」处理，不把畸形值画给用户", () => {
    expect(resolveAdminNavCount(() => Number.NaN)).toBe("—");
    expect(resolveAdminNavCount(() => -1)).toBe("—");
    expect(resolveAdminNavCount(() => 3.5)).toBe("—");
  });

  it("resolveAdminNavCounts：逐项独立求值，一项抛错不影响字典里的其余键", () => {
    const result = resolveAdminNavCounts({
      ok1: () => 3,
      broken: () => {
        throw new Error("fail");
      },
      ok2: () => 0,
    });
    expect(result).toEqual({ ok1: 3, broken: "—", ok2: 0 });
  });

  it("反证：一个「整体 try/catch 一次」的实现会让后面的项也被拖累——本函数不能是那种写法", () => {
    // 模拟：如果实现是「for 循环里第一个抛错就 break/return，导致后面的键根本没有条目」，
    // 这里会直接失败，因为 ok-after 缺失。
    const result = resolveAdminNavCounts({
      broken: () => {
        throw new Error("fail early");
      },
      "ok-after": () => 7,
    });
    expect(result["ok-after"]).toBe(7);
  });
});
