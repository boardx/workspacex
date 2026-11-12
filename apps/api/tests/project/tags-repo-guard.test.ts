/**
 * F185（2026-08-16 delta）—— 把 `pg-project-tags-repository.ts` 那条 `lint-permission-paths`
 * 豁免的前提钉成机械事实，同 `pg-project-archive-repository.ts` / `message-rating-repo-guard`
 * 那批 guard 测试的形状：
 *
 *   ① 只访问 `projects`、`project_tags` 和用于检查活跃状态的 `organizations`——多 JOIN 一张就是未经判定的读出口。
 *   ② 权限判定发生在仓储被调用之前：`update-project-tags.ts` 先调用
 *      `requireProjectManager`，之后才执行标签修改或重命名。
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

const ALLOWED_TABLES = ["organizations", "projects", "project_tags"].sort();

describe("F185 项目标签仓储的权限豁免前提", () => {
  const source = code(readFileSync(REPO, "utf8"));

  it("① 名到的表恰好是允许的三张", () => {
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

  it("③ 标签修改和重命名都先经过组织角色检查", () => {
    const usecase = code(readFileSync(USECASE, "utf8"));
    for (const [name, operation] of [
      ["updateProjectTags", "updateTags"],
      ["renameProject", "renameActiveProject"],
    ]) {
      const start = usecase.indexOf(`export async function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const body = usecase.slice(start).split(/\n(?:export )?async function /)[0]!;
      const check = body.indexOf("await requireProjectManager(");
      const write = body.indexOf(`deps.repo.${operation}(`);
      expect(check).toBeGreaterThan(-1);
      expect(write).toBeGreaterThan(check);
    }
    expect(usecase).toMatch(/if\s*\(!canManageProjectLifecycle\([\s\S]{0,80}throw/);
  });

  it("④ 重命名只更新当前组织中的活跃项目", () => {
    expect(source).toMatch(/p\.org_id = \$2 AND p\.status = 'active'\s+AND o\.id = p\.org_id AND o\.status = 'active'/);
  });
});
