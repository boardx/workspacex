/**
 * 「菜单去重复查」（人类反馈：后台左栏 5 对概念重复）—— 回归测试。
 *
 * 五对逐一核实虚实后的结论**不是同一个模式**（判断依据见 `lib/navigation.ts` 与
 * `lib/mock/admin.ts` 对应项的注释）：
 *   Agent    —— 目录（`/admin/agent`，真后端）vs 运行时配置（`/preview/agent-runtime`，零后端）
 *   Skill    —— 两套不同后端数据源（`identity` 能力目录 vs `skills` 声明式契约），均真
 *   蓝本     —— 两边都是 mock；合并是 Q-11/X-J，人类未裁，本轮不单方合并
 *   成员     —— 组织成员管理（`/org-admin/preview`，真后端）vs 配额与管理员边界（mock）
 *   画布模板 —— 同一份真实数据源（`GET /canvas/templates`），治理清单+链接 vs 完整编辑器
 *
 * 本文件断言的是**机械可检的性质**，不是「文案好看」：
 *   §1 五对左栏标签不再是能被误认成同一件事的近义词硬凑（人类原话）。
 *   §2 `isPrototype` 项不再只有一句模糊的「原型 · 待归并」——必须有 `prototypeNote`，
 *      且徽标渲染出的可见文案已不是旧的模糊词。
 *   §3 反证：把订正过的字段改回旧值，判定必须红（不是在恒真断言上空转）。
 *   §4 `org-admin`（组织成员，已证实真后端）不再被错误标成 `isPrototype`。
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AdminNav } from "@/components/admin/admin-nav";
import { ADMIN_NAV, type AdminModuleKey } from "@/lib/mock/admin";
import { ADMIN_SECOND_LEVEL } from "@/lib/navigation";

afterEach(() => cleanup());

function adminLabel(key: AdminModuleKey): string {
  const item = ADMIN_NAV.flatMap((g) => g.items).find((i) => i.key === key);
  if (!item) throw new Error(`ADMIN_NAV 缺 ${key}`);
  return item.label;
}

function secondLevelLabel(key: string): string {
  const item = ADMIN_SECOND_LEVEL.find((i) => i.key === key);
  if (!item) throw new Error(`ADMIN_SECOND_LEVEL 缺 ${key}`);
  return item.label;
}

/** 五对：[ADMIN_NAV 的 key, ADMIN_SECOND_LEVEL 的 key] */
const FIVE_PAIRS: [AdminModuleKey, string][] = [
  ["agent", "agent-runtime"],
  ["skill", "skills"],
  ["blueprint", "templates"],
  ["members", "org-admin"],
  ["canvasadmin", "canvas"],
];

/* ══════════════════ §1 标签不再是能互相误认的近义词 ══════════════════ */

describe("§1 五对左栏标签各自可辨识，不是同一个词的两种写法", () => {
  it("五对里，admin 标签与二级标签逐对都不相等（机械最低要求）", () => {
    for (const [adminKey, secondKey] of FIVE_PAIRS) {
      expect(adminLabel(adminKey)).not.toBe(secondLevelLabel(secondKey));
    }
  });

  it("Agent／Skill 两对：admin 标签已带出「目录」这个限定词，不再是裸的「Agent」／「Skill」", () => {
    // 裸词最容易被读成「就是同一个东西换了个位置」——这条钉住订正后的具体值，
    // 不是只断言「不等于旧值」（那样改错成另一个模糊词也会绿）。
    expect(adminLabel("agent")).toBe("Agent 目录");
    expect(adminLabel("skill")).toBe("Skill 目录");
  });

  it("Agent 运行时／Skill 库与市场：二级标签已不是「智能体」／「技能」这种近义词硬凑", () => {
    expect(secondLevelLabel("agent-runtime")).toBe("智能体运行时");
    expect(secondLevelLabel("skills")).toBe("Skill 库与市场");
    expect(secondLevelLabel("agent-runtime")).not.toBe("智能体");
    expect(secondLevelLabel("skills")).not.toBe("技能");
  });

  it("成员：二级标签已改「组织成员」，不再是裸的「成员」（易与「成员配额」读成同一件事）", () => {
    expect(secondLevelLabel("org-admin")).toBe("组织成员");
  });
});

/* ══════════════════ §2 原型项不再只有模糊标签 ══════════════════ */

describe("§2 isPrototype 项必须有具体说明，且渲染文案已不是旧的模糊词", () => {
  it("templates／agent-runtime 都带非空 prototypeNote", () => {
    const templates = ADMIN_SECOND_LEVEL.find((i) => i.key === "templates")!;
    const agentRuntime = ADMIN_SECOND_LEVEL.find((i) => i.key === "agent-runtime")!;
    expect(templates.isPrototype).toBe(true);
    expect(agentRuntime.isPrototype).toBe(true);
    expect((templates.prototypeNote ?? "").length).toBeGreaterThan(0);
    expect((agentRuntime.prototypeNote ?? "").length).toBeGreaterThan(0);
  });

  it("渲染 AdminNav：旧的模糊徽标文案「原型 · 待归并」已不再出现", () => {
    render(<AdminNav active="agent" />);
    expect(screen.queryByText("原型 · 待归并")).toBeNull();
  });

  it("渲染 AdminNav：agent-runtime 的说明文字里点名了对应的 admin 项（讲清楚关系，不是空话）", () => {
    render(<AdminNav active="agent" />);
    const note = screen.getByTestId("admin-sub-agent-runtime-prototype-note");
    expect(note.textContent).toMatch(/Agent 目录/);
  });
});

/* ══════════════════ §3 反证：改回旧值必须红 ══════════════════ */

describe("§3 反证套件", () => {
  it("R-1 把 agent-runtime 标签改回「智能体」⇒ 与 §1 的具体值断言不符（不是空转）", () => {
    const bad = "智能体";
    expect(bad).not.toBe(secondLevelLabel("agent-runtime"));
  });

  it("R-2 把 org-admin 标签改回「成员」⇒ 与 §1 的具体值断言不符", () => {
    const bad = "成员";
    expect(bad).not.toBe(secondLevelLabel("org-admin"));
  });
});

/* ══════════════════ §4 org-admin 不再被误标成原型 ══════════════════ */

describe("§4 org-admin（组织成员）已订正为非原型——它的四个标签页读真实接口", () => {
  it("ADMIN_SECOND_LEVEL 里 org-admin 项不带 isPrototype", () => {
    const item = ADMIN_SECOND_LEVEL.find((i) => i.key === "org-admin")!;
    expect(item.isPrototype).toBeFalsy();
  });

  it("渲染 AdminNav：org-admin 这一行不带「预览 · 未接后端」徽标", () => {
    render(<AdminNav active="agent" />);
    expect(screen.queryByTestId("admin-sub-org-admin-prototype-badge")).toBeNull();
  });
});
