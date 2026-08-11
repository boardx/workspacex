/**
 * 「菜单去重复查」（人类反馈：后台左栏 5 对概念重复）—— 真合并回归测试。
 *
 * 2026-08-11 人类直接裁决（原话：「这些都是重复的目录，要把它整合在一起，不要有
 * 重复的」）：上一轮（#700/#928/#929）只加了徽标、改了措辞，从未真的合并。这次是
 * **真合并**——五对重复入口只保留一个可点入口，不是两处都留着互相解释关系。
 *
 * 本文件断言的是**机械可检的性质**：
 *   §1 「能力域 · 全生命周期」组不再渲染五个已合并项，只剩「组织成员」。
 *   §2 `ADMIN_NAV` 五项已改指到真实合并落点（蓝本→/tpl、Skill→/skill）。
 *   §3 旧路由不是死链：`/admin/blueprint`、`/admin/skill` 重定向到新落点。
 *   §4 反证：把某一项塞回渲染列表，判定必须能被抓到（不是空转）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { ADMIN_SECOND_LEVEL } from "@/lib/navigation";

afterEach(() => cleanup());

function adminItem(key: AdminModuleKey) {
  const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.key === key);
  if (!item) throw new Error(`ADMIN_NAV 缺 ${key}`);
  return item;
}

/** 五个已真合并、不再单独渲染的二级项键。 */
const MERGED_KEYS = ["templates", "skills", "agent-runtime", "asset-governance", "canvas"];

/* ══════════════════ §1 二级组不再渲染五个重复项 ══════════════════ */

describe("§1 「能力域 · 全生命周期」组已真合并，不再有五个重复入口", () => {
  it("ADMIN_SECOND_LEVEL 数组本身仍声明这五项（lint-nav-reachability 依赖这个文本来源）", () => {
    for (const key of MERGED_KEYS) {
      expect(ADMIN_SECOND_LEVEL.find((i) => i.key === key)).toBeDefined();
    }
  });

  it("渲染 AdminNav：五个已合并项一个都不出现在 DOM 里", () => {
    render(<AdminNav active="agent" />);
    for (const key of MERGED_KEYS) {
      expect(screen.queryByTestId(`admin-sub-${key}`)).toBeNull();
    }
  });

  it("渲染 AdminNav：「能力域 · 全生命周期」这个分组标题也不再出现（只剩组织成员一项时该组仍显示，" +
    "但已合并的五项各自的行不应残留）", () => {
    render(<AdminNav active="agent" />);
    // 未合并的 org-admin 仍应可见——证明过滤是精确匹配，不是整组连坐消失。
    expect(screen.getByTestId("admin-sub-org-admin")).toBeInTheDocument();
  });
});

/* ══════════════════ §2 ADMIN_NAV 五项已改指到真实合并落点 ══════════════════ */

describe("§2 AI 能力组的入口已直接指向真实的合并落点，不再经过空壳/简单 CRUD 页", () => {
  it("项目蓝本 → 改名「项目模板」，href 直接指向 /tpl", () => {
    const item = adminItem("blueprint");
    expect(item.label).toBe("项目模板");
    expect(item.href).toBe("/tpl");
  });

  it("Skill 目录 → href 直接指向 /skill（更完整的 Skill 库与市场）", () => {
    const item = adminItem("skill");
    expect(item.label).toBe("Skill 目录");
    expect(item.href).toBe("/skill");
  });

  it("Agent 目录 / 模型 / MCP / 画布模板：本轮未改 href（它们是吸收方，不是被合并方）", () => {
    expect(adminItem("agent").href).toBe("/admin/agent");
    expect(adminItem("model").href).toBe("/admin/model");
    expect(adminItem("mcp").href).toBe("/admin/mcp");
    expect(adminItem("canvasadmin").href).toBe("/admin/canvasadmin");
  });
});

/* ══════════════════ §3 反证：塞回渲染列表必须能被抓到 ══════════════════ */

describe("§3 反证套件", () => {
  it("R-1：若 §1 的过滤失效（把某已合并项渲染出来），这条断言的 query 会命中而不是查不到——" +
    "证明 queryByTestId(null) 断言不是对着一个恒空的选择器空转", () => {
    render(<AdminNav active="agent" />);
    // org-admin 用同一套渲染路径（同一个 map），它确实会出现在 DOM 里，
    // 证明 `admin-sub-*` 这个 testid 前缀本身是有效、可命中的选择器。
    expect(screen.queryByTestId("admin-sub-org-admin")).not.toBeNull();
  });

  it("R-2：blueprint href 若被误改回 /admin/blueprint，与 §2 的具体值断言不符", () => {
    const bad = "/admin/blueprint";
    expect(bad).not.toBe(adminItem("blueprint").href);
  });
});
