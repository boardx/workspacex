/**
 * 挡住"组织自建/导入的 skill 与平台官方 skill 同名"这条新的重复来源。
 *
 * ## 这条测试挡的是什么
 *
 * `listAll()`（`pg-skill-contract-repository.ts`，`GET /skills` 唯一实现，chat `#`
 * 挂载池与 `/skill` 目录都读这条）对每个组织都会把平台组织（`org-platform`，四个官方
 * skill：pptx-create/docx-create/xlsx-create/pdf-create）的行 `OR org_id =
 * PLATFORM_ORG_ID` 拼进结果，**不做任何按名字去重**（design-delta
 * `platform-owned-skills` 只签核了读可见性放宽，没有讨论过同名碰撞）。
 *
 * 而三条写路径原有的重名检查——`skills_name_casefold_uniq`/`capability_listings_uniq`/
 * `skill_contracts_name_uniq`——全部是 `(org_id, ...)` 维度的唯一约束，只挡得住
 * "同一个组织内部"重名，对平台组织的行永远不会触发。于是一个组织可以悄悄声明/导入/
 * 上架一个和某个官方 skill 同名的 skill（比如都叫"Excel 表格生成"），两条会同时出现在
 * `listAll()` 的结果里，chat 的 `#` 挂载列表与 `/skill` 目录会看到同一个名字两次，
 * 且两条都能被独立挂载——这正是本次修复要堵住的洞。
 *
 * 覆盖三条写路径，各自反证"改之前会成功创建出重复、改之后被拒绝"没有意义（改动已经
 * 落地，不再有"改之前"可比较），所以直接断言"现在会被拒绝，且不落库"。
 *
 * ① URL 导入（`PgSkillUrlImportRepository.persist`，经 `importSkillFromUrl` 用例）
 * ② starter-pack 导入（`PgSkillStarterImportRepository.persistVerified`）
 * ③ 声明式草稿（`ScopedPgSkillContractRepository.saveDraft`）
 *
 * 反空转：每条都先证明"用一个不撞名的名字，同样的写路径能正常成功"（装置自检——
 * 排除"这个仓储从此谁都创建不了 skill 了"这种更粗暴但错误的修法）。
 */
import { randomUUID } from "node:crypto";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { backfillPlatformOrg } from "../../scripts/backfill-platform-org";
import { backfillPlatformSkills, OFFICIAL_SKILLS } from "../../scripts/backfill-platform-skills";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import { importSkillFromUrl } from "../../src/application/skill-import/import-skill-from-url";
import type { ImportSourceFetcher } from "../../src/application/skill-import/import-skill-from-url";
import { ImportSkillFromUrlError } from "../../src/application/skill-import/url-import-draft";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgSkillStarterImportRepository } from "../../src/infrastructure/skill/pg-skill-starter-import-repository";
import { PgSkillContractRepository } from "../../src/infrastructure/skill/pg-skill-contract-repository";
import { SkillNameConflictError } from "../../src/application/skill/ports";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { testTlsMaterial } from "../support/tls";
import { toOrgId } from "../../src/domain/org-id";
import { sha256 } from "../../src/domain/skill/starter-pack";

const XLSX_SKILL = OFFICIAL_SKILLS.find((s) => s.stableName === "xlsx-create")!;
const ADMIN: any = { findOrgMembership: async () => ({ orgRole: "admin" }) };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await backfillPlatformOrg();
  await backfillPlatformSkills();
}, 180_000);

/* ═══════════════════════ ① URL 导入 ═══════════════════════ */

describe("① URL 导入：与平台官方 skill 同名（大小写不敏感）被拒绝，不落库", () => {
  const ORG = "org-platform-collision-url-import";
  const ACTOR = "u-platform-collision-url-import";

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
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-platform-collision-url-import" });
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

  it("装置自检：不撞名的名字正常导入成功", async () => {
    handler = (_req, res) => { res.writeHead(200, { "content-type": "text/markdown" }); res.end("# ok\n"); };
    const result = await importSkillFromUrl(
      {
        orgId: ORG, actorId: ACTOR,
        // ⚠ 单文件导入的落地路径按取回后 URL 的最后一段算（`filePathFor`，
        // `import-skill-from-url.ts`），不是固定成 "SKILL.md"——URL 必须以
        // `/SKILL.md` 结尾，落地文件才会恰好叫 "SKILL.md"，否则
        // `wave2_publish_skill_version` 的"必须恰好一个根 SKILL.md"不变量会拒绝
        // 发布（P0001）。这条是通过用例，必须真的能发布成功，路径不能随便起名。
        sourceUrl: `https://allowed.example:${port}/SKILL.md`,
        name: "URL 导入不撞名对照组",
        idempotencyKey: `ok-${randomUUID()}`,
      },
      { identities: ADMIN, fetch: fetcher(), repository, policy: { localOnlyOrg: false } },
    );
    expect(result.skillId).toBeTruthy();
  });

  it("与平台 xlsx-create 同名（大小写不同）：抛 IMPORT_NAME_CONFLICT，不落 skills 行", async () => {
    handler = (_req, res) => { res.writeHead(200, { "content-type": "text/markdown" }); res.end("# collide\n"); };
    const collidingName = XLSX_SKILL.displayName; // "Excel 表格生成"——中文无大小写，逐字撞
    let caught: unknown = null;
    try {
      await importSkillFromUrl(
        {
          orgId: ORG, actorId: ACTOR,
          sourceUrl: `https://allowed.example:${port}/SKILL-collide.md`,
          name: collidingName,
          idempotencyKey: `collide-${randomUUID()}`,
        },
        { identities: ADMIN, fetch: fetcher(), repository, policy: { localOnlyOrg: false } },
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ImportSkillFromUrlError);
    expect((caught as ImportSkillFromUrlError).code).toBe("IMPORT_NAME_CONFLICT");

    const rows = await asApp(ORG, (c) => c.query(
      `SELECT count(*)::int AS n FROM skills WHERE org_id = $1 AND lower(name) = lower($2)`,
      [ORG, collidingName],
    ));
    expect(rows.rows[0]!.n).toBe(0);
  });
});

/* ═══════════════════════ ② starter-pack 导入 ═══════════════════════ */

describe("② starter-pack 导入：与平台官方 skill 同名被拒绝，不落库", () => {
  const ORG = "org-platform-collision-starter-import";
  const ACTOR = "u-platform-collision-starter-import";
  let repo: PgSkillStarterImportRepository;

  beforeAll(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-platform-collision-starter-import" });
    repo = new PgSkillStarterImportRepository(new PgDatabase(appConfig()));
  });

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  function fileEntry(body: string) {
    return {
      path: "SKILL.md",
      mediaType: "text/markdown",
      digest: sha256(body),
      contentBase64: Buffer.from(body, "utf8").toString("base64"),
    };
  }

  it("装置自检：不撞名/不撞 stableName 的 pack 正常创建成功", async () => {
    const outcome = await repo.persistVerified({
      orgId: toOrgId(ORG),
      actorId: ACTOR,
      idempotencyKey: `ok-${randomUUID()}`,
      payloadDigest: sha256("payload-ok"),
      pack: {
        schemaVersion: 1,
        packId: "pack-ok",
        packVersion: "1.0.0",
        packDigest: sha256("digest-ok"),
        skills: [{
          stableName: "starter-collision-ok",
          name: "starter-pack 不撞名对照组",
          semanticVersion: "1.0.0",
          manifest: {},
          files: [fileEntry("# ok\n")],
        }],
      } as never,
    });
    expect(outcome.kind).toBe("created");
  });

  it("stableName 与平台 xlsx-create 相同：name-conflict，不落 skills 行", async () => {
    const outcome = await repo.persistVerified({
      orgId: toOrgId(ORG),
      actorId: ACTOR,
      idempotencyKey: `collide-stablename-${randomUUID()}`,
      payloadDigest: sha256("payload-collide-stablename"),
      pack: {
        schemaVersion: 1,
        packId: "pack-collide-stablename",
        packVersion: "1.0.0",
        packDigest: sha256("digest-collide-stablename"),
        skills: [{
          stableName: XLSX_SKILL.stableName, // "xlsx-create"
          name: "跟平台不同名但 stableName 撞了",
          semanticVersion: "1.0.0",
          manifest: {},
          files: [fileEntry("# collide\n")],
        }],
      } as never,
    });
    expect(outcome.kind).toBe("name-conflict");

    const rows = await asApp(ORG, (c) => c.query(
      `SELECT count(*)::int AS n FROM skills WHERE org_id = $1 AND stable_name = $2`,
      [ORG, XLSX_SKILL.stableName],
    ));
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("display name 与平台官方 skill 同名（stableName 不同）：同样 name-conflict", async () => {
    const outcome = await repo.persistVerified({
      orgId: toOrgId(ORG),
      actorId: ACTOR,
      idempotencyKey: `collide-displayname-${randomUUID()}`,
      payloadDigest: sha256("payload-collide-displayname"),
      pack: {
        schemaVersion: 1,
        packId: "pack-collide-displayname",
        packVersion: "1.0.0",
        packDigest: sha256("digest-collide-displayname"),
        skills: [{
          stableName: "starter-collision-displayname-only",
          name: XLSX_SKILL.displayName, // "Excel 表格生成"
          semanticVersion: "1.0.0",
          manifest: {},
          files: [fileEntry("# collide\n")],
        }],
      } as never,
    });
    expect(outcome.kind).toBe("name-conflict");
  });
});

/* ═══════════════════════ ③ 声明式草稿 ═══════════════════════ */

describe("③ 声明式草稿（saveDraft）：与平台官方 skill 同名被拒绝，不落库", () => {
  const ORG = "org-platform-collision-declarative-draft";
  const ACTOR = "u-platform-collision-declarative-draft";

  beforeAll(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG, projectId: "proj-platform-collision-declarative-draft" });
  });

  afterAll(async () => {
    await resetOrgs(ORG);
  });

  function repoFor(orgId: string) {
    return new PgSkillContractRepository(new PgDatabase(appConfig())).forOrg(orgId);
  }

  const CONTRACT = {
    promptTemplate: "t", inputSchema: "{}", outputSchema: "{}",
    dataScope: [], readsRawTranscript: false, fallbackDeclaration: "f",
  };

  it("装置自检：不撞名的草稿正常创建成功", async () => {
    const saved = await repoFor(ORG).saveDraft({
      orgId: ORG,
      name: "声明式草稿不撞名对照组",
      duty: "d",
      contract: CONTRACT,
      source: "自建", // skill_contracts_source_check 只认 ('自建','晋升生成','CC') 三个中文字面量
      submitterId: ACTOR,
      visibility: "org-wide",
      ownerTeamId: null,
      modelRef: "m",
    });
    expect(saved.skillId).toBeTruthy();
  });

  it("与平台 xlsx-create 逐字同名：抛 SkillNameConflictError，不落 skill_contracts 行", async () => {
    // 中文 displayName 没有大小写变体（同 `capability_listings_uniq` 的口径本身
    // 就是逐字匹配，不像 `skills_name_casefold_uniq` 那样 `lower()`）——用原名即可。
    const collidingName = XLSX_SKILL.displayName;
    let caught: unknown = null;
    try {
      await repoFor(ORG).saveDraft({
        orgId: ORG,
        name: collidingName,
        duty: "d",
        contract: CONTRACT,
        source: "自建", // skill_contracts_source_check 只认 ('自建','晋升生成','CC') 三个中文字面量
        submitterId: ACTOR,
        visibility: "org-wide",
        ownerTeamId: null,
        modelRef: "m",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SkillNameConflictError);

    const rows = await asApp(ORG, (c) => c.query(
      `SELECT count(*)::int AS n FROM skill_contracts WHERE org_id = $1 AND name = $2`,
      [ORG, collidingName],
    ));
    expect(rows.rows[0]!.n).toBe(0);
  });
});
