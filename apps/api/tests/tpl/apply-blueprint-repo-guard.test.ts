import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("lint-permission-paths 白名单的反证：pg-apply-blueprint-repository.ts 只碰 blueprint_bindings/agenda_segments", () => {
  it("不引用其它租户表（豁免的全部依据，#1667）", () => {
    const src = fileURLToPath(
      new URL("../../src/infrastructure/templates/pg-apply-blueprint-repository.ts", import.meta.url),
    );
    const body = readFileSync(src, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    // 非空转：文件确实被读到了，且它确实在碰这两张表。
    expect(code).toMatch(/UPDATE blueprint_bindings/);
    expect(code).toMatch(/INSERT INTO agenda_segments/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    const other = refs.filter((t) => t !== "blueprint_bindings" && t !== "agenda_segments");
    expect(other, `不应出现的表引用：${other.join(",")}`).toEqual([]);
  });
});
