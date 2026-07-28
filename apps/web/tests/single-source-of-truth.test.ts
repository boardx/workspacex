import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FONT_SCALE, FONT_SCALE_KEYS } from "../lib/font-scale";

/**
 * 单一事实源断言（UC-0.4 R12 V4 / AC2 —— 「副本数 = 1」可被机器断言）
 *
 * §1.2 记录的事故根因是「字号表有三份副本靠人肉对齐」。这里逐条钉死：
 * tailwind.config.ts 与 lib/utils.ts 都必须**从 font-scale.ts 取值**，不得手抄。
 */
describe("字号档位单一事实源", () => {
  const twConfig = readFileSync(new URL("../tailwind.config.ts", import.meta.url), "utf8");
  const utils = readFileSync(new URL("../lib/utils.ts", import.meta.url), "utf8");

  it("tailwind.config.ts 从 font-scale.ts import", () => {
    expect(twConfig).toMatch(/import\s*\{\s*FONT_SCALE\s*\}\s*from\s*"\.\/lib\/font-scale"/);
  });

  it("tailwind.config.ts 不含字面量 fontSize 对象（第二份副本）", () => {
    expect(twConfig).not.toMatch(/fontSize:\s*\{/);
    expect(twConfig).toMatch(/fontSize:\s*FONT_SCALE/);
  });

  it("lib/utils.ts 用 FONT_SCALE_KEYS 登记 tailwind-merge，不手抄清单", () => {
    expect(utils).toMatch(/FONT_SCALE_KEYS/);
    // 手抄的迹象：utils 里出现成串的数字字面量
    expect(utils).not.toMatch(/\[\s*"?\d+"?\s*,\s*"?\d+"?\s*,\s*"?\d+"?/);
  });

  it("档位表非空且键为纯数字", () => {
    expect(FONT_SCALE_KEYS.length).toBeGreaterThan(0);
    FONT_SCALE_KEYS.forEach((k) => expect(k).toMatch(/^\d+$/));
  });

  it("每档都带 lineHeight（避免行高散落各处成为第二份隐性副本）", () => {
    Object.entries(FONT_SCALE).forEach(([, v]) => {
      expect(v[1].lineHeight).toBeTruthy();
    });
  });
});

describe("设计 token 单一事实源", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  it("globals.css 同时定义明暗两套主题", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it("每个被标注的色面 token 都有配对 foreground", () => {
    const root = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const declared = [...root.matchAll(/--([a-z0-9-]+)\s*:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/g)].map((m) => m[1]!);
    const bases = declared.filter((k) => !k.endsWith("-foreground"));
    const structural = new Set(["border", "border-subtle", "input", "ring"]);
    bases.filter((b) => !structural.has(b)).forEach((b) => {
      expect(declared, `--${b} 缺少配对 --${b}-foreground`).toContain(`${b}-foreground`);
    });
  });
});
