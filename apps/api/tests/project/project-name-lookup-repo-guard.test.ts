/**
 * 豁免的载荷：`lint-permission-paths.mjs` 的白名单条目（#728 D4
 * `pg-project-name-lookup.ts`）建立在两件事上——本文件纯静态解析源码，
 * **不需要 Postgres，可本地跑**（同 `advance-segment-repo-guard.test.ts` 那条
 * 载荷测试的写法）：
 *
 *   ① `pg-project-name-lookup.ts` 只碰 `projects` 一张租户表，只选 `name` 一列
 *      （不是整行，不是治理相关列）。
 *   ② `list-threads.ts` 里这个端口的返回值只会被塞进已经过
 *      `resolveVisibility()` 判过 `outcome.kind === "allow"` 的那条分支——
 *      `outcome.kind !== "allow"` 的早退分支（`continue`）里不出现它，
 *      即一个连这个项目下任何一条线程都看不见的调用方，永远拿不到这个值。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_SRC = fileURLToPath(
  new URL("../../src/infrastructure/project/pg-project-name-lookup.ts", import.meta.url),
);
const USE_CASE_SRC = fileURLToPath(
  new URL("../../src/application/chat/list-threads.ts", import.meta.url),
);

function stripComments(body: string): string {
  return body
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
}

describe("豁免的前提①：pg-project-name-lookup.ts 只碰 projects 一张租户表、只选 name", () => {
  it("全部 FROM/JOIN/INTO/UPDATE 语句只命名 projects", () => {
    const code = stripComments(readFileSync(REPO_SRC, "utf8"));

    // 非空转：文件确实被读到了，且它确实在读这张表。
    expect(code).toMatch(/FROM projects/);

    const refs = [...code.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(refs.length, "一条表引用都没扫到——本断言在空转").toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["projects"]));
  });

  it("SELECT 只取 name 一列，不是整行/星号", () => {
    const code = stripComments(readFileSync(REPO_SRC, "utf8"));
    const selectMatch = code.match(/SELECT\s+([^\n]+?)\s+FROM projects/i);
    expect(selectMatch, "没扫到 SELECT ... FROM projects——本断言在空转").not.toBeNull();
    expect(selectMatch![1]!.trim()).toBe("name");
  });
});

describe("豁免的前提②：listThreads 只在可见性判过 allow 的分支里用这个值", () => {
  it("`deps.projects.findName` 的返回值只喂进 allow 分支后的 buildCard，不出现在 continue 早退之前", () => {
    const code = stripComments(readFileSync(USE_CASE_SRC, "utf8"));

    // 非空转：确实调用了这个端口。
    expect(code).toMatch(/deps\.projects\.findName/);

    // 早退分支（`outcome.kind !== "allow"` 时 `continue`，不读正文也不带出 projectName）
    // 必须出现在调用 findName 之后——即每条线程各自的可见性判定仍然逐条把关，
    // findName 本身只是「查一次、喂给多张卡片」的效率优化，不代替逐条判定。
    const findNameIdx = code.indexOf("deps.projects.findName");
    const earlyContinueIdx = code.indexOf('outcome.kind !== "allow"');
    expect(findNameIdx).toBeGreaterThan(-1);
    expect(earlyContinueIdx).toBeGreaterThan(-1);
    expect(earlyContinueIdx, "可见性早退判定必须仍然在 findName 之后逐条把关").toBeGreaterThan(findNameIdx);

    // `projectName` 只在 `buildCard(...)` 调用里传出去——即只有走到 buildCard
    // （早退分支的下一行）的线程才会拿到它，不是在早退之前就塞进某个共享对象。
    expect(code).toMatch(/buildCard\([^)]*projectName[^)]*\)/);
  });
});
