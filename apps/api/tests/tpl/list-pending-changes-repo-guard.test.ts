import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("lint-permission-paths 白名单的反证：pg-list-pending-changes-repository.ts 只碰 blueprint_pending_changes", () => {
  it("不引用其它租户表（豁免的全部依据，#1667）", () => {
    const src = fileURLToPath(
      new URL("../../src/infrastructure/templates/pg-list-pending-changes-repository.ts", import.meta.url),
    );
    const body = readFileSync(src, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    expect(code).toMatch(/FROM blueprint_pending_changes/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    const other = refs.filter((t) => t !== "blueprint_pending_changes");
    expect(other, `不应出现的表引用：${other.join(",")}`).toEqual([]);
  });
});
