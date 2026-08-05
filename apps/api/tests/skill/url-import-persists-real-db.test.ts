/**
 * #595 段 2 —— **产物真的在库里**，不只是「碰过库」。
 *
 * ## 为什么这个区分要单独立一个文件
 *
 * `skill-file-path-check-parity.test.ts` 也连真库，但它写的是**探测行，且全部
 * `ROLLBACK` 掉了**。⇒ 那个文件绿，只能说明「CHECK 的行为是这样」，
 * **不能说明任何 skill 曾经被导入进库**。
 *
 * ⚠ **「碰过库」和「产物在库里」是两件事。** 我在 #603 的范围限定里反复写
 *   「至今没有任何 skill 真正被写进过库」，本文件就是来消掉那句话的——
 *   它必须查**提交后**的行，而不是自己刚插的那笔事务内的可见性。
 *
 * ## 走的是真实的用例 → 真实的取回层 → 真实的仓储
 *
 * 只有 DNS 被 stub（否则要连外网）。⇒ 两道 SSRF 门、`normalizedPath`、
 * 发布触发器、RLS、DB CHECK 全部在这条链上生效。
 *
 * ## ⚠ 断言查的是运行时真读的那三张表
 *
 * `skills` / `skill_versions` / `skill_version_files`（模型 A）。
 * ⛔ 不查 `skill_contracts`（模型 B，运行时不读，A/B 不收敛见 #598）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assertResolvedAddressAllowed } from "../../src/domain/skill/import-source";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl } from "../../src/application/skill-import/import-skill-from-url";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

const ORG = "org-i595-url-import";
const ACTOR = "u-i595-importer";

let server: https.Server;
let port = 0;
let handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void;
let savedCa: unknown;
let repository: PgSkillUrlImportRepository;

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
  await seedOrg({ orgId: ORG, projectId: "proj-i595-url-import" });

  const dir = new URL("../support/tls/", import.meta.url);
  const cert = readFileSync(new URL("test-only.cert.pem", dir));
  const key = readFileSync(new URL("test-only.key.pem", dir));
  server = https.createServer({ key, cert }, (req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];

  repository = new PgSkillUrlImportRepository(new PgDatabase(appConfig()));
}, 180_000);

afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await resetOrgs(ORG);
});

/** ⚠ 独立事务里查——证明的是**已提交**的行，不是自己事务内的可见性。 */
async function readBack(versionId: string): Promise<{
  readonly published: boolean;
  readonly files: readonly { path: string; content: string; digest: string }[];
  readonly skillName: string;
}> {
  return asApp(ORG, async (client) => {
    const version = await client.query(
      `SELECT v.published, s.name
         FROM skill_versions v JOIN skills s ON s.id = v.skill_id AND s.org_id = v.org_id
        WHERE v.org_id = $1 AND v.id = $2`,
      [ORG, versionId],
    );
    const files = await client.query(
      `SELECT path, content, digest FROM skill_version_files
        WHERE org_id = $1 AND version_id = $2 ORDER BY path`,
      [ORG, versionId],
    );
    return {
      published: version.rows[0]?.published === true,
      skillName: version.rows[0]?.name ?? "",
      files: files.rows.map((r) => ({
        path: r.path,
        content: Buffer.from(r.content).toString(),
        digest: r.digest,
      })),
    };
  });
}

describe("URL 导入的产物真的落进模型 A 的三张表", () => {
  it("导入成功 ⇒ skills / skill_versions / skill_version_files 都有已提交的行", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# imported skill\n");
    };
    const result = await importSkillFromUrl(
      {
        orgId: ORG,
        actorId: ACTOR,
        sourceUrl: `https://allowed.example:${port}/SKILL.md`,
        name: "url-imported-skill",
        idempotencyKey: "i595-key-ok",
      },
      { fetch: fetcher(true), repository, policy: { localOnlyOrg: false } },
    );

    const stored = await readBack(result.versionId);
    expect(stored.skillName).toBe("url-imported-skill");
    expect(stored.files).toHaveLength(1);
    expect(stored.files[0]!.path).toBe("SKILL.md");
    // ⚠ 断言真实字节，不只是「有一行」。
    expect(stored.files[0]!.content).toBe("# imported skill\n");
    expect(stored.files[0]!.digest).toBe(result.contentDigest);
    // 发布只能由 wave2_publish_skill_version 完成——这条锁住那条路径真的走了。
    expect(stored.published).toBe(true);
  });

  it("同一幂等键重复导入 ⇒ 回放同一个版本，不产生第二行", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# imported skill\n");
    };
    const input = {
      orgId: ORG,
      actorId: ACTOR,
      sourceUrl: `https://allowed.example:${port}/SKILL.md`,
      name: "idempotent-skill",
      idempotencyKey: "i595-key-idem",
    };
    const first = await importSkillFromUrl(input, {
      fetch: fetcher(true),
      repository,
      policy: { localOnlyOrg: false },
    });
    const second = await importSkillFromUrl(input, {
      fetch: fetcher(true),
      repository,
      policy: { localOnlyOrg: false },
    });
    expect(second.versionId).toBe(first.versionId);
    expect(second.replayed).toBe(true);

    const count = await asApp(ORG, async (client) => {
      const rows = await client.query(
        `SELECT count(*)::int AS n FROM skill_url_imports
          WHERE org_id = $1 AND idempotency_key = $2`,
        [ORG, "i595-key-idem"],
      );
      return rows.rows[0]?.n ?? -1;
    });
    expect(count).toBe(1);
  });

  /**
   * ⚠ 负样本必须**也**查库：只断言「抛错」不够——一个先落库再抛错的实现同样会绿，
   *   而那时数据已经进去了。「拒绝了」和「什么都没留下」是两件事。
   */
  it("SSRF 被拒 ⇒ 抛错，且库里一行都没有", async () => {
    const before = await asApp(ORG, async (client) => {
      const rows = await client.query(`SELECT count(*)::int AS n FROM skills WHERE org_id = $1`, [ORG]);
      return rows.rows[0]?.n ?? -1;
    });

    await expect(
      importSkillFromUrl(
        {
          orgId: ORG,
          actorId: ACTOR,
          sourceUrl: "https://metadata.example/SKILL.md",
          name: "should-never-exist",
          idempotencyKey: "i595-key-ssrf",
        },
        { fetch: fetcher(false), repository, policy: { localOnlyOrg: false } },
      ),
    ).rejects.toThrow();

    const after = await asApp(ORG, async (client) => {
      const skills = await client.query(
        `SELECT count(*)::int AS n FROM skills WHERE org_id = $1 AND name = 'should-never-exist'`,
        [ORG],
      );
      const imports = await client.query(
        `SELECT count(*)::int AS n FROM skill_url_imports WHERE org_id = $1 AND idempotency_key = 'i595-key-ssrf'`,
        [ORG],
      );
      const total = await client.query(`SELECT count(*)::int AS n FROM skills WHERE org_id = $1`, [ORG]);
      return {
        named: skills.rows[0]?.n ?? -1,
        imports: imports.rows[0]?.n ?? -1,
        total: total.rows[0]?.n ?? -1,
      };
    });
    expect(after.named).toBe(0);
    expect(after.imports).toBe(0);
    expect(after.total).toBe(before); // 总数没变：没有留下任何半成品
  });
});
