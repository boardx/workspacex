/**
 * `pg-mcp-server-store.ts` + `pg-mcp-tool-store.ts` 的 lint 豁免，钉在这里（issue #1928）。
 *
 * `lint-permission-paths.mjs` 的 ALLOWLIST 给这两个文件开了口子，理由是「MCP 服务器/工具
 * 不是 `ObjectRef` 的任何一种，硬套 `guard()` 会 ALLOW EVERYONE；谁能碰它们是 org-admin
 * 问题，裁定挂在上一层的两个用例里」（与 `pg-model-pool-repository.ts` 的豁免同一形状）。
 * 那条理由**只在四个前提成立时**有效，所以四个前提在这里被逐条断言，而不是留在注释里
 * 当声明。
 *
 * ⚠ 每条断言都配一个变异，证明它断得动——一条永远为真的断言与没有断言无法区分。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_STORE = fileURLToPath(
  new URL("../../src/infrastructure/mcp/pg-mcp-server-store.ts", import.meta.url),
);
const TOOL_STORE = fileURLToPath(new URL("../../src/infrastructure/mcp/pg-mcp-tool-store.ts", import.meta.url));
const DISCOVER_USE_CASE = fileURLToPath(
  new URL("../../src/application/mcp/discover-remote-server.ts", import.meta.url),
);
const LIST_USE_CASE = fileURLToPath(new URL("../../src/application/mcp/list-mcp-servers.ts", import.meta.url));
const LINT = fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../migrations", import.meta.url));

function stripComments(ts: string): string {
  return ts
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
}

const serverStoreCode = stripComments(readFileSync(SERVER_STORE, "utf8"));
const toolStoreCode = stripComments(readFileSync(TOOL_STORE, "utf8"));

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

function tablesNamed(sql: string): ReadonlySet<string> {
  const hit = new Set<string>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/gi)) hit.add(m[1]!);
  return hit;
}

describe("(a) pg-mcp-server-store.ts 只碰 mcp_servers / mcp_server_secrets", () => {
  const ALLOWED = new Set(["mcp_servers", "mcp_server_secrets"]);

  it("没有第三张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.size, "一张租户表都没推导出来——这个扫描是空转的").toBeGreaterThan(10);
    for (const t of ALLOWED) expect(tenant.has(t), `${t} 不在租户表里`).toBe(true);

    const named = tablesNamed(serverStoreCode);
    expect(named.size, "一条 SQL 都没解析到").toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, "这个文件开始读服务器/密文以外的租户表了，豁免理由不再成立").toEqual([]);
  });

  it("变异：扫描确实抓得到多出来的一张表", () => {
    const planted = `SELECT * FROM projects JOIN artifacts ON 1=1`;
    const tenant = tenantTables();
    const strangers = [...tablesNamed(planted)].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers.sort()).toEqual(["artifacts", "projects"]);
  });
});

describe("(a') pg-mcp-tool-store.ts 只碰 mcp_tools", () => {
  const ALLOWED = new Set(["mcp_tools"]);

  it("没有第二张租户表", () => {
    const tenant = tenantTables();
    expect(tenant.has("mcp_tools")).toBe(true);
    const named = tablesNamed(toolStoreCode);
    expect(named.size).toBeGreaterThan(0);
    const strangers = [...named].filter((t) => tenant.has(t) && !ALLOWED.has(t));
    expect(strangers, "这个文件开始读 mcp_tools 以外的租户表了").toEqual([]);
  });
});

describe("(b) 两个文件永不使用 `withoutTenant`", () => {
  it("每一次取库都带租户上下文", () => {
    expect(serverStoreCode).not.toContain("withoutTenant");
    expect(serverStoreCode).toContain("withTenant");
    expect(toolStoreCode).not.toContain("withoutTenant");
    expect(toolStoreCode).toContain("withTenant");
  });

  it("变异：断言抓得到一次 `withoutTenant`", () => {
    const planted = `await this.db.withoutTenant(async (s) => s.query("SELECT 1"))`;
    expect(() => expect(planted).not.toContain("withoutTenant")).toThrow();
  });
});

describe("(c) 密文只写不读 —— pg-mcp-server-store.ts 的要害", () => {
  it("`ciphertext` 只出现在 INSERT/DELETE 语句里，任何 SELECT 都不碰它", () => {
    const selects = [...serverStoreCode.matchAll(/SELECT[\s\S]*?(?=`|$)/gi)].map((m) => m[0]);
    expect(selects.length, "一条 SELECT 都没找到——这个断言会是空转的").toBeGreaterThan(0);
    for (const s of selects) {
      expect(s, "某条 SELECT 读到了 ciphertext").not.toMatch(/\bciphertext\b/);
    }
    expect(serverStoreCode, "出现了 SELECT *，下一张表的泄露就看不见了").not.toMatch(/SELECT\s+\*/i);
    expect(serverStoreCode).toContain("ciphertext");
  });

  it("`credentialConfigured` 是 EXISTS，不是把密文取出来判空", () => {
    expect(serverStoreCode).toMatch(/EXISTS\s*\(/i);
    expect(serverStoreCode).toMatch(/credential_configured/);
  });

  it("变异：一条读密文的 SELECT 会被抓到", () => {
    const planted = `SELECT server_id, ciphertext FROM mcp_server_secrets`;
    expect(() => expect(planted).not.toMatch(/\bciphertext\b/)).toThrow();
  });

  it("pg-mcp-tool-store.ts 没有任何 ciphertext 相关列（mcp_tools 表本来就不存密文）", () => {
    expect(toolStoreCode).not.toMatch(/ciphertext/i);
  });
});

describe("(d) 上一层的 org-admin 裁定还在——两条用例都要", () => {
  const discoverSrc = stripComments(readFileSync(DISCOVER_USE_CASE, "utf8"));
  const listSrc = stripComments(readFileSync(LIST_USE_CASE, "utf8"));

  it("`discoverRemoteMcpTools`：admin 判定在 servers.upsertDiscovered 调用之前", () => {
    expect(discoverSrc).toMatch(/membership\.orgRole\s*!==\s*"admin"/);
    expect(discoverSrc).toContain("DiscoverRemoteMcpToolsError");
    const gateAt = discoverSrc.indexOf('membership.orgRole !== "admin"');
    const storeAt = discoverSrc.indexOf("servers.upsertDiscovered(");
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(storeAt).toBeGreaterThan(gateAt);
  });

  it("变异：把 discoverRemoteMcpTools 的 admin 判定整个删掉，断言必须变红", () => {
    const gateLine = 'if (!membership || membership.orgRole !== "admin") {\n    throw new DiscoverRemoteMcpToolsError(input.actorId);\n  }';
    expect(discoverSrc, "变异目标串已经漂移——先去看这条判定现在长什么样").toContain(gateLine);
    const mutated = discoverSrc.replace(gateLine, "");
    expect(mutated).not.toBe(discoverSrc);
    expect(() => {
      expect(mutated).toMatch(/membership\.orgRole\s*!==\s*"admin"/);
    }).toThrow();
  });

  it("`listMcpServers`：admin 判定在 servers.listForOrg 调用之前", () => {
    expect(listSrc).toMatch(/membership\.orgRole\s*!==\s*"admin"/);
    expect(listSrc).toContain("ListMcpServersError");
    const gateAt = listSrc.indexOf('membership.orgRole !== "admin"');
    const storeAt = listSrc.indexOf("deps.servers.listForOrg(");
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(storeAt).toBeGreaterThan(gateAt);
  });

  it("变异：把 listMcpServers 的 admin 判定整个删掉，断言必须变红", () => {
    const gateLine = 'if (!membership || membership.orgRole !== "admin") {\n    throw new ListMcpServersError(input.actorId);\n  }';
    expect(listSrc, "变异目标串已经漂移——先去看这条判定现在长什么样").toContain(gateLine);
    const mutated = listSrc.replace(gateLine, "");
    expect(mutated).not.toBe(listSrc);
    expect(() => {
      expect(mutated).toMatch(/membership\.orgRole\s*!==\s*"admin"/);
    }).toThrow();
  });
});

describe("豁免条目与本测试互相钉住", () => {
  it("ALLOWLIST 里有这两条，且都点名了本文件", () => {
    const lint = readFileSync(LINT, "utf8");
    expect(lint).toContain("src/infrastructure/mcp/pg-mcp-server-store.ts");
    expect(lint).toContain("src/infrastructure/mcp/pg-mcp-tool-store.ts");
    expect(lint).toContain("pg-mcp-server-store-guard.test.ts");
  });
});
