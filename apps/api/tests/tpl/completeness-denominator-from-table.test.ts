import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DESIGN_FACET_DEFINITIONS,
  designFacetDenominator,
  designFacetKeys,
  type DesignFacetRow,
} from "../../src/domain/templates/design-facet-table";
import {
  deriveCompleteness,
  formatCompleteness,
} from "../../src/domain/templates/completeness";
import { listDesignFacetDefinitions } from "../../src/application/templates/list-design-facet-definitions";

/**
 * F17 —— **完成度的分母来自定义表**（I-5，口径 O-32 ④）。
 *
 * `uc-2-1` V1 逐字：「**断言必须写成参数化的 N**，这样第 16 项的裁决落地后不需要改测试」。
 * 所以本文件里**没有任何一个字面量分母**，一处都没有——包括断言里。
 *
 * I-5 的验收线索有两半，两半都在这里：
 *   · 「改表加一项后接口返回的分母自动 +1」→ 参数化的表 **＋ 真的改磁盘上那个文件**。
 *   · 「`grep` 断言实现与测试无硬编码分母」→ 让门控扫 `src` 与 `tests` 自己。
 *
 * ⚠ 只做参数化那一半是不够的：一个函数可以正确地接受传入的表，
 *   而默认导出的那张表旁边另有一个手写的 `TOTAL`。所以第二组用例把
 *   **磁盘上的表改掉、重新 import**，看派生值是否真的跟着走。
 */

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const TABLE_SRC = join(ROOT, "apps/api/src/domain/templates/design-facet-table.ts");
const TMP_DIR = join(ROOT, "apps/api/__fixtures__/.generated");

const N = () => designFacetDenominator();

describe("分母 = 定义表条目数（参数化的 N，无字面量）", () => {
  it("空完成度是 0/N，全完成是 N/N，且 N 恒等于表的行数", () => {
    const none = deriveCompleteness([]);
    expect(none.done).toBe(0);
    expect(none.denominator).toBe(DESIGN_FACET_DEFINITIONS.length);
    expect(formatCompleteness(none)).toBe(`0/${N()}`);

    const all = deriveCompleteness(designFacetKeys());
    expect(all.done).toBe(N());
    expect(formatCompleteness(all)).toBe(`${N()}/${N()}`);
  });

  it("逐项写入时分子单调递增 0 → N，一步不跳、一步不漏（uc-2-1 V1）", () => {
    const keys = designFacetKeys();
    const seen: string[] = [];
    const series = [deriveCompleteness(seen).done];
    for (const key of keys) {
      seen.push(key);
      series.push(deriveCompleteness(seen).done);
    }
    expect(series).toEqual(keys.map((_, i) => i).concat(keys.length));
    expect(series.at(-1)).toBe(N());
  });

  it("接口返回的项数与分母一致 —— 服务端自己算，不让前端数（I-5 逐字）", () => {
    const out = listDesignFacetDefinitions();
    expect(out.denominator).toBe(out.items.length);
    expect(out.denominator).toBe(N());
  });

  it("已完成标记指向表里没有的槽位时，不计入分子，也不被静默吞掉", () => {
    const stale = deriveCompleteness([...designFacetKeys().slice(0, 2), "a-removed-slot"]);
    expect(stale.done).toBe(2);
    expect(stale.unknownKeys).toEqual(["a-removed-slot"]);
    expect(stale.done).toBeLessThan(stale.denominator);
  });

  it("重复的完成标记只算一次（否则分子能超过分母）", () => {
    const key = designFacetKeys()[0]!;
    expect(deriveCompleteness([key, key, key]).done).toBe(1);
  });

  it("传入改过的表 ⇒ 分母立刻跟着走，两个方向都试", () => {
    const extra: DesignFacetRow = {
      designFacetKey: "a-brand-new-slot",
      label: "新槽位",
      group: "output",
      ordinal: 99,
      required: false,
    };
    const grown = [...DESIGN_FACET_DEFINITIONS, extra];
    expect(deriveCompleteness([], grown).denominator).toBe(N() + 1);
    expect(listDesignFacetDefinitions(grown).denominator).toBe(N() + 1);

    const shrunk = DESIGN_FACET_DEFINITIONS.slice(1);
    expect(deriveCompleteness([], shrunk).denominator).toBe(N() - 1);
    // 被删那一项的历史完成标记不再计入分子 —— 否则会出现一个永远差一点点的分数
    const removed = DESIGN_FACET_DEFINITIONS[0]!.designFacetKey;
    expect(deriveCompleteness([removed], shrunk).done).toBe(0);
  });
});

describe("真的改磁盘上那张表（参数化不足以证明单源）", () => {
  afterAll(() => rmSync(TMP_DIR, { recursive: true, force: true }));

  /** 把表源码复制一份、插进一行，再 import 回来。⚠ 不改仓库里的原文件。 */
  async function loadTableWithExtraRow() {
    const body = readFileSync(TABLE_SRC, "utf8");
    const marker = '  { designFacetKey: "report-template"';
    expect(body, "表的最后一行长得不认识了 —— 这个测试会静默失效，先修它").toContain(marker);
    const patched = body.replace(
      marker,
      '  { designFacetKey: "an-extra-slot", label: "临时加的一项", group: "output", ordinal: 3, required: false },\n' +
        marker,
    );
    mkdirSync(TMP_DIR, { recursive: true });
    const file = join(TMP_DIR, "patched-table.ts");
    writeFileSync(file, patched);
    return (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as typeof import("../../src/domain/templates/design-facet-table");
  }

  it("表里多一行 ⇒ 槽位 +1、分母 +1，零处代码改动", async () => {
    const patched = await loadTableWithExtraRow();
    expect(patched.DESIGN_FACET_DEFINITIONS.length).toBe(DESIGN_FACET_DEFINITIONS.length + 1);
    expect(patched.designFacetDenominator()).toBe(N() + 1);
    expect(patched.designFacetKeys()).toContain("an-extra-slot");
    // 分组也跟着走：新行落进它声明的那个组，不需要有人再去别处登记一次
    expect(patched.designFacetsByGroup().output.map((r) => r.designFacetKey)).toContain("an-extra-slot");
  });

  it("反证：不改表就没有第 N+1 项 —— 上一条不是恒真的", () => {
    expect(designFacetKeys()).not.toContain("an-extra-slot");
    expect(N()).toBe(DESIGN_FACET_DEFINITIONS.length);
  });
});

describe("实现与测试里没有硬编码分母（I-5 的 grep 那一半）", () => {
  it("门控扫过 src 与 tests，且零违规", () => {
    const out = execFileSync(
      "node",
      ["apps/api/scripts/lint-design-facet-single-source.mjs", "apps/api/src", "apps/api/tests"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(Number(/scanned=(\d+)/.exec(out)?.[1] ?? "-1"), "扫了 0 个文件 —— 空转").toBeGreaterThan(0);
    expect(Number(/violations=(\d+)/.exec(out)?.[1] ?? "-1"), out).toBe(0);
    expect(Number(/debt=(\d+)/.exec(out)?.[1] ?? "-1"), "后端侧不该有任何一处已知副本").toBe(0);
  });
});
