import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { templates } from "@repo/contracts";
import {
  DESIGN_FACET_DEFINITIONS,
  DESIGN_FACET_GROUPS,
  designFacetKeys,
  designFacetsByGroup,
  isDesignFacetKey,
  orderedDesignFacets,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import {
  listDesignFacetDefinitions,
  listDesignFacetGroups,
} from "../../src/application/templates/list-design-facet-definitions";
import {
  canBindNewProject,
  canInstantiateExistingBinding,
  displayVersionNumber,
  nextVersionNumber,
  rollbackToVersion,
  versionNumbersSatisfyI3,
  type BlueprintVersion,
} from "../../src/domain/templates/blueprint-version";

/**
 * F17 —— **配置项定义表驱动的槽位**，以及蓝本/版本领域模型。
 *
 * 三个断言面，缺一不可：
 *  ① 槽位**从表派生**：改表 ⇒ 槽位跟着变（这里用参数化的表证明）。
 *  ② 没有第二份表：`lint-design-facet-single-source.mjs` 的**捕获能力**被断言，
 *     不是它的退出码——空目录下它「零违规」退出 0，那是本仓发生过九次的空转失败模式。
 *  ③ 版本模型的 I-3 / I-7 / O-18 ②。
 */

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const GATE = join(ROOT, "apps/api/scripts/lint-design-facet-single-source.mjs");

function runGate(...args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: ROOT, encoding: "utf8", stdio: "pipe" }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const num = (out: string, field: string) => Number(new RegExp(`${field}=(\\d+)`).exec(out)?.[1] ?? "-1");

describe("槽位由定义表派生（I-5）", () => {
  it("槽位清单恒等于表里的行，逐行一一对应", () => {
    expect(designFacetKeys()).toEqual(orderedDesignFacets().map((r) => r.designFacetKey));
    // 空表下这条会平凡为真——所以先证明表不是空的。
    expect(DESIGN_FACET_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it("改表 ⇒ 槽位自动跟着变（加一行、删一行，两个方向都试）", () => {
    const extra: DesignFacetRow = {
      designFacetKey: "a-brand-new-slot",
      label: "新槽位",
      group: "output",
      ordinal: 99,
      required: false,
    };
    const grown = [...DESIGN_FACET_DEFINITIONS, extra];
    expect(designFacetKeys(grown)).toHaveLength(designFacetKeys().length + 1);
    expect(designFacetKeys(grown)).toContain("a-brand-new-slot");

    const shrunk = DESIGN_FACET_DEFINITIONS.slice(1);
    expect(designFacetKeys(shrunk)).toHaveLength(designFacetKeys().length - 1);
  });

  it("未在表中声明的 key 不是槽位（封闭性，不是「长度对了就行」）", () => {
    expect(isDesignFacetKey("a-brand-new-slot")).toBe(false);
    for (const row of DESIGN_FACET_DEFINITIONS) expect(isDesignFacetKey(row.designFacetKey)).toBe(true);
  });

  it("每一行的 key 唯一 —— 重复 key 会让完成度的分子分母各算各的", () => {
    const keys = designFacetKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("五组是封闭枚举（I-20）", () => {
  it("每一行都落在五组之内，且五个桶恒存在（空组也出现）", () => {
    // 断言集合相等而不是 toHaveLength(5)：要守的性质是封闭性，成员数不是
    // （contract-design.md §五 第 7 条：经 ADR 评审的正当新增不该被自己的测试拦下）。
    const declared = new Set<string>(DESIGN_FACET_GROUPS);
    const used = new Set(DESIGN_FACET_DEFINITIONS.map((r) => r.group));
    for (const g of used) expect(declared.has(g)).toBe(true);

    const buckets = designFacetsByGroup();
    expect(new Set(Object.keys(buckets))).toEqual(declared);
    expect(listDesignFacetGroups().map((g) => g.group)).toEqual([...DESIGN_FACET_GROUPS]);
  });

  it("分组视图里的行数合计 = 表的行数（没有行被分丢，也没有行被数两次）", () => {
    const total = listDesignFacetGroups().reduce((n, g) => n + g.items.length, 0);
    expect(total).toBe(DESIGN_FACET_DEFINITIONS.length);
  });
});

describe("接口投影与契约同源", () => {
  it("每一行都能被契约的 DesignFacetDefinition 解析（.strict()，多一字段就会被拒）", () => {
    const { items } = listDesignFacetDefinitions();
    expect(items.length).toBe(DESIGN_FACET_DEFINITIONS.length);
    for (const item of items) {
      const parsed = templates.DesignFacetDefinition.safeParse(item);
      expect(parsed.success, JSON.stringify(item)).toBe(true);
    }
  });

  it("整个响应体被契约 out 校验 —— 返回方向也要受契约管（contract-design.md §五 第 6 条）", () => {
    const out = templates.operations.listDesignFacetDefinitions.out.safeParse(listDesignFacetDefinitions());
    expect(out.success, JSON.stringify(out.success ? {} : out.error.issues)).toBe(true);
  });

  it("反向断言：契约确实会拒绝漂移的响应体（否则上面两条可能在空转）", () => {
    const good = listDesignFacetDefinitions();
    // 把领域侧的 group 带进响应体 —— 这正是「契约带不动分组」那条缺口的形状
    const withGroup = { ...good, items: good.items.map((i) => ({ ...i, group: "basic" })) };
    expect(templates.operations.listDesignFacetDefinitions.out.safeParse(withGroup).success).toBe(false);
    // 分母缺失 / 非正数也必须被拒
    expect(templates.operations.listDesignFacetDefinitions.out.safeParse({ items: good.items }).success).toBe(false);
    expect(
      templates.operations.listDesignFacetDefinitions.out.safeParse({ items: good.items, denominator: 0 }).success,
    ).toBe(false);
  });
});

describe("没有第二份定义表（机械门控）", () => {
  it("门控真的扫了源码树，并且真的解析到了唯一事实源", () => {
    const r = runGate();
    expect(num(r.out, "scanned"), "扫了 0 个文件 —— 门控在空转").toBeGreaterThan(0);
    expect(num(r.out, "keys"), "解析到 0 个 key —— 门控对什么都不会开火").toBe(DESIGN_FACET_DEFINITIONS.length);
    expect(num(r.out, "groups")).toBe(DESIGN_FACET_GROUPS.length);
    expect(r.code, r.out).toBe(0);
  });

  it("反证：四条规则各自都能抓到人，且说得出为什么", () => {
    const r = runGate("apps/api/__fixtures__/design-facet-bad");
    expect(r.code, "坏夹具必须让门控变红").toBe(1);
    expect(r.out).toContain("hardcoded completeness denominator");
    expect(r.out).toContain("second design-facet group list");
    expect(r.out).toContain("second design-facet slot list");
    // 这一条是第一版规则漏掉的那种：每行一个 key 的表，单行规则对它完全沉默。
    expect(r.out).toContain("second design-facet definition table spread over multiple lines");
    expect(num(r.out, "violations")).toBe(4);
  });

  it("不过度开火：读表派生的正确写法必须通过", () => {
    const r = runGate("apps/api/__fixtures__/design-facet-good");
    expect(r.code, r.out).toBe(0);
    expect(num(r.out, "scanned")).toBeGreaterThan(0);
  });

  it("已知的第二份副本规模被钉死（原型 mock，不许悄悄长大）", () => {
    // 现存 8 处全部落在 apps/web 的原型 mock 与读它的原型界面里。
    // 哪张表对是**人类裁决**（O-07 第 16 项 / D-2 required 清单 / KNOWN_CONTRACT_GAPS.T3），
    // 所以这里钉的是「不许再多」，不是「已经解决」。数字变大 ⇒ 有人又抄了一份。
    const r = runGate();
    expect(num(r.out, "debt")).toBe(8);
    expect(num(r.out, "violations")).toBe(0);
  });
});

describe("版本领域模型", () => {
  const v = (n: number, state: BlueprintVersion["state"] = "published"): BlueprintVersion => ({
    id: `v${n}`,
    blueprintId: "bp-1",
    versionNumber: n,
    content: { title: `t${n}` },
    changedDesignFacetKeys: [],
    rolledBackFrom: null,
    state,
  });

  it("I-3：下一个号取历史最大 + 1，归档与回滚都不让它倒退或复用", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([v(1), v(2), v(3)])).toBe(4);
    // 归档旧版不缩号：按「已发布数 + 1」算会在这里复用 3
    expect(nextVersionNumber([v(1, "archived"), v(2, "archived"), v(3)])).toBe(4);
    expect(versionNumbersSatisfyI3([v(1), v(2), v(3)])).toBe(true);
    // 反证：缺号与复用都必须判假，否则这条断言什么都没查
    expect(versionNumbersSatisfyI3([v(1), v(3)])).toBe(false);
    expect(versionNumbersSatisfyI3([v(1), v(2), v(2)])).toBe(false);
  });

  it("O-18 ②：回滚产生**新版本**，号只增不减，且记得从哪一版回来的", () => {
    const history = [v(1), v(2), v(3), v(4), v(5)];
    const rolled = rollbackToVersion(history, history[2]!, "v6");
    expect(rolled.versionNumber).toBe(6);
    expect(rolled.content).toEqual(history[2]!.content);
    expect(rolled.rolledBackFrom).toBe("v3");
    // 「当前版本指针被改回 v3」这个状态不存在：历史一条没少，也一条没被改写
    expect(history.map((x) => x.versionNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it("I-7：归档禁止**新增**绑定，但存量绑定照样能实例化", () => {
    const archived = v(4, "archived");
    expect(canBindNewProject(archived)).toBe(false);
    // 这一条是防现场跑挂的关键：归档即禁止实例化，进行中的工作坊切议程环节会当场失败
    expect(canInstantiateExistingBinding(archived)).toBe(true);
    expect(canBindNewProject(v(5))).toBe(true);
  });

  it("草稿态不显示版本号（uc-2-4 R7），且不是显示成 0", () => {
    expect(displayVersionNumber("draft", v(3))).toBeNull();
    expect(displayVersionNumber("published", null)).toBeNull();
    expect(displayVersionNumber("published", v(3))).toBe(3);
  });
});
