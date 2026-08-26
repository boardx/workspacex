/**
 * 回填脚本的**幂等判据必须逐项覆盖它会写的每一样东西**。
 *
 * ## 2026-08-26 实测踩出来的
 *
 * 判据原先只看 `layout`。加了 `title`（纸面双语大标题）之后重跑 devapp，19 个模板因为
 * 「已有 layout」被**全部跳过**，标题一个都没灌进去——而脚本还打印
 * 「已带配置，跳过（幂等）」，读起来一切正常。
 *
 * ⚠ 少写一项判据的表现，与「本来就不需要做」**完全同形**：都是跳过 + 一行绿色日志。
 *   只有回库查 `title` 才发现是空的。所以这件事必须机械挡住，不能靠下次记得。
 *
 * ## 判据是源码文本，边界如实说明
 *
 * 断言的是「脚本的跳过判据里，本脚本写的每个字段都被提到过」。它**不**证明判据写对了
 * （比如把 `title` 判成了 `!== undefined` 而不是 `=== spec.title`）——那由 devapp 的真实
 * 回读证。它挡的是**整项遗漏**，而那正是出事的那一种。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(__dirname, "../../scripts/backfill-canvas-builtin-templates.ts"),
  "utf8",
);

/** 只看代码行——注释里提到字段名不算"判据覆盖了它"。 */
const CODE = SOURCE.split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join("\n");

/** 本脚本会写进库的字段 → 跳过判据里必须出现的变量名。 */
const WRITES: Readonly<Record<string, string>> = {
  layout: "enriched",
  title: "chromed",
};

describe("回填脚本的幂等判据", () => {
  it("跳过前逐项判过：本脚本写的每样东西都有对应判据", () => {
    const missing = Object.entries(WRITES)
      .filter(([, flag]) => !CODE.includes(`const ${flag} =`))
      .map(([field]) => field);
    expect(missing).toEqual([]);
  });

  it("两项判据**同时**满足才跳过，不是任一满足", () => {
    expect(CODE).toContain("if (enriched && chromed)");
    // 反证：写成 `enriched ||` 或只判其中一个，都会让另一项永远灌不进去。
    expect(CODE).not.toContain("if (enriched || chromed)");
  });

  it("只缺装帧时**不铸新版本**——装帧走元数据入口，碰不到 sections", () => {
    // `mintTemplateVersion` 只该出现在"缺 layout"那条路径上。
    const onlyChrome = CODE.slice(CODE.indexOf("if (enriched) {"));
    const untilContinue = onlyChrome.slice(0, onlyChrome.indexOf("continue;"));
    expect(untilContinue).toContain("setChrome(");
    expect(untilContinue).not.toContain("mintTemplateVersion(");
  });

  it("footer 不在判据里——它一律留空，没有「该有的值」可比对", () => {
    // ⚠ 这条是**刻意**的豁免，写下来免得下次有人以为漏了：老 spec 没有 footer 这件
    //   事实，回填一律留空（见脚本文件头）。把它加进判据会让每次重跑都去写一遍空串。
    expect(Object.keys(WRITES)).not.toContain("footer");
  });
});
