/**
 * `pg-model-pool-repository.ts` 的 lint 豁免，钉在这里（#548）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这个文件开了口子，理由是「模型不是
 * `ObjectRef` 的任何一种，硬套 `guard()` 会 ALLOW EVERYONE；谁能碰模型池是 org-admin
 * 问题，裁定挂在上一层的 controller 里」。那条理由**只在四个前提成立时**有效，所以四个
 * 前提在这里被逐条断言，而不是留在注释里当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动。一条永远为真的断言与没有断言无法区分——
 * 这个仓库为此红过九次。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_FILE = fileURLToPath(
  new URL("../../../src/infrastructure/model/pg-model-pool-repository.ts", import.meta.url),
);
const CONTROLLER = fileURLToPath(
  new URL("../../../src/interface/controllers/model.controller.ts", import.meta.url),
);
const LINT = fileURLToPath(new URL("../../../scripts/lint-permission-paths.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../../migrations", import.meta.url));

const source = readFileSync(REPO_FILE, "utf8");
/** 去掉注释行：注释里出现 `model_secrets` 是文档，不是一条语句。 */
const code = source
  .split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join("\n");

/** 从迁移里推导租户表，与 lint 同一套推导——手写清单缺的正是刚加的那张表。 */
function tenantTables(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const body = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const m of body.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
      if (/\borg_id\b/.test(m[2]!)) names.add(m[1]!);
    }
  }
  return names;
}

/** SQL 里被 FROM / JOIN / INTO / UPDATE 点到的表名。 */
function tablesNamed(sql: string): ReadonlySet<string> {
  const hit = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) hit.add(m[1]!);
  return hit;
}

const ALLOWED_TABLES = new Set(["models", "model_composite_members", "model_secrets"]);

describe("(a) 只碰模型池自己的三张表", () => {
  it("没有第四张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    // 正样本：三张表本身确实被推导为租户表，否则下面的差集恒为空。
    for (const t of ALLOWED_TABLES) expect(tenant.has(t), `${t} 不在租户表里`).toBe(true);

    const named = tablesNamed(code);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED_TABLES.has(t));
    expect(strangers, "这个文件开始读模型池以外的租户表了，豁免理由不再成立").toEqual([]);
  });

  it("变异：扫描确实抓得到多出来的一张表", () => {
    const planted = `SELECT * FROM projects JOIN artifacts ON 1=1`;
    const tenant = tenantTables();
    const strangers = [...tablesNamed(planted)].filter(
      (t) => tenant.has(t) && !ALLOWED_TABLES.has(t),
    );
    expect(strangers.sort()).toEqual(["artifacts", "projects"]);
  });
});

describe("(b) 永不使用 `withoutTenant`", () => {
  it("每一次取库都带租户上下文", () => {
    // `withoutTenant` 是 fail-closed 的反面：它读到零行，长得像「没数据」而不是「出错了」。
    expect(code).not.toContain("withoutTenant");
    // 正样本：确实用了 `withTenant`，否则上面那条在一个空文件上也成立。
    expect(code).toContain("withTenant");
  });

  it("变异：断言抓得到一次 `withoutTenant`", () => {
    const planted = `await this.db.withoutTenant(async (s) => s.query("SELECT 1"))`;
    expect(() => expect(planted).not.toContain("withoutTenant")).toThrow();
  });
});

describe("(c) 密文只写不读 —— 本文件的要害", () => {
  it("`ciphertext` 只出现在 INSERT 的列清单里，任何 SELECT 都不碰它", () => {
    const selects = [...code.matchAll(/SELECT[\s\S]*?(?=`|$)/gi)].map((m) => m[0]);
    expect(selects.length, "一条 SELECT 都没找到——这个断言会是空转的").toBeGreaterThan(0);
    for (const s of selects) {
      expect(s, "某条 SELECT 读到了 ciphertext").not.toMatch(/\bciphertext\b/);
    }
    // `SELECT *` 同样是禁止的：0019 对 model_secrets 只给了列级 SELECT，
    // 而 `SELECT *` 会在数据库层直接 permission denied——这里不指望那个兜底。
    expect(code, "出现了 SELECT *，下一张表的泄露就看不见了").not.toMatch(/SELECT\s+\*/i);
    // 正样本：ciphertext 确实在文件里（写入路径），否则上面全是在扫一个没有它的文件。
    expect(code).toContain("ciphertext");
  });

  it("`credentialConfigured` 是 EXISTS，不是把密文取出来判空", () => {
    expect(code).toMatch(/EXISTS\s*\(/i);
    expect(code).toMatch(/credential_configured/);
  });

  it("变异：一条读密文的 SELECT 会被抓到", () => {
    const planted = `SELECT model_id, ciphertext FROM model_secrets`;
    expect(() => expect(planted).not.toMatch(/\bciphertext\b/)).toThrow();
  });
});

describe("(d) 上一层的 org-admin 裁定还在", () => {
  const controller = readFileSync(CONTROLLER, "utf8");

  /**
   * ⚠ 去注释之后再断，这一步是本节的全部重量。
   *
   * 第一版没有它，于是下面那个「把调用整行注释掉」的变异**没能变红**——因为注释行里
   * 照样有 `this.requireOrgAdmin(` 这串字符。那正是今天踩过的钉子的同一形态：
   * `toContain("assertProjectMember")` 命中的是定义本身，把调用注释掉依然全绿。
   * 反证先红在了断言自己身上，是它该待的地方。
   */
  function stripComments(ts: string): string {
    return ts
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((l) => l.replace(/\/\/.*$/, ""))
      .join("\n");
  }

  function handlerOf(src: string): string {
    return /@Post\("\/models"\)[\s\S]*?\n  }\n/.exec(stripComments(src))?.[0] ?? "";
  }

  it("controller 在调用用例**之前**判 org-admin，且判据是 `admin`", () => {
    // 断的是**调用点**，不是名字在不在文件里：把 `requireOrgAdmin` 的定义留着、
    // 却在 handler 里不调它（或把它注释掉），下面这条都会红。
    const handler = handlerOf(controller);
    expect(handler, "找不到 POST /models 的 handler——断言要重新定位").not.toBe("");
    expect(handler, "handler 里没有调 requireOrgAdmin").toContain("this.requireOrgAdmin(");

    // 裁定必须在用例之前发生：先取到 orgId，再拿它去调用例。
    const gateAt = handler.indexOf("this.requireOrgAdmin(");
    const useCaseAt = handler.indexOf("registerModel(");
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(useCaseAt).toBeGreaterThan(gateAt);

    // 判据本身：不是「有 membership 就行」，而是 orgRole === admin。
    expect(stripComments(controller)).toMatch(/orgRole\s*!==\s*"admin"/);
    expect(stripComments(controller)).toContain("NOT_ORG_ADMIN");
  });

  it("变异 1：把调用整行**注释掉**，(d) 必须变红", () => {
    const mutated = controller.replace(
      "const orgId = await this.requireOrgAdmin(principal);",
      "const orgId = principal.orgId; // await this.requireOrgAdmin(principal);",
    );
    expect(mutated, "变异没生效——replace 的目标串已经漂移").not.toBe(controller);

    const handler = handlerOf(mutated);
    expect(handler, "变异体里也该切得到 handler").not.toBe("");
    expect(() => {
      expect(handler).toContain("this.requireOrgAdmin(");
    }).toThrow();
  });

  it("变异 2：调用还在但挪到用例**之后**，顺序断言必须变红", () => {
    // 「判了」和「在动手之前判了」是两件事。前者拦不住一次已经发生的写入。
    const handler = handlerOf(controller);
    const reordered = handler
      .replace("const orgId = await this.requireOrgAdmin(principal);", "const orgId = principal.orgId;")
      // 挪到用例**之后**——写入已经发生了才判，这正是要抓的形态。
      .replace(
        "return C.operations.registerModel.out.parse({",
        "await this.requireOrgAdmin(principal);\n      return C.operations.registerModel.out.parse({",
      );
    expect(reordered).not.toBe(handler);
    expect(reordered, "变异体里必须还留着那次调用，否则红的是变异 1 那条").toContain(
      "this.requireOrgAdmin(",
    );

    const gateAt = reordered.indexOf("this.requireOrgAdmin(");
    const useCaseAt = reordered.indexOf("registerModel(");
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(() => {
      expect(useCaseAt).toBeGreaterThan(gateAt);
    }).toThrow();
  });
});

describe("豁免条目与本测试互相钉住", () => {
  it("ALLOWLIST 里有这一条，且它点名了本文件", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/model/pg-model-pool-repository.ts");
    // 另一个方向：删掉豁免条目，红的是 lint；删掉本测试，本该没有东西会红——
    // 所以豁免条目的正文被要求指回这里。
    expect(lint).toContain("model-pool-repo-guard.test.ts");
  });
});
