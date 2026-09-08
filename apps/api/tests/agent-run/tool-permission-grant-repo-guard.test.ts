/**
 * `pg-tool-permission-grant-repository.ts` 的 lint 豁免，钉在这里（Phase 14 F06）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「`tool_permission_
 * grants` 不是 `ObjectRef` 的任何一种，且三个方法都不把行内容交还给调用方，真正的裁决在
 * `decide-tool-permission.ts` 那一层」（与 `pg-admission-test-repository.ts`/
 * `pg-mcp-server-store.ts` 的豁免同一形状）。那条理由**只在三个前提成立时**有效，所以三个
 * 前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(
  new URL("../../src/infrastructure/agent-run/pg-tool-permission-grant-repository.ts", import.meta.url),
);
const DECIDE_USE_CASE = fileURLToPath(
  new URL("../../src/application/agent-run/decide-tool-permission.ts", import.meta.url),
);
const LINT = fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

function stripComments(ts: string): string {
  return ts.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
}

const repoCode = stripComments(readFileSync(REPO, "utf8"));

/** 从迁移里推导租户表，与 lint 同一套推导——手写清单缺的正是刚加的那张表。 */
function tenantTables(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of body.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      if (/\borg_id\b/.test(m[2]!)) names.add(m[1]!);
    }
  }
  return names;
}

function tablesNamed(sql: string): ReadonlySet<string> {
  const hit = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) hit.add(m[1]!);
  return hit;
}

describe("(a) 只碰 tool_permission_grants，没有第二张租户表", () => {
  // issue #3068 —— `tool_permission_revocations` 是撤销留痕（append-only）：撤销不是把
  // 历史抹掉，F06 迁移末尾「授权记录是审计留痕」那条纪律此前靠"不许删"兑现，撤销路径
  // 落地后由这张表接住，记的比"不许删"更多。
  const ALLOWED = new Set(["tool_permission_grants", "tool_permission_revocations"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    expect(tenant.has("tool_permission_grants"), "tool_permission_grants 不在租户表里").toBe(true);

    const named = tablesNamed(repoCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, "这个文件开始读授权表以外的租户表了，豁免理由不再成立").toEqual([]);
  });

  it("变异：扫描确实抓得到多出来的一张表", () => {
    const planted = `SELECT * FROM projects JOIN artifacts ON 1=1`;
    const tenant = tenantTables();
    const strangers = [...tablesNamed(planted)].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers.sort()).toEqual(["artifacts", "projects"]);
  });
});

describe("(b) 从不使用 `withoutTenant`", () => {
  it("每一次取库都带租户上下文", () => {
    expect(repoCode).not.toContain("withoutTenant");
    expect(repoCode).toContain("withTenant");
  });

  it("变异：断言抓得到一次 `withoutTenant`", () => {
    const planted = `await this.db.withoutTenant(async (s) => s.query("SELECT 1"))`;
    expect(() => expect(planted).not.toContain("withoutTenant")).toThrow();
  });
});

describe("(c) hasGrant 只折成布尔；唯一交还行内容的读是 listStanding，且只回 forever 一档", () => {
  it("hasGrant 的 SELECT 是 EXISTS(...)，不选内容列", () => {
    const selects = [...repoCode.matchAll(/SELECT[\s\S]*?(?=`)/gi)].map((m) => m[0]);
    // issue #3068 起是两条：`hasGrant` 的 EXISTS 与 `listStanding` 的清单读。
    expect(selects.length, "SELECT 条数变了——本文件的读面变了，豁免理由要重新论证").toBe(2);
    const exists = selects.filter((sql) => /EXISTS\s*\(/i.test(sql));
    expect(exists.length, "hasGrant 不再是 EXISTS 折布尔了").toBe(1);
    expect(exists[0], "hasGrant 泄露了 granted_by_user_id").not.toMatch(/granted_by_user_id/);
    expect(exists[0], "hasGrant 泄露了 granted_at").not.toMatch(/granted_at/);
  });

  /**
   * issue #3068 —— `listStanding` 是本文件唯一一条把行内容交还调用方的读。豁免理由因此
   * 换成"裁决在上一层、判据是组织角色"（同 `pg-model-pool-repository.ts` 的 `listForOrg`），
   * 下面 (e) 断言那条裁决真的在。这里只钉住它的**读面**：只回 forever 一档的授权元数据。
   */
  it("listStanding 只读 forever 一档，且不回 run_id/scope（不泄露另一档授权的存在）", () => {
    const listing = repoCode.slice(repoCode.indexOf("async listStanding("), repoCode.indexOf("async revokeStanding("));
    expect(listing, "listStanding 没有把 scope 钉死在 forever").toMatch(/scope = 'forever'/);
    // 只看 SELECT 与 FROM 之间的选择列表——WHERE 里当然会出现 scope（那正是上一条断言要的）。
    const columns = /SELECT([\s\S]*?)FROM/i.exec(listing)?.[1] ?? "";
    expect(columns.trim(), "SELECT 列表没解析到——这个断言是空转的").not.toBe("");
    expect(columns, "listStanding 选出了 run_id").not.toMatch(/run_id/);
    expect(columns, "listStanding 选出了 scope 列本身").not.toMatch(/\bscope\b/);
  });

  it("grantForRun/grantStanding 是 void（INSERT 不 RETURNING 内容给调用方）", () => {
    expect(repoCode).toMatch(/async grantForRun\([^)]*\):\s*Promise<void>/);
    expect(repoCode).toMatch(/async grantStanding\([^)]*\):\s*Promise<void>/);
  });

  /** issue #3068 —— 撤销只能撤 forever 一档：少了这条谓词，run 档的行也能从这条路径删掉，
   *  等于给「本 run 内都允许」开了第二条与 `revokeAllForRun` 语义不同的撤销口。 */
  it("revokeStanding 的 DELETE 带 scope='forever' 谓词，且同事务写留痕", () => {
    const revoking = repoCode.slice(repoCode.indexOf("async revokeStanding("));
    expect(revoking).toMatch(/DELETE FROM tool_permission_grants[\s\S]*?scope = 'forever'/);
    expect(revoking).toMatch(/INSERT INTO tool_permission_revocations/);
    // 什么也没删到时不补写留痕——否则审计里会出现一条"撤了一个不存在的授权"。
    expect(revoking.indexOf("if (!row) return false;"))
      .toBeLessThan(revoking.indexOf("INSERT INTO tool_permission_revocations"));
  });

  it("变异：一条选出内容列的 EXISTS 读会被抓到", () => {
    const planted = `SELECT granted_by_user_id, granted_at FROM tool_permission_grants`;
    expect(() => expect(planted).not.toMatch(/granted_by_user_id/)).toThrow();
  });

  it("变异：去掉 scope 谓词后，revokeStanding 的断言必须变红", () => {
    const mutated = repoCode.slice(repoCode.indexOf("async revokeStanding("))
      .replace(/AND scope = 'forever'/g, "");
    expect(() => {
      expect(mutated).toMatch(/DELETE FROM tool_permission_grants[\s\S]*?scope = 'forever'/);
    }).toThrow();
  });
});

describe("(d) 上一层的可见性裁决还在——decide-tool-permission 先判定，后落库", () => {
  const decideSrc = stripComments(readFileSync(DECIDE_USE_CASE, "utf8"));

  it("先判可见性与请求身份，再进入原子裁决；授权 INSERT 在胜出的 UPDATE 后", () => {
    const visibilityAt = decideSrc.indexOf("resolveVisibility(deps");
    const identityAt = decideSrc.indexOf('throw new RunNotAwaitingToolPermissionError("stale_permission_request")');
    const decisionAt = decideSrc.indexOf("await deps.runs.decidePermissionRequest(");
    expect(visibilityAt).toBeGreaterThanOrEqual(0);
    expect(identityAt).toBeGreaterThan(visibilityAt);
    expect(decisionAt).toBeGreaterThan(identityAt);
    const runRepo = stripComments(readFileSync(new URL("../../src/infrastructure/agent-run/pg-agent-run-repository.ts", import.meta.url), "utf8"));
    const atomic = runRepo.slice(runRepo.indexOf("async decidePermissionRequest("), runRepo.indexOf("async approveAndRequeue("));
    expect(atomic).toContain("this.db.withTenant(orgId");
    expect(atomic).toContain("pending_permission_request_id=$3::uuid");
    const lostRaceAt = atomic.indexOf("if (!row) return false;");
    expect(lostRaceAt).toBeGreaterThan(atomic.indexOf("UPDATE agent_runs"));
    expect(atomic.indexOf("INSERT INTO tool_permission_grants")).toBeGreaterThan(lostRaceAt);
  });

  it("变异：把 resolveVisibility 调用整个删掉，断言必须变红", () => {
    const mutated = decideSrc.replace(/const outcome = await resolveVisibility\(deps,[\s\S]*?\}\);/, "");
    expect(mutated).not.toBe(decideSrc);
    expect(() => {
      expect(mutated).toContain("resolveVisibility(deps");
    }).toThrow();
  });
});

/**
 * issue #3068 —— `listStanding` 的裁决在 controller 那一层，判据是组织角色而不是
 * `permission-filter` 的项目维度（`tool_permission_grants` 不是 `ObjectRef` 的任何一种，
 * 硬塞进 `guard()` 会退化成 DEFAULT_SCOPE 组织级、对每个成员返回 allowed=true）。
 * 这一节钉住那条裁决真的在——豁免理由里写了它，就必须有东西断得动它。
 */
describe("(e) 清单/撤销的组织 admin 裁决还在", () => {
  const controllerSrc = stripComments(readFileSync(
    fileURLToPath(new URL("../../src/interface/controllers/tool-permission-grant.controller.ts", import.meta.url)),
    "utf8",
  ));

  it("两条路由都先过 requireOrgAdmin，再碰授权存储", () => {
    for (const method of ["async list(", "async revoke("]) {
      const body = controllerSrc.slice(controllerSrc.indexOf(method));
      const adminAt = body.indexOf("await this.requireOrgAdmin(principal)");
      const storeAt = Math.max(body.indexOf("this.grants.listStanding("), body.indexOf("this.grants.revokeStanding("));
      expect(adminAt, `${method} 没有 requireOrgAdmin`).toBeGreaterThanOrEqual(0);
      expect(storeAt, `${method} 没有碰授权存储——这个断言是空转的`).toBeGreaterThan(adminAt);
    }
    expect(controllerSrc).toMatch(/orgRole !== "admin"[\s\S]*?NOT_ORG_ADMIN/);
  });

  it("变异：把 requireOrgAdmin 调用删掉，断言必须变红", () => {
    const mutated = controllerSrc.replace(/await this\.requireOrgAdmin\(principal\)/g, '""');
    expect(mutated).not.toBe(controllerSrc);
    expect(() => {
      expect(mutated).toContain("await this.requireOrgAdmin(principal)");
    }).toThrow();
  });
});

describe("豁免条目与本测试互相钉住", () => {
  it("ALLOWLIST 里有这一条，且点名了本文件", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/agent-run/pg-tool-permission-grant-repository.ts");
    expect(lint).toContain("tool-permission-grant-repo-guard.test.ts");
  });
});
