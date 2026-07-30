import { describe, expect, it } from "vitest";
import { canvas } from "@repo/contracts";
import { listTemplates } from "@repo/fabric-markdown/templates";

/**
 * F100 —— 模板注册表：19 个内置 A0 模板的 `key` + `displayName` 契约（I-1 / I-2 / I-3 / I-36）。
 *
 * ## 这份测试在防什么
 *
 * O-09 把一个双源冲突闭合成了「不改 key、加 `displayName`」，代价是从此有**两个地方**
 * 谈论同一批模板：`@repo/fabric-markdown` 的源码（key 的权威，164 个既有单测按它断言）
 * 与 `packages/contracts/src/canvas.ts` 的 `BUILTIN_CANVAS_TEMPLATES`（displayName 的权威）。
 * 两处一旦漂移，**不会有任何类型错误**——绑定会在运行时找不到模板，而那时已经在现场了。
 * 这份测试就是把两者钉死的那颗钉子。
 *
 * ## 为什么不写 `toHaveLength(19)`
 *
 * ① 长度断言会把「按 ADR 正当新增第 20 个内置模板」变成红，于是债务上限成了移动靶；
 * ② 把 19 个 key 整批换成另外 19 个，长度断言**照样绿**——它根本没在断言身份。
 * 这里断言的是**集合相等**，且失败时逐 key 点名差集（缺了谁 / 多了谁）。
 *
 * ## 空集陷阱
 *
 * 集合相等在「两边都空」时平凡为真。若哪天 `listTemplates()` 因为副作用注册顺序变化
 * 而返回空数组，一条朴素的 `expect(a).toEqual(b)` 会**变绿**——这正是本仓九次
 * 「全绿但空转」的形状。所以：`assertSameKeySet` 自带非空前置断言，
 * 且下方有一条测试**证明它在空集上会抛**（不是相信它会）。
 */

/** 两个 key 集合必须相等，且都非空。失败时点名差集，不报长度。 */
function assertSameKeySet(
  declared: readonly string[],
  derived: readonly string[],
  labels: { declared: string; derived: string },
): void {
  // —— 空集守卫：没有它，整条断言在两边都空时平凡为真 ——
  if (declared.length === 0 || derived.length === 0) {
    throw new Error(
      `vacuous set-equality: ${labels.declared}=${declared.length} 条、` +
        `${labels.derived}=${derived.length} 条；空集不算通过`,
    );
  }
  const a = new Set(declared);
  const b = new Set(derived);
  const missing = [...a].filter((k) => !b.has(k)).sort();
  const extra = [...b].filter((k) => !a.has(k)).sort();
  const report = [
    missing.length ? `${labels.derived} 缺少：${missing.join(", ")}` : "",
    extra.length ? `${labels.derived} 多出（${labels.declared} 未声明）：${extra.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  expect(report, report).toBe("");
}

const declaredKeys = Object.keys(canvas.BUILTIN_CANVAS_TEMPLATES);
const libraryKeys = listTemplates().map((t) => t.key);

describe("F100 · 内置模板注册表（I-2 / I-36）", () => {
  it("契约声明的 key 集合 ≡ fabric-markdown 源码注册的 key 集合（集合相等，逐 key 点名差集）", () => {
    assertSameKeySet(declaredKeys, libraryKeys, {
      declared: "契约 BUILTIN_CANVAS_TEMPLATES",
      derived: "@repo/fabric-markdown 源码注册表",
    });
  });

  it("空集不算通过 —— 集合相等断言不会在两边都空时平凡为真", () => {
    // 这条测试的对象是**上面那条断言的判据本身**。没有它，assertSameKeySet 的空集守卫
    // 只是一段没人执行过的代码，而「没被执行过的守卫」在本仓等同于不存在。
    expect(() => assertSameKeySet([], [], { declared: "左", derived: "右" })).toThrow(
      /vacuous set-equality/,
    );
    // 单边为空同样必须红（否则「库注册表塌成空」会被误判为一致）
    expect(() => assertSameKeySet(["persona"], [], { declared: "左", derived: "右" })).toThrow(
      /vacuous set-equality/,
    );
    expect(() => assertSameKeySet([], ["persona"], { declared: "左", derived: "右" })).toThrow(
      /vacuous set-equality/,
    );
  });

  it("集合相等断言在「换成另外一批同样多的 key」时会红（不是在断言长度）", () => {
    // 反证内置：若判据退化成 toHaveLength，下面这行会绿。它必须红。
    const decoys = declaredKeys.map((k) => `${k}-decoy`);
    expect(() =>
      assertSameKeySet(declaredKeys, decoys, { declared: "契约", derived: "冒名集合" }),
    ).toThrow();
  });

  it("库注册表内没有重复 key（Map 会静默吞掉后注册者，重复 = 少一个模板）", () => {
    const dupes = libraryKeys.filter((k, i) => libraryKeys.indexOf(k) !== i);
    expect(dupes, `重复注册的 key：${dupes.join(", ")}`).toEqual([]);
  });

  it("每条内置模板都有 displayName，且 displayName 非空", () => {
    const blanks = declaredKeys.filter(
      (k) => !canvas.builtinDisplayName(k) || canvas.builtinDisplayName(k)!.trim() === "",
    );
    expect(blanks, `缺 displayName 的 key：${blanks.join(", ")}`).toEqual([]);
  });

  it("五处 key≠displayName 的差异逐字一致（O-09）", () => {
    // 逐字点名。写成表格是为了失败时一眼看出是哪一条被改了，而不是「有 5 处差异」这种计数。
    const verbatim: ReadonlyArray<readonly [string, string]> = [
      ["empathy", "empathy-map"],
      ["journey-map", "user-journey"],
      ["bmc", "business-model"],
      ["burger", "burger-comm"],
      ["ai-bmc", "ai-business-model"],
    ];
    for (const [key, displayName] of verbatim) {
      expect(canvas.builtinDisplayName(key), `key=${key} 的 displayName 不是 ${displayName}`).toBe(
        displayName,
      );
      // 这一条保证「差异」是真差异：若某天有人把 displayName 改回等于 key，
      // 上面那条断言会红，但把清单一起改掉就不会——所以额外钉住「它必须不同」。
      expect(displayName, `${key} 的 displayName 与 key 同值，那它就不是差异项了`).not.toBe(key);
    }
  });

  it("除那五条外，其余内置模板 displayName === key（不许再冒出第六处差异）", () => {
    const knownDiff = new Set(["empathy", "journey-map", "bmc", "burger", "ai-bmc"]);
    const unexpected = declaredKeys
      .filter((k) => !knownDiff.has(k))
      .filter((k) => canvas.builtinDisplayName(k) !== k)
      .map((k) => `${k} → ${canvas.builtinDisplayName(k)}`);
    expect(unexpected, `未登记在 O-09 的新差异：${unexpected.join(", ")}`).toEqual([]);
    // 非空前置：如果 declaredKeys 空了，上面这条 filter 结果也空，会平凡为真。
    expect(declaredKeys.length, "declaredKeys 为空 —— 本条断言会平凡为真").toBeGreaterThan(0);
  });

  it("zod 枚举取值 ≡ 声明表的 key（枚举不是第二份手抄清单）", () => {
    assertSameKeySet(declaredKeys, canvas.BuiltinTemplateKeyEnum.options, {
      declared: "BUILTIN_CANVAS_TEMPLATES",
      derived: "BuiltinTemplateKeyEnum.options",
    });
  });
});
