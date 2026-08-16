/**
 * F185（2026-08-16 delta）—— 把 `pg-project-tags-repository.ts` 那条 `lint-permission-paths`
 * 豁免的前提钉成机械事实，同 `pg-project-archive-repository.ts` / `message-rating-repo-guard`
 * 那批 guard 测试的形状：
 *
 *   ① 名到的表恰好是 `projects` / `project_tags`——多 JOIN 一张就是未经判定的读出口。
 *   ② 权限判定发生在仓储被调用之前：`update-project-tags.ts` 先跑
 *      `canCreateProject(orgRole)`，之后才碰 `deps.repo.updateTags`。
 *
 * 这个文件被删掉时，`lint-permission-paths.mjs` 里那一行 allowlist 必须跟着回退。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/project/pg-project-tags-repository.ts");
const USECASE = join(__dirname, "../../src/application/project/update-project-tags.ts");

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ALLOWED_TABLES = ["projects", "project_tags"].sort();

describe("F185 项目标签仓储的权限豁免前提", () => {
  const source = code(readFileSync(REPO, "utf8"));

  it("① 名到的表恰好是允许的两张", () => {
    const named = [
      ...source.matchAll(/\b(?:FROM|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi),
    ].map((m) => m[1]!.toLowerCase());
    expect(named.length, "一条 SQL 都没扫到 —— 这条断言正在空转").toBeGreaterThan(0);
    expect([...new Set(named)].sort()).toEqual(ALLOWED_TABLES);
  });

  it("② 没有 withoutTenant", () => {
    expect(source).not.toContain("withoutTenant");
    expect(source).toContain("withTenant");
  });

  it("③ 权限判定在第一次 deps.repo.updateTags 之前", () => {
    const usecase = code(readFileSync(USECASE, "utf8"));
    const check = usecase.indexOf("canCreateProject(");
    const firstRepoTouch = usecase.indexOf("deps.repo.updateTags(");

    expect(check, "canCreateProject 不见了").toBeGreaterThan(-1);
    expect(firstRepoTouch, "用例根本没碰仓储 —— 断言在空转").toBeGreaterThan(-1);
    expect(check, "权限判定跑在仓储之后").toBeLessThan(firstRepoTouch);

    // 不是「拿到判定就往下走」：判定为 false 时必须抛，不是继续。
    expect(usecase).toMatch(/if\s*\(!canCreateProject\([\s\S]{0,80}throw/);
  });
});
