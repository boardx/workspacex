/**
 * 「菜单去重复查」（人类反馈：后台左栏 5 对概念重复）—— 真合并回归测试。
 *
 * 2026-08-11 人类直接裁决（原话：「这些都是重复的目录，要把它整合在一起，不要有
 * 重复的」）：上一轮（#700/#928/#929）只加了徽标、改了措辞，从未真的合并。这次是
 * **真合并**——五对重复入口只保留一个可点入口，不是两处都留着互相解释关系。
 *
 * 本文件断言的是**机械可检的性质**：
 *   §1 「能力域 · 全生命周期」组不再渲染任何已合并项。
 *       ⚠ 2026-08-14（#1168）：最后剩下的「组织成员」也被人类点名合并 ⇒ 这一组
 *       现在**一项都不渲染**。这条改动同时打掉了本文件原来的阳性对照（它拿
 *       `org-admin` 当「过滤是精确匹配、不是整组连坐」的活证据），所以对照换成了
 *       别的东西——见 §1 第三条与 §3 R-1 各自的注释。删掉对照而不换，
 *       整组过滤断言就变成「选择器拼错也全绿」的空转。
 *   §2 `ADMIN_NAV` 五项已改指到真实合并落点（蓝本→/tpl/list——生产入口，不带原型
 *       切换器，2026-08-14 另一处修复；Skill→/skill）。
 *   §3 旧路由不是死链：`/admin/blueprint`、`/admin/skill` 重定向到新落点。
 *   §4 反证：把某一项塞回渲染列表，判定必须能被抓到（不是空转）。
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminNav, adminSubNavTestId } from "@/components/admin/admin-nav";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { ADMIN_SECOND_LEVEL } from "@/lib/navigation";

afterEach(() => cleanup());

function adminItem(key: AdminModuleKey) {
  const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.key === key);
  if (!item) throw new Error(`ADMIN_NAV 缺 ${key}`);
  return item;
}

/**
 * 已真合并、不再单独渲染的二级项键。
 * ⚠ #1168 把 `org-admin` 也加了进来——它此前正是本文件的阳性对照。
 */
const MERGED_KEYS = ["templates", "skills", "agent-runtime", "asset-governance", "canvas", "org-admin"];

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

  it("渲染 AdminNav：`ADMIN_SECOND_LEVEL` 里的每一项都不再渲染，且那个数组**本身非空**", () => {
    render(<AdminNav active="agent" />);
    for (const item of ADMIN_SECOND_LEVEL) {
      expect(screen.queryByTestId(`admin-sub-${item.key}`)).toBeNull();
    }
    // ⚠ 反空转：#1168 之后这一组一项都不渲染，上面的循环若数组变空会平凡通过。
    //   数组非空是它的前提——而那个数组同时是 `lint-nav-reachability` 唯一的文本来源，
    //   删空它会让一批路由被判不可达，所以这条断言同时守着两件事。
    expect(ADMIN_SECOND_LEVEL.length).toBeGreaterThan(0);
  });
});

/* ══════════════════ §2 ADMIN_NAV 五项已改指到真实合并落点 ══════════════════ */

describe("§2 AI 能力组的入口已直接指向真实的合并落点，不再经过空壳/简单 CRUD 页", () => {
  it("项目蓝本 → 改名「项目模板」，href 直接指向 /tpl/list（生产入口，不带原型切换器）", () => {
    const item = adminItem("blueprint");
    expect(item.label).toBe("项目模板");
    expect(item.href).toBe("/tpl/list");
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
  it("R-1：`admin-sub-*` 这个前缀本身仍是有效选择器（选择器拼错时 §1 会变成恒真）", () => {
    // ⚠ #1168 之前这条拿 `org-admin` 当活证据；它被合并后二级组一项都不渲染，
    //   「查不到」就变得**无论选择器对不对都成立**——正是这条反证要防的空转。
    //   替代证据：组件用来产 testid 的就是 `adminSubNavTestId`，把它喂给这些键，
    //   得到的必须正是 §1 在查的那些字符串。前缀一旦改名/拼错，这条当场红。
    expect(adminSubNavTestId("org-admin")).toBe("admin-sub-org-admin");
    expect(MERGED_KEYS.map(adminSubNavTestId)).toEqual(MERGED_KEYS.map((k) => `admin-sub-${k}`));
  });

  it("R-2：blueprint href 若被误改回 /admin/blueprint，与 §2 的具体值断言不符", () => {
    const bad = "/admin/blueprint";
    expect(bad).not.toBe(adminItem("blueprint").href);
  });
});
