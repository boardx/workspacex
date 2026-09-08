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
import type { AddressInfo } from "node:net";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assertResolvedAddressAllowed } from "../../src/domain/skill/import-source";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl } from "../../src/application/skill-import/import-skill-from-url";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { testTlsMaterial } from "../support/tls";

const ORG = "org-i595-url-import";
const ACTOR = "u-i595-importer";

/** 真库这条链只验持久化，授权用替身固定为 admin；授权本身的门在单测里证。 */
const ADMIN: any = { findOrgMembership: async () => ({ orgRole: "admin" }) };

/**
 * 2026-08-07 补：后台「Skill 目录」页读的是 `capability_listings`（`GET
 * /capabilities?kind=skill`），不是 `skills`/`skill_versions` 本身——见
 * `pg-skill-url-import-repository.ts` 文件头 2026-08-07 补注。这是那句人类实测
 * "我在后台不能看到导入了的 skills" 的真实机制，本文件因此要断言这张表，不能只
 * 断言运行时读的那三张。
 */
async function readCapabilityListing(orgId: string, name: string): Promise<{
  readonly count: number;
  readonly kind: string | null;
  readonly enabled: boolean | null;
}> {
  return asApp(orgId, async (client) => {
    const rows = await client.query(
      `SELECT kind, enabled FROM capability_listings WHERE org_id = $1 AND name = $2`,
      [orgId, name],
    );
    return {
      count: rows.rows.length,
      kind: rows.rows[0]?.kind ?? null,
      enabled: rows.rows[0]?.enabled ?? null,
    };
  });
}

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

  // ⚠ 当场生成，**不读入库文件**：`.gitignore` 有 `*.pem`，入库那条路走不通，
  //   而「本地有、CI 没有」正是 PR #600 那次 CI 红的根因。见 `tests/support/tls.ts`。
  const { cert, key } = testTlsMaterial();
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
  readonly skillId: string;
  readonly stableName: string;
}> {
  return asApp(ORG, async (client) => {
    const version = await client.query(
      `SELECT v.published, v.skill_id, s.name, s.stable_name
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
      skillId: version.rows[0]?.skill_id ?? "",
      stableName: version.rows[0]?.stable_name ?? "",
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
      { identities: ADMIN, fetch: fetcher(true), repository, policy: { localOnlyOrg: false } },
    );

    const stored = await readBack(result.versionId);
    expect(stored.skillName).toBe("url-imported-skill");
    // G2（2026-09-07 人类实测）：`stable_name` 是 chat 阶段文案「正在执行技能脚本
    // （…）」直接回显的那个值（`agent-run-phase.ts` 的 `phaseLabelForCallSkillArgs`）
    // ——它不能是内部 skill id，否则用户看到的是一串 `sk_<uuid>` 而不是名字。
    expect(stored.stableName).toBe("url-imported-skill");
    expect(stored.stableName).not.toBe(stored.skillId);
    expect(stored.files).toHaveLength(1);
    expect(stored.files[0]!.path).toBe("SKILL.md");
    // ⚠ 断言真实字节，不只是「有一行」。
    expect(stored.files[0]!.content).toBe("# imported skill\n");
    expect(stored.files[0]!.digest).toBe(result.contentDigest);
    // 发布只能由 wave2_publish_skill_version 完成——这条锁住那条路径真的走了。
    expect(stored.published).toBe(true);

    // 后台「Skill 目录」页实际读的那张表——不是 skills/skill_versions 本身。
    const listing = await readCapabilityListing(ORG, "url-imported-skill");
    expect(listing.count).toBe(1);
    expect(listing.kind).toBe("skill");
    expect(listing.enabled).toBe(true);
  });

  it("展示名含中文 ⇒ stable_name 是合规的 skill-<hex>（不是中文原名、不是 ascii 残片、不是内部 id）——#3033 原生 run 必须能吃", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# imported skill\n");
    };
    const result = await importSkillFromUrl(
      {
        orgId: ORG,
        actorId: ACTOR,
        sourceUrl: `https://allowed.example:${port}/SKILL.md`,
        name: "AI 转型洞察报告",
        idempotencyKey: "i595-key-zh",
      },
      { identities: ADMIN, fetch: fetcher(true), repository, policy: { localOnlyOrg: false } },
    );
    const stored = await readBack(result.versionId);
    // #3033：2026-09-08 DevApp 实测，非 ASCII 的 stable_name 让该组织每条原生 run 在
    // 调模型前就 `native_invalid_skill_stable_name` 失败。身份字段只保证合规+稳定，
    // 可读性由 name 承担（G2 的诉求改由展示层读 name 满足）。
    expect(stored.stableName).toMatch(/^skill-[0-9a-f]{8}$/);
    expect(stored.stableName).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(stored.stableName).not.toBe("ai");
    expect(stored.stableName).not.toBe(stored.skillId);
    expect(stored.skillName).toBe("AI 转型洞察报告");
  });

  it("stable_name 撞车（重复导入同名 skill）⇒ 追加数字后缀，不是唯一约束报错", async () => {
    const importOnce = (idempotencyKey: string) => {
      handler = (_req, res) => {
        res.writeHead(200, { "content-type": "text/markdown" });
        res.end("# imported skill\n");
      };
      return importSkillFromUrl(
        {
          orgId: ORG,
          actorId: ACTOR,
          sourceUrl: `https://allowed.example:${port}/SKILL.md`,
          // 用两个不同的展示名，但 ascii 化后落到同一个 slug —— "Report!!" 与
          // "report" 都会削成 "report"；`skills_name_casefold_uniq` 只挡「同名」，
          // 挡不住「不同名但同 slug」，这条覆盖的正是这一种碰撞。
          name: idempotencyKey === "i595-key-slug-a" ? "Report!!" : "report",
          idempotencyKey,
        },
        { identities: ADMIN, fetch: fetcher(true), repository, policy: { localOnlyOrg: false } },
      );
    };
    const first = await importOnce("i595-key-slug-a");
    const second = await importOnce("i595-key-slug-b");
    const [firstStored, secondStored] = await Promise.all([
      readBack(first.versionId),
      readBack(second.versionId),
    ]);
    expect(firstStored.stableName).toBe("report");
    expect(secondStored.stableName).toBe("report-2");
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
      identities: ADMIN,
      fetch: fetcher(true),
      repository,
      policy: { localOnlyOrg: false },
    });
    const second = await importSkillFromUrl(input, {
      identities: ADMIN,
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

    // 回放不重复插目录行——`skillId` 是 `capability_listings.id`，回放路径根本
    // 不会再次执行 INSERT（早在 `existing !== undefined` 分支就返回了）。
    const listing = await readCapabilityListing(ORG, "idempotent-skill");
    expect(listing.count).toBe(1);
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
        { identities: ADMIN, fetch: fetcher(false), repository, policy: { localOnlyOrg: false } },
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

    // 拒绝路径压根不到达 capability_listings 那条 INSERT——同样什么都不留。
    const listing = await readCapabilityListing(ORG, "should-never-exist");
    expect(listing.count).toBe(0);
  });
});
