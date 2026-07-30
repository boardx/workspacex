import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { THRESHOLDS, pendingThresholds, blockingThresholds, requireValue } from "../src/thresholds";

/**
 * 待定阈值的结构性断言（一致性复核 N-2 / N-3 / N-6 / N-1 / N-4）
 *
 * 这些阈值**规则确定、数值待定**。本测试保证三件事：
 *   ① 每一项都写清了 rule / owner / blocksWhat / ref —— 缺一样就是「挂着但没人认领」
 *   ② 取未定的值会**抛错而不是返回默认值** —— 静默默认是这类缺陷的温床
 *   ③ 业务代码里**没有硬编码**这些数值 —— 一旦有人填了「看起来合理」的数字，
 *      它会被渲染出来、被截图进汇报，从此变成事实标准
 *
 * 本项目已经发生过一次：有人编了 `sampleSize=18` 与「口径表 v3」，
 * 制造出「已算过、已过线」的假象，而 UC 明写那三个数「需产品给出」。
 */

describe("待定阈值登记表", () => {
  it("每一项都写清了 rule / owner / blocksWhat / ref", () => {
    for (const [name, t] of Object.entries(THRESHOLDS)) {
      expect(t.rule, `${name} 缺 rule —— 规则没写清就无法做结构性断言`).toBeTruthy();
      expect(t.rule.length, `${name} 的 rule 太短，像占位`).toBeGreaterThan(15);
      if (!t.known) {
        expect(t.owner, `${name} 缺 owner —— 没人认领的待定项会永远待定`).toBeTruthy();
        expect(t.blocksWhat, `${name} 缺 blocksWhat —— 不写清阻塞什么就会被当成可以永远拖`).toBeTruthy();
        expect(t.ref, `${name} 缺 ref —— 追不回出处的待定项没人敢动`).toBeTruthy();
      } else {
        // 已定值的项必须写 source —— 没有出处的数值等于没有依据。
        // （当前登记表里全是待定项，这条分支为将来数值到位后守着。）
        const resolved = t as { source?: string };
        expect(resolved.source, `${name} 已定值但没写 source —— 没有出处的数值等于没有依据`).toBeTruthy();
      }
    }
  });

  it("取未定的值抛错，而不是返回默认值", () => {
    for (const { name, t } of pendingThresholds()) {
      expect(() => requireValue(t as never, name), `${name} 未定却没抛错`).toThrow(/尚未裁决/);
    }
  });

  it("抛出的错误里带得上「谁该给」与「阻塞什么」", () => {
    // 错误信息是给读到它的人看的：只说「未定」他不知道该找谁
    const first = pendingThresholds()[0];
    expect(first, "登记表里一项待定都没有？那本文件就该删掉").toBeTruthy();
    try {
      requireValue(first!.t as never, first!.name);
      throw new Error("应当抛错");
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain(first!.t.owner);
      expect(msg).toContain("不给会卡住");
    }
  });

  it("真正阻塞开工的项被单独标出（🔴）", () => {
    const blocking = blockingThresholds();
    // 当前只有法定留存清单是真阻塞——它是 X-4 冲突的判据
    expect(blocking.map((b) => b.name)).toContain("legalHoldCategories");
  });
});

/* ── ③ 业务代码里不得硬编码这些数值 ──────────────────────────────── */

const ROOT = join(__dirname, "..", "..", "..");

/** 每项待定阈值对应的「疑似硬编码」特征。写得保守——宁可漏报也别噪音 */
const HARDCODE_PATTERNS: { name: string; re: RegExp; hint: string }[] = [
  {
    name: "vectorRecallBaseline",
    re: /\brecall\s*[><=]+\s*0?\.\d+/i,
    hint: "召回基线应从 THRESHOLDS.vectorRecallBaseline 取，不要写死",
  },
  {
    name: "retentionMaterial",
    re: /\b180\s*天/,
    hint: "材料保留期须按项目动态渲染（D-14），不得写死 180 天",
  },
];

/**
 * 显式豁免标记 —— 一行带 `[threshold-ok:<项>] <理由>` 才放行。
 *
 * ⚠ 2026-07-29：原先 `retentionMaterial` 的正则用负向前瞻放行含「动态渲染」四个字的行。
 * phase-01 的 UI 先行原型一来就撞出三条**误报**：
 *   · `agent-runtime.ts` 那行字面写着「留存期读组织参数，**非写死** 180 天」
 *   · `retention-panel.tsx` 那行写着「实现按参数读取，**不写常量**」
 *   · `rec.ts` 里一份**已提交的同意书快照**记着当时的 180——它是历史数据，
 *     不回溯改写正是 D-14 要的行为，改掉它才是错的
 * 三条说的都正是门控要的事，却被门控判违规。
 *
 * 靠往前瞻里再塞几个词（「非写死」「不写常量」…）不是修法：那等于让「碰巧写对措辞」
 * 决定放不放行，而真正的硬编码只要不提这些词就能溜过去。本仓记过这个形状——
 * **过度触发的门控会被静音，那是门控彻底失效的方式**。
 *
 * ⇒ 改成显式标记：豁免是一个**可 grep、带理由、写给 reviewer 看**的动作。
 * 想绕过门控依然要动手写一行字，但那行字会出现在 diff 里，且必须说明为什么。
 */
const EXEMPT = /\[threshold-ok:(\w+)\]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (["node_modules", "generated", ".next", "dist", "e2e", "tests"].includes(n) || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

describe("业务代码不得硬编码待定阈值", () => {
  const files = [
    ...walk(join(ROOT, "apps/web/lib")),
    ...walk(join(ROOT, "apps/web/components")),
    ...walk(join(ROOT, "packages/contracts/src")),
  ];

  it.each(HARDCODE_PATTERNS)("$name 没有被写死", ({ name, re, hint }) => {
    const hits: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      body.split("\n").forEach((line, i) => {
        // 注释行放行——文档里说明「不得写死 180 天」本身不该被判违规
        if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;
        // 显式豁免：`[threshold-ok:<项>]` 必须点名是哪一项，
        // 顺手写个通用的 `[threshold-ok]` 放行不了别的项。
        const ex = EXEMPT.exec(line);
        if (ex && ex[1] === name) return;
        if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(
      hits,
      hits.length
        ? `${hint}\n  ${hits.join("\n  ")}\n` +
          `确属正当（如：单一声明处、历史快照、说明文案）时，在该行加 ` +
          `\`[threshold-ok:${name}] <理由>\` —— 豁免要写在 diff 里，让 reviewer 看见。`
        : "",
    ).toEqual([]);
  });

  it("反证：豁免标记必须点名具体项，写个通用的放行不了", () => {
    // 没有这一条，把 EXEMPT 放宽成 /\[threshold-ok\]/ 就能一次关掉所有项，且没人会发现。
    const line = 'const d = "180 天"; // [threshold-ok:vectorRecallBaseline] 张冠李戴';
    const ex = EXEMPT.exec(line);
    expect(ex?.[1]).toBe("vectorRecallBaseline");
    expect(ex?.[1]).not.toBe("retentionMaterial");
    // 且没有标记时确实会被抓到
    const rule = HARDCODE_PATTERNS.find((p) => p.name === "retentionMaterial")!;
    expect(rule.re.test('const d = "180 天";')).toBe(true);
  });
});
