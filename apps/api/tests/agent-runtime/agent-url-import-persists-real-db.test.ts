/**
 * #1415 —— agent 版的 `tests/skill/url-import-persists-real-db.test.ts`：
 * **产物真的在库里**，走真实用例 → 真实取回层（真 TLS 循环，只换 DNS）→ 真实仓储。
 * 同一条纪律：断言查的是**提交后**的行，不是自己事务内的可见性；负样本也查库，
 * 证明"拒绝了"与"什么都没留下"同时成立。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assertResolvedAddressAllowed } from "../../src/domain/skill/import-source";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importAgentFromUrl } from "../../src/application/agent-import/import-agent-from-url";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { PgCreateAgentRepository, PgSetAgentInstructionsRepository } from "../../src/infrastructure/agent/pg-create-agent-repository";
import { PgAgentUrlImportRepository } from "../../src/infrastructure/agent-import/pg-agent-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { testTlsMaterial } from "../support/tls";

const ORG = "org-i1415-agent-url-import";
const ACTOR = "u-i1415-importer";

/** 真库这条链只验持久化，授权用替身固定为 admin；授权本身的门在单测里证。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ADMIN: any = { findOrgMembership: async () => ({ orgRole: "admin" }) };

let server: https.Server;
let port = 0;
let handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;
let savedCa: unknown;
let agents: PgCreateAgentRepository;
let instructions: PgSetAgentInstructionsRepository;
let imports: PgAgentUrlImportRepository;

function resolveTo(address: string): ImportFetchSeams["lookup"] {
  const fn = (_h: string, o: { all?: boolean } | undefined, cb: Function): void =>
    o?.all === true ? cb(null, [{ address, family: 4 }]) : cb(null, address, 4);
  return fn as unknown as ImportFetchSeams["lookup"];
}

/** 生产取回层，只换 DNS。`allowLoopback` 仅用于让测试服务器可达。 */
function fetcher(allowLoopback: boolean): ImportSourceFetcher {
  return (rawUrl, policy) =>
    fetchImportSource(rawUrl, policy, {
      lookup: resolveTo(allowLoopback ? "127.0.0.1" : "169.254.169.254"),
      checkAddress: allowLoopback ? () => {} : assertResolvedAddressAllowed,
    });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i1415-agent-url-import" });

  const { cert, key } = testTlsMaterial();
  server = https.createServer({ key, cert }, (req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];

  const db = new PgDatabase(appConfig());
  agents = new PgCreateAgentRepository(db);
  instructions = new PgSetAgentInstructionsRepository(db);
  imports = new PgAgentUrlImportRepository(db);
}, 180_000);

afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await resetOrgs(ORG);
});

/** ⚠ 独立事务里查——证明的是**已提交**的行，不是自己事务内的可见性。 */
async function readBack(agentId: string): Promise<{
  readonly name: string;
  readonly publishState: string;
  readonly instructions: string | null;
  readonly toolWhitelist: unknown;
} | null> {
  return asApp(ORG, async (client) => {
    const row = await client.query(
      `SELECT name, publish_state, instructions, tool_whitelist
         FROM agents WHERE org_id = $1 AND id = $2`,
      [ORG, agentId],
    );
    const r = row.rows[0];
    if (r === undefined) return null;
    return {
      name: r.name,
      publishState: r.publish_state,
      instructions: r.instructions,
      toolWhitelist: r.tool_whitelist,
    };
  });
}

describe("agent 版 URL 导入的产物真的落进 agents 表", () => {
  it("导入成功 ⇒ agents 有已提交的草稿行，指令是取回的真实字节", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("把用户说的每一件事整理成带编号的要点。\n");
    };
    const result = await importAgentFromUrl(
      {
        orgId: ORG,
        actorId: ACTOR,
        sourceUrl: `https://allowed.example:${port}/agent.md`,
        name: "url-imported-agent",
        idempotencyKey: "i1415-key-ok",
      },
      { identities: ADMIN, fetch: fetcher(true), agents, instructions, imports, policy: { localOnlyOrg: false } },
    );

    expect(result.replayed).toBe(false);
    expect(result.publishState).toBe("草稿");
    expect(result.instructions).toBe("把用户说的每一件事整理成带编号的要点。");

    const stored = await readBack(result.agentId);
    expect(stored).not.toBeNull();
    expect(stored!.name).toBe("url-imported-agent");
    expect(stored!.publishState).toBe("草稿");
    expect(stored!.instructions).toBe("把用户说的每一件事整理成带编号的要点。");
    // I-30 的同一条不变量：从零新建（导入也是从零新建的一种）恒空白名单。
    expect(stored!.toolWhitelist).toEqual([]);
  });

  it("同一幂等键重复导入 ⇒ 回放同一个 agent，不产生第二行", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("重复导入应当回放这份指令。\n");
    };
    const input = {
      orgId: ORG,
      actorId: ACTOR,
      sourceUrl: `https://allowed.example:${port}/agent.md`,
      name: "idempotent-agent",
      idempotencyKey: "i1415-key-idem",
    };
    const deps = { identities: ADMIN, fetch: fetcher(true), agents, instructions, imports, policy: { localOnlyOrg: false } };
    const first = await importAgentFromUrl(input, deps);
    const second = await importAgentFromUrl(input, deps);
    expect(second.agentId).toBe(first.agentId);
    expect(second.replayed).toBe(true);

    const count = await asApp(ORG, async (client) => {
      const rows = await client.query(
        `SELECT count(*)::int AS n FROM agent_url_imports
          WHERE org_id = $1 AND idempotency_key = $2`,
        [ORG, "i1415-key-idem"],
      );
      return rows.rows[0]?.n ?? -1;
    });
    expect(count).toBe(1);
  });

  /**
   * ⚠ 负样本必须**也**查库：只断言「抛错」不够——一个先落库再抛错的实现同样会绿。
   */
  it("SSRF 被拒 ⇒ 抛错，且库里一行都没有", async () => {
    const before = await asApp(ORG, async (client) => {
      const rows = await client.query(`SELECT count(*)::int AS n FROM agents WHERE org_id = $1`, [ORG]);
      return rows.rows[0]?.n ?? -1;
    });

    await expect(
      importAgentFromUrl(
        {
          orgId: ORG,
          actorId: ACTOR,
          sourceUrl: "https://metadata.example/agent.md",
          name: "should-never-exist",
          idempotencyKey: "i1415-key-ssrf",
        },
        { identities: ADMIN, fetch: fetcher(false), agents, instructions, imports, policy: { localOnlyOrg: false } },
      ),
    ).rejects.toThrow();

    const after = await asApp(ORG, async (client) => {
      const named = await client.query(
        `SELECT count(*)::int AS n FROM agents WHERE org_id = $1 AND name = 'should-never-exist'`,
        [ORG],
      );
      const imports = await client.query(
        `SELECT count(*)::int AS n FROM agent_url_imports WHERE org_id = $1 AND idempotency_key = 'i1415-key-ssrf'`,
        [ORG],
      );
      const total = await client.query(`SELECT count(*)::int AS n FROM agents WHERE org_id = $1`, [ORG]);
      return { named: named.rows[0]?.n ?? -1, imports: imports.rows[0]?.n ?? -1, total: total.rows[0]?.n ?? -1 };
    });
    expect(after.named).toBe(0);
    expect(after.imports).toBe(0);
    expect(after.total).toBe(before);
  });

  it("重名 ⇒ IMPORT_NAME_CONFLICT，不产生第二个 agent", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("第一次导入的内容。\n");
    };
    const deps = { identities: ADMIN, fetch: fetcher(true), agents, instructions, imports, policy: { localOnlyOrg: false } };
    await importAgentFromUrl(
      {
        orgId: ORG, actorId: ACTOR,
        sourceUrl: `https://allowed.example:${port}/agent.md`,
        name: "duplicate-name-agent",
        idempotencyKey: "i1415-key-dup-1",
      },
      deps,
    );

    await expect(
      importAgentFromUrl(
        {
          orgId: ORG, actorId: ACTOR,
          sourceUrl: `https://allowed.example:${port}/agent.md`,
          name: "duplicate-name-agent",
          idempotencyKey: "i1415-key-dup-2",
        },
        deps,
      ),
    ).rejects.toThrow("IMPORT_NAME_CONFLICT");

    const count = await asApp(ORG, async (client) => {
      const rows = await client.query(
        `SELECT count(*)::int AS n FROM agents WHERE org_id = $1 AND lower(name) = lower('duplicate-name-agent')`,
        [ORG],
      );
      return rows.rows[0]?.n ?? -1;
    });
    expect(count).toBe(1);
  });
});
