import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("lint-permission-paths 白名单的反证：pg-compute-deviations-repository.ts 只碰 blueprint_bindings/blueprint_versions/agenda_segments", () => {
  it("不引用其它租户表（豁免的全部依据，#1667）", () => {
    const src = fileURLToPath(
      new URL("../../src/infrastructure/templates/pg-compute-deviations-repository.ts", import.meta.url),
    );
    const body = readFileSync(src, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    expect(code).toMatch(/FROM blueprint_bindings/);
    expect(code).toMatch(/JOIN blueprint_versions/);
    expect(code).toMatch(/FROM agenda_segments/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    const other = refs.filter(
      (t) => t !== "blueprint_bindings" && t !== "blueprint_versions" && t !== "agenda_segments",
    );
    expect(other, `不应出现的表引用：${other.join(",")}`).toEqual([]);
  });
});
