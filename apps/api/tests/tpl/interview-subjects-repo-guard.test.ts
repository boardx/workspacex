/**
 * F960（2026-08-17 delta）—— 把 `pg-interview-subjects-repository.ts` 那条
 * `lint-permission-paths` 豁免的前提钉成机械事实，同 `tags-repo-guard.test.ts` /
 * `pg-project-archive-repository.ts` 那批 guard 测试的形状：
 *
 *   ① 名到的表恰好是 `project_group_interview_subjects` / `project_group_interview_subjects_revision`
 *      ——多 JOIN 一张就是未经判定的读出口。
 *   ② 权限判定发生在仓储被调用之前：`update-interview-subjects.ts` 先判
 *      `actorProjectRole === null` 再判 `canUpdateInterviewSubjects`，之后才碰
 *      `deps.repo.updateSubjects`；`get-interview-subjects.ts` 同理判 `actorProjectRole`
 *      再碰 `deps.repo.getSubjects`。
 *
 * 这个文件被删掉时，`lint-permission-paths.mjs` 里那一行 allowlist 必须跟着回退。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "../../src/infrastructure/templates/pg-interview-subjects-repository.ts");
const UPDATE_USECASE = join(__dirname, "../../src/application/templates/update-interview-subjects.ts");
const GET_USECASE = join(__dirname, "../../src/application/templates/get-interview-subjects.ts");

function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ALLOWED_TABLES = ["project_group_interview_subjects", "project_group_interview_subjects_revision"].sort();

describe("F960 观察/访谈对象表仓储的权限豁免前提", () => {
  const source = code(readFileSync(REPO, "utf8"));

  it("① 名到的表恰好是允许的两张", () => {
    const named = [...source.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      // "ON CONFLICT ... DO UPDATE\n  SET ..." 让上面的 UPDATE 正则把字面量 SET 当成假表名——
      // SET 直接跟在 UPDATE 后面，不可能是真实的表名，同 tags-repo-guard 未踩过的这个坑先在这里堵上。
      .filter((t) => t !== "set");
    expect(named.length, "一条 SQL 都没扫到 —— 这条断言正在空转").toBeGreaterThan(0);
    expect([...new Set(named)].sort()).toEqual(ALLOWED_TABLES);
  });

  it("② 没有 withoutTenant", () => {
    expect(source).not.toContain("withoutTenant");
    expect(source).toContain("withTenant");
  });

  it("③ 写路径权限判定在第一次 deps.repo.updateSubjects 之前", () => {
    const usecase = code(readFileSync(UPDATE_USECASE, "utf8"));
    const nullCheck = usecase.indexOf('actorProjectRole === null');
    const roleCheck = usecase.indexOf("canUpdateInterviewSubjects(");
    const firstRepoTouch = usecase.indexOf("deps.repo.updateSubjects(");

    expect(nullCheck, "NO_PROJECT_ROLE 判定不见了").toBeGreaterThan(-1);
    expect(roleCheck, "canUpdateInterviewSubjects 判定不见了").toBeGreaterThan(-1);
    expect(firstRepoTouch, "用例根本没碰仓储 —— 断言在空转").toBeGreaterThan(-1);
    expect(nullCheck, "角色判定跑在仓储之后").toBeLessThan(firstRepoTouch);
    expect(roleCheck, "权限判定跑在仓储之后").toBeLessThan(firstRepoTouch);
  });

  it("④ 读路径权限判定在第一次 deps.repo.getSubjects 之前", () => {
    const usecase = code(readFileSync(GET_USECASE, "utf8"));
    const nullCheck = usecase.indexOf('actorProjectRole === null');
    const firstRepoTouch = usecase.indexOf("deps.repo.getSubjects(");

    expect(nullCheck, "NO_PROJECT_ROLE 判定不见了").toBeGreaterThan(-1);
    expect(firstRepoTouch, "用例根本没碰仓储 —— 断言在空转").toBeGreaterThan(-1);
    expect(nullCheck, "角色判定跑在仓储之后").toBeLessThan(firstRepoTouch);
  });
});
