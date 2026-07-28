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
    re: /\b180\s*天(?!.*动态渲染)/,
    hint: "材料保留期须按项目动态渲染（D-14），不得写死 180 天",
  },
];

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

  it.each(HARDCODE_PATTERNS)("$name 没有被写死", ({ re, hint }) => {
    const hits: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      body.split("\n").forEach((line, i) => {
        // 注释行放行——文档里说明「不得写死 180 天」本身不该被判违规
        if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;
        if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 80)}`);
      });
    }
    expect(hits, hits.length ? `${hint}\n  ${hits.join("\n  ")}` : "").toEqual([]);
  });
});
