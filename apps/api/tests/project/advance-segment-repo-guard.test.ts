/**
 * 豁免的载荷：`lint-permission-paths.mjs` 的白名单条目（F119 `pg-agenda-segment-repository.ts`）
 * 建立在「这个仓储只碰 `agenda_segments` 一张租户表」上——本文件纯静态解析源码，
 * **不需要 Postgres，可本地跑**（同 `create-project-idempotent.test.ts` 那条载荷测试的写法）。
 *
 * 豁免的论证：`disclose()` 在这条路径上没有意义——`advance-agenda-segment.ts` 已经在
 * 调用仓储**之前**做完 `authorize({ action: "agendaSegment.advance" })` 判定（权限先于
 * 存在性，同 `bindToProjectStep` 的顺序），仓储返回的行**就是**这次被授权动作改动的那一条环节，
 * 不是任意读取面。这条豁免只在仓储从未touch第二张租户表时成立，所以本文件断言这一点，
 * 而不是让它停留在一句注释里。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/project/pg-agenda-segment-repository.ts", import.meta.url),
);

describe("豁免的前提：pg-agenda-segment-repository.ts 只碰 agenda_segments 一张租户表", () => {
  it("全部 FROM/JOIN/INTO/UPDATE 语句只命名 agenda_segments", () => {
    const body = readFileSync(SRC, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    // 非空转：文件确实被读到了，且它确实在读写这张表。
    expect(code).toMatch(/UPDATE agenda_segments/);
    expect(code).toMatch(/FROM agenda_segments/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(refs.length, "一条表引用都没扫到——本断言在空转").toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["agenda_segments"]));
  });
});
