/**
 * 「同一事实不得声明在两处」的**逃生口门控**。
 *
 * `auto-template-layout.ts` 算分区尺寸时必须知道引擎的便签几何
 * （`DEFAULT_STICKY` / `STICKY_GAP` / 标题条下的起始偏移 / 左内边距），
 * 但这四个常量住在 `packages/fabric-markdown/src/diagrams/template-engine.ts` 里
 * **且没有导出**，而那个包是 vendor 并入的上游源码，纪律是一个字都不改
 * （见 `packages/fabric-markdown/VENDOR.md`）——也就是说我们既不能 import，
 * 也不能去加一个 export。
 *
 * 于是只能镜像一份。镜像本身不是罪，**镜像了却没人盯**才是本仓被点名过五次的漂移。
 * 这份测试直接读上游源码文本比对：上游改了便签尺寸或间距，这里立刻变红，
 * 而不是等到某天生成的画布里便签溢出框外才被人肉发现。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENGINE_STICKY,
  ENGINE_STICKY_GAP,
  ENGINE_STICKY_TOP_OFFSET,
  ENGINE_STICKY_INSET,
} from "@/lib/canvas/auto-template-layout";

const ENGINE_SRC = resolve(
  process.cwd(),
  "../../packages/fabric-markdown/src/diagrams/template-engine.ts",
);

function source(): string {
  return readFileSync(ENGINE_SRC, "utf8");
}

function num(re: RegExp, label: string): number {
  const m = re.exec(source());
  expect(m, `在 template-engine.ts 里找不到 ${label}——上游结构变了，镜像常量必须重新核对`).not.toBeNull();
  return Number(m![1]);
}

describe("镜像的引擎便签常量与上游一致", () => {
  it("DEFAULT_STICKY = { w, h, perRow }", () => {
    expect(ENGINE_STICKY.w).toBe(num(/DEFAULT_STICKY\s*=\s*\{\s*w:\s*(\d+)/, "DEFAULT_STICKY.w"));
    expect(ENGINE_STICKY.h).toBe(num(/DEFAULT_STICKY\s*=\s*\{[^}]*\bh:\s*(\d+)/, "DEFAULT_STICKY.h"));
    expect(ENGINE_STICKY.perRow).toBe(
      num(/DEFAULT_STICKY\s*=\s*\{[^}]*perRow:\s*(\d+)/, "DEFAULT_STICKY.perRow"),
    );
  });

  it("STICKY_GAP = { x, y }", () => {
    expect(ENGINE_STICKY_GAP.x).toBe(num(/STICKY_GAP\s*=\s*\{\s*x:\s*(\d+)/, "STICKY_GAP.x"));
    expect(ENGINE_STICKY_GAP.y).toBe(num(/STICKY_GAP\s*=\s*\{[^}]*\by:\s*(\d+)/, "STICKY_GAP.y"));
  });

  it("便签起始偏移（有标题条时）与左内边距", () => {
    // 引擎：const stickyTop = sec.y - sec.h / 2 + (titleBars ? 44 : 14);
    expect(ENGINE_STICKY_TOP_OFFSET).toBe(
      num(/stickyTop\s*=\s*sec\.y\s*-\s*sec\.h\s*\/\s*2\s*\+\s*\(titleBars\s*\?\s*(\d+)/, "stickyTop 偏移"),
    );
    // 引擎（issue #2372 后）：x: sec.x - sec.w / 2 + 14 + sectionSticky.w / 2 + col * (...)
    // ⚠ 变量名从 `sticky.w` 改成 `sectionSticky.w`（每分区可覆盖 perRow/w/h，
    //   见 `template-engine.ts` 的 `TemplateSection.sticky`），常量本身（14）没变。
    expect(ENGINE_STICKY_INSET).toBe(
      num(/x:\s*sec\.x\s*-\s*sec\.w\s*\/\s*2\s*\+\s*(\d+)\s*\+\s*sectionSticky\.w/, "便签左内边距"),
    );
  });

  it("引擎按 perRow 计算每行张数的公式没变（尺寸倒推依赖它）", () => {
    // const perRow = Math.max(1, Math.min(sectionSticky.perRow, Math.floor((sec.w - 28) / (sectionSticky.w + STICKY_GAP.x))));
    // ⚠ issue #2372：变量名从 `sticky` 改成 `sectionSticky`（spec 级默认 `sticky`
    //   与分区自己的 `sec.sticky` 合并后的结果），公式结构本身没变。
    expect(source()).toMatch(
      /Math\.max\(1,\s*Math\.min\(sectionSticky\.perRow,\s*Math\.floor\(\(sec\.w\s*-\s*28\)\s*\/\s*\(sectionSticky\.w\s*\+\s*STICKY_GAP\.x\)\)\)\)/,
    );
  });
});
