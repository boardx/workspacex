/**
 * 豁免的载荷：`lint-permission-paths.mjs` 的白名单条目（F127
 * `pg-temporary-grant-repository.ts`）建立在「这个仓储只碰 `temporary_grants` 一张租户表」
 * 上——本文件纯静态解析源码，**不需要 Postgres，可本地跑**（同
 * `advance-segment-repo-guard.test.ts`（F119）那条载荷测试的写法）。
 *
 * 豁免的论证：见 `lint-permission-paths.mjs` 里这条 allowlist 条目本身的文字——
 * `create()` 只回声调用方自己刚要求创建的那一行；`findActive`/`findActiveBySegment` 的
 * 两个真实调用方（`check-temporary-grant-access.ts` / `advance-agenda-segment.ts`）都已经
 * 在到达本仓储之前做完了各自的授权判定；`markRevoked` 只翻转调用方已经点名的那一行。
 * 这条豁免只在仓储从未 touch 第二张租户表时成立，所以本文件断言这一点。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(
  new URL("../../src/infrastructure/identity/pg-temporary-grant-repository.ts", import.meta.url),
);

describe("豁免的前提：pg-temporary-grant-repository.ts 只碰 temporary_grants 一张租户表", () => {
  it("全部 FROM/JOIN/INTO/UPDATE 语句只命名 temporary_grants", () => {
    const body = readFileSync(SRC, "utf8");
    const code = body
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");

    // 非空转：文件确实被读到了，且它确实在读写这张表。
    expect(code).toMatch(/UPDATE temporary_grants/);
    expect(code).toMatch(/FROM temporary_grants/);
    expect(code).toMatch(/INTO temporary_grants/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(refs.length, "一条表引用都没扫到——本断言在空转").toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["temporary_grants"]));
  });
});
