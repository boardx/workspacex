/**
 * G1（2026-08-14，人类实测：「新建Skill → 从GitHub导入」报 `导入失败：http_500`）——
 * 真根因回归测试。
 *
 * ## 真根因，实测确认（见 `pg-skill-url-import-repository.ts` 文件头 G1 长注）
 *
 * `skills` 表有 `skills_name_casefold_uniq`（`org_id, lower(name)`）唯一约束
 * （`wave2_skill_starter_import` 迁移）。`ImportSkillFromUrlFailure` 类型早就声明了
 * `IMPORT_NAME_CONFLICT`，`skill-url-import.controller.ts` 也早就把它映射到 409——
 * 但在这次修复之前，**没有任何代码真的抛出它**：`persist()` 撞到重名时，原始的
 * Postgres `23505` 一路裸奔到 controller 的 `catch` 块，那里只认
 * `ImportSkillFromUrlError` / `ImportSourceRefusedError` 两种类型，其余一律
 * `throw error`——NestJS 默认异常过滤器把它变成一个**没有 reasonCode** 的裸 500。
 * 前端 `ApiError` 在没有 reasonCode 时把 `message` 缺省成 `` `http_${status}` ``
 * （`apps/web/lib/api-client.ts`），这正是人类看到的「导入失败：http_500」。
 *
 * 这份测试连**真实 Postgres**（同目录 `url-import-persists-real-db.test.ts` 的
 * 套路：走真实用例 → 真实取回层 → 真实仓储，只 stub DNS），先成功导入一个 skill，
 * 再用同一个组织、大小写不同的同名再导入一次——反证这次不再是裸 500。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { assertResolvedAddressAllowed } from "../../src/domain/skill/import-source";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl } from "../../src/application/skill-import/import-skill-from-url";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { ImportSkillFromUrlError } from "../../src/application/skill-import/url-import-draft";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { testTlsMaterial } from "../support/tls";

const ORG = "org-g1-url-import-name-conflict";
const ACTOR = "u-g1-importer";

const ADMIN: any = { findOrgMembership: async () => ({ orgRole: "admin" }) };

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

function fetcher(): ImportSourceFetcher {
  return (rawUrl, policy) =>
    fetchImportSource(rawUrl, policy, { lookup: resolveTo("127.0.0.1"), checkAddress: () => {} });
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-g1-name-conflict" });

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

async function skillCount(name: string): Promise<number> {
  return asApp(ORG, async (client) => {
    const rows = await client.query(
      `SELECT count(*)::int AS n FROM skills WHERE org_id = $1 AND lower(name) = lower($2)`,
      [ORG, name],
    );
    return rows.rows[0]?.n ?? -1;
  });
}

describe("G1：同组织重名 URL 导入不再裸 500，翻成 IMPORT_NAME_CONFLICT", () => {
  it("第一次导入成功；同名（大小写不同）第二次导入抛 ImportSkillFromUrlError(IMPORT_NAME_CONFLICT)，不落第二行", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# first import\n");
    };
    await importSkillFromUrl(
      {
        orgId: ORG,
        actorId: ACTOR,
        sourceUrl: `https://allowed.example:${port}/SKILL.md`,
        name: "重名冲突测试-skill",
        idempotencyKey: "g1-key-first",
      },
      { identities: ADMIN, fetch: fetcher(), repository, policy: { localOnlyOrg: false } },
    );
    expect(await skillCount("重名冲突测试-skill")).toBe(1);

    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/markdown" });
      res.end("# second import, same name different case\n");
    };
    let caught: unknown = null;
    try {
      await importSkillFromUrl(
        {
          orgId: ORG,
          actorId: ACTOR,
          // 大小写不同：`skills_name_casefold_uniq` 按 `lower(name)` 判——不是字面量相等才算撞。
          sourceUrl: `https://allowed.example:${port}/SKILL2.md`,
          name: "重名冲突测试-SKILL",
          idempotencyKey: "g1-key-second",
        },
        { identities: ADMIN, fetch: fetcher(), repository, policy: { localOnlyOrg: false } },
      );
    } catch (error) {
      caught = error;
    }

    // ⚠ 这是本回归测试的核心断言：修复前这里会抛一个**裸 pg 错误**（`code: "23505"`，
    //   不是 `ImportSkillFromUrlError`）——那正是一路冒泡到 controller 变成裸 500 的
    //   那个对象。修复后必须是这个类型化错误，且 `code` 恰好是 `IMPORT_NAME_CONFLICT`，
    //   controller 的 `USE_CASE_STATUS` 表才能把它映射成 409（而不是默认异常过滤器接手）。
    expect(caught).toBeInstanceOf(ImportSkillFromUrlError);
    expect((caught as ImportSkillFromUrlError).code).toBe("IMPORT_NAME_CONFLICT");

    // 第二次没有落库：还是只有第一次那一行，不多一行、也没有把第一行改掉。
    expect(await skillCount("重名冲突测试-skill")).toBe(1);
  });
});
