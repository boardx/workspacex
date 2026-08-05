/**
 * #595 段 2 —— **`/admin/skills/url-imports` 从 HTTP 真的可达，而且门都还在。**
 *
 * ## 这个文件要消掉的那句话
 *
 * 交接里逐字写着：「⚠ `/admin/skills/url-imports` 今天从 HTTP 不可达 —— 整条链
 * 只能从测试里调用。」在此之前，42 条断言证明的是「**如果**有人调用它，它会正确」，
 * 而没有人调用它。这与反证④（摘掉调用点 ⇒ 测函数的 18 条全绿）是同一个形状。
 *
 * ## ⚠ 三种今晚真实发生过的空转，本文件逐条规避
 *
 * ① **只断言 `status >= 400`** —— 今天本来就绿（路由不存在也 4xx）。
 *    ⇒ 每一条负样本都断言**具体的 status + 具体的 `reasonCode`**。
 * ② **`answers 404` 型** —— Nest 对未知路径同样 404，所以「404 就算过」什么都没证。
 *    ⇒ 必须配**正样本**：一个正当请求必须**成功**（见第一条 it）。
 * ③ **只断言「抛错了」** —— 一个**先落库再抛错**的实现同样会绿。
 *    ⇒ 每一条负样本都同时断言**库里什么都没留下**（`counts()` 逐表比对）。
 *
 * ## 正样本为什么走回放路径，而不是真的取回一次
 *
 * 生产装配绑的是 `fetchImportSource` **本身**（`url-import-binding-guard` 用同一性
 * 断言钉死），⇒ 从 HTTP 打进来时**没有接缝**可以换掉 DNS，两道门是真的在跑，
 * 而它们**拒绝一切非公网地址**——本机起的测试服务器必然在 loopback 上。
 *
 * ⇒ 想在 HTTP 层跑一次「真的把字节取回来」，就得连外网。本文件不连外网，
 *   改用**回放**做正样本：先用真实用例（DNS 打桩）把一次导入做进库，
 *   再用同一个 `idempotencyKey` 从 HTTP 打进来。这条路径经过
 *   principal → 组织查询 → `localOnlyOrg` 推导 → 授权 → 仓储 → 契约 out 解析，
 *   **唯独没经过网络**。
 *
 * ⚠ **所以本文件不证明「取回层从 HTTP 打进来能真的下载成功」。**
 *   那条只在 `url-import-persists-real-db.test.ts`（用例层，DNS 打桩）证过。
 *   HTTP 层的真实下载**仍未验证**，已写进 PR 的未验证项清单。⛔ 别把这里的绿读成那件事。
 */
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { wave2Runtime as C } from "@repo/contracts";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { fetchImportSource, type ImportFetchSeams } from "../../src/infrastructure/skill/http-import-fetcher";
import {
  importSkillFromUrl,
  IMPORT_SKILL_FROM_URL_DEPS_FACTORY,
  type ImportSkillFromUrlDepsFactory,
  type ImportSourceFetcher,
} from "../../src/application/skill-import/import-skill-from-url";
import { PgSkillUrlImportRepository } from "../../src/infrastructure/skill/pg-skill-url-import-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i595-http-import";
const LOCAL_ORG = "org-i595-http-import-local";
const ADMIN = "u-i595-http-admin";
const MEMBER = "u-i595-http-member";
const LOCAL_OWNER = "u-i595-http-local-owner";

/**
 * 一个**字面量就会被第一道门拒**的地址。
 *
 * ⚠ 选它是为了让负样本**离线且确定**：不解析 DNS、不发包，判定完全由
 *   `classifyAddress` 给出。⇒ 测试的红/绿不取决于本机有没有网。
 */
const BLOCKED_URL = "https://127.0.0.1/SKILL.md";

let app: NestExpressApplication;
let base = "";
let server: https.Server;
let port = 0;
let savedCa: unknown;

const authFor = (userId: string, orgId: string) => ({
  "x-kernel-test-principal": `${userId}:${orgId}`,
  "content-type": "application/json",
});

function post(
  userId: string,
  orgId: string,
  body: unknown,
  path = "/admin/skills/url-imports",
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: authFor(userId, orgId),
    body: JSON.stringify(body),
  });
}

/**
 * 逐表计数。⚠ 负样本断言「什么都没留下」靠的就是它——
 * 一个先落库再抛错的实现会在这里被抓住，而只断言「抛错了」的测试抓不住。
 */
type CountedTable = "skills" | "skill_versions" | "skill_version_files" | "skill_url_imports";

async function counts(orgId: string): Promise<Record<CountedTable, number>> {
  const tables: readonly CountedTable[] = [
    "skills", "skill_versions", "skill_version_files", "skill_url_imports",
  ];
  return asApp(orgId, async (client) => {
    const out = {} as Record<CountedTable, number>;
    for (const table of tables) {
      const rows = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE org_id = $1`,
        [orgId],
      );
      out[table] = Number(rows.rows[0]?.n ?? "0");
    }
    return out;
  });
}

/** 生产取回层，只把 DNS 指到测试服务器——仅用于**造 fixture**，不用于任何断言。 */
function loopbackFetcher(): ImportSourceFetcher {
  const lookup = ((_h: string, o: { all?: boolean } | undefined, cb: Function): void =>
    o?.all === true ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4)) as
    unknown as ImportFetchSeams["lookup"];
  return (rawUrl, policy) => fetchImportSource(rawUrl, policy, { lookup, checkAddress: () => {} });
}

/** fixture：真的导入一次，好让 HTTP 那一发能命中回放。 */
async function seedImport(idempotencyKey: string, name = "HTTP route fixture skill"): Promise<{ skillId: string; versionId: string }> {
  return importSkillFromUrl(
    {
      orgId: ORG,
      actorId: ADMIN,
      sourceUrl: `https://allowed.example:${port}/SKILL.md`,
      name,
      idempotencyKey,
    },
    {
      identities: { findOrgMembership: async () => ({ orgRole: "admin" }) } as never,
      fetch: loopbackFetcher(),
      repository: new PgSkillUrlImportRepository(new PgDatabase(appConfig())),
      policy: { localOnlyOrg: false },
    },
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, LOCAL_ORG);
  await seedOrg({ orgId: ORG, projectId: "proj-i595-http-import" });
  await addOrgMember(ORG, ADMIN, "admin", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await seedOrg({
    orgId: LOCAL_ORG,
    kind: "personal-local",
    ownerUserId: LOCAL_OWNER,
    projectId: "proj-i595-http-import-local",
  });
  /**
   * ⚠ 实测踩到的顺序事实，记在这里免得下一个人重踩：**授权门排在本地组织门之前**。
   * owner 不挂 admin 成员资格时，这条用例返回的是 `IMPORT_NOT_ORG_ADMIN` 而不是
   * `IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG` —— 那个顺序是对的（授权必须在取回之前），
   * 但它意味着**想测本地组织门就必须先过授权门**。
   */
  await addOrgMember(LOCAL_ORG, LOCAL_OWNER, "admin", null);

  const dir = new URL("../support/tls/", import.meta.url);
  const cert = readFileSync(new URL("test-only.cert.pem", dir));
  const key = readFileSync(new URL("test-only.key.pem", dir));
  server = https.createServer({ key, cert }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/markdown" });
    res.end("# Imported over HTTP\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  savedCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = [cert];

  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}, 180_000);

afterAll(async () => {
  https.globalAgent.options.ca = savedCa as never;
  await app?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await resetOrgs(ORG, LOCAL_ORG);
});

describe("真实 Nest 容器里，这条路由被绑上的是带两道门的取回器", () => {
  /**
   * ⚠ 这是全套断言里唯一一条问「**生产容器**给 controller 的是什么」的。
   *
   * 交接里那条最贵的教训（反证⑮）：绑一个不校验的取回器，42 条断言、14 条反证
   * **一条都不动**。`url-import-binding-guard.test.ts` 补上了「装配函数返回什么」，
   * 但装配函数**也可能根本没被接进 DI**——那时 controller 会去用别的东西，
   * 而那个文件依然全绿。
   *
   * ⇒ 这里从**已经在跑的那个 app**（`createApp()` 的产物，与上面所有 HTTP 请求
   *   共用同一个容器）解析 token，再按**引用相等**核对到 `fetchImportSource` 本身。
   */
  it("从容器解析出的工厂，产出的 deps.fetch 就是 fetchImportSource 本身", () => {
    const factory = app.get<ImportSkillFromUrlDepsFactory>(IMPORT_SKILL_FROM_URL_DEPS_FACTORY);
    expect(factory({ localOnlyOrg: false }).fetch).toBe(fetchImportSource);
  });

  it("工厂如实透传 localOnlyOrg（不是被 provider 固化成单例）", () => {
    const factory = app.get<ImportSkillFromUrlDepsFactory>(IMPORT_SKILL_FROM_URL_DEPS_FACTORY);
    expect(factory({ localOnlyOrg: true }).policy).toEqual({ localOnlyOrg: true });
    expect(factory({ localOnlyOrg: false }).policy).toEqual({ localOnlyOrg: false });
  });
});

describe("路由真的存在（正样本，⚠ 没有它整个文件等于只测了 404）", () => {
  it("admin 用已导入过的 idempotencyKey 打进来 ⇒ 200 + 回放，且响应满足契约", async () => {
    const key = "idem-http-replay";
    const seeded = await seedImport(key);

    const response = await post(ADMIN, ORG, {
      sourceUrl: `https://allowed.example:${port}/SKILL.md`,
      name: "HTTP route fixture skill",
      idempotencyKey: key,
    });

    // ⚠ 具体状态码，不是 `< 400`：一个把回放当新建返回 201 的实现应当红。
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    // 用契约自己解析——形状不符会在这里抛，而不是被一个宽松断言放过。
    const parsed = C.operations.importSkillFromUrl.out.parse(payload);
    expect(parsed.replayed).toBe(true);
    expect(parsed.skillId).toBe(seeded.skillId);
    expect(parsed.versionId).toBe(seeded.versionId);
    expect(parsed.filePaths).toEqual(["SKILL.md"]);
  });

  /**
   * 装置自检：证明上面那条 200 不是「随便什么路径都 200」。
   * ⚠ 没有这一条，`answers 404` 的镜像谬误（「答了就算通」）会溜进来。
   */
  it("装置自检：邻近的未知路径确实 404 ⇒ 上面那条 200 是这条路由给的", async () => {
    const response = await post(ADMIN, ORG, {}, "/admin/skills/url-imports-does-not-exist");
    expect(response.status).toBe(404);
  });

  /**
   * 装置自检：`counts()` **看得见变化**。
   *
   * ⚠ 没有这一条，所有「库里什么都没留下」的断言都可能是**恒真**的：
   *   一个把表名拼错、或永远数到 0 的 `counts()` 会让每一条负样本白白全绿，
   *   而那正是「一个先落库再抛错的实现同样会绿」要防的东西——防不住就等于没防。
   */
  it("装置自检：counts() 确实会随一次真实导入而变大", async () => {
    const before = await counts(ORG);
    await seedImport("idem-http-counts-selfcheck", "HTTP route counts selfcheck skill");
    const after = await counts(ORG);
    expect(after.skills).toBeGreaterThan(before.skills);
    expect(after.skill_versions).toBeGreaterThan(before.skill_versions);
    expect(after.skill_version_files).toBeGreaterThan(before.skill_version_files);
    expect(after.skill_url_imports).toBeGreaterThan(before.skill_url_imports);
  });
});

describe("授权：非 admin 被拒，且**在取回之前**被拒", () => {
  /**
   * ⚠ 这是本文件唯一能在 HTTP 层看见**顺序**的地方，而顺序不留痕迹
   *   （反证⑭：把授权挪到 fetch 之后，连「存在性」断言都还绿）。
   *
   * 手法：故意用一个**取回层一定会拒**的地址（`BLOCKED_URL`）。
   *   · 授权排在取回**之前** ⇒ 回 403 / `IMPORT_NOT_ORG_ADMIN`；
   *   · 授权被挪到取回**之后** ⇒ 先撞上取回层，回 422 / `IMPORT_URL_HOST_NOT_PUBLIC`。
   *   两个码不同 ⇒ 顺序变了这条断言就会红。
   */
  it("非 admin（consultant）提交一个会被 SSRF 门拒的地址 ⇒ 回的是授权码，不是取回码", async () => {
    const before = await counts(ORG);
    const response = await post(MEMBER, ORG, {
      sourceUrl: BLOCKED_URL,
      name: "should never exist",
      idempotencyKey: "idem-http-member",
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_NOT_ORG_ADMIN");
    // ⚠ 「抛错了」不够：先落库再抛错同样会绿。
    expect(await counts(ORG)).toEqual(before);
  });
});

describe("SSRF 门在 HTTP 面仍然生效（⚠ 证明 controller 绑的是真取回器）", () => {
  /**
   * ⚠ 这条同时是**反证⑮ 在 HTTP 层的对应物**：controller 若绑了一个不校验的取回器，
   *   这里就不会是 `IMPORT_URL_HOST_NOT_PUBLIC`，而是去真的连 127.0.0.1。
   */
  it("admin 提交 loopback 地址 ⇒ 422 / IMPORT_URL_HOST_NOT_PUBLIC，且库里什么都没留下", async () => {
    const before = await counts(ORG);
    const response = await post(ADMIN, ORG, {
      sourceUrl: BLOCKED_URL,
      name: "should never exist",
      idempotencyKey: "idem-http-ssrf",
    });

    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
    expect(await counts(ORG)).toEqual(before);
  });

  it("admin 提交 http:// 明文 ⇒ 422 / IMPORT_URL_SCHEME_FORBIDDEN（码不被压成一个笼统 400）", async () => {
    const response = await post(ADMIN, ORG, {
      sourceUrl: "http://example.com/SKILL.md",
      name: "should never exist",
      idempotencyKey: "idem-http-scheme",
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_URL_SCHEME_FORBIDDEN");
  });
});

describe("localOnlyOrg 由组织的 kind 逐请求推出（⚠ controller 自己的那条安全判定）", () => {
  /**
   * ⚠ 这个值是**装配参数**，`composeImportSkillFromUrlDeps` 原样透传。
   *   两道门、十四条反证、绑定守卫**都不决定它** ⇒ 写死成 `false` 时它们一条都不会红，
   *   而 personal-local 组织的出站承诺（I-9）在导入这条路上就消失了。
   *
   * 手法与上面的顺序断言同源：`BLOCKED_URL` 在两种取值下给出**不同**的码。
   *   · `localOnlyOrg: true`（正确）⇒ 403 / `IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG`
   *     （第一道门里它排在协议/地址判定**之前**）；
   *   · 写死 `false`（缺陷）⇒ 422 / `IMPORT_URL_HOST_NOT_PUBLIC`。
   */
  it("personal-local 组织的 owner 导入 ⇒ 403 / IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG", async () => {
    const before = await counts(LOCAL_ORG);
    const response = await post(LOCAL_OWNER, LOCAL_ORG, {
      sourceUrl: BLOCKED_URL,
      name: "should never exist",
      idempotencyKey: "idem-http-local",
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_URL_FORBIDDEN_FOR_LOCAL_ORG");
    expect(await counts(LOCAL_ORG)).toEqual(before);
  });

  /**
   * 对照：**同一个地址、同一个请求形状**，普通组织给出的是另一个码。
   * ⚠ 没有这一条，上面那条会被「所有组织一律拒」的实现满足——那正是把
   *   `localOnlyOrg` 写死成 `true` 的形状，它会让普通组织的导入全部失败。
   */
  it("对照：普通组织的同一个地址给出取回层的码，不是本地组织码", async () => {
    const response = await post(ADMIN, ORG, {
      sourceUrl: BLOCKED_URL,
      name: "should never exist",
      idempotencyKey: "idem-http-nonlocal-contrast",
    });
    expect(((await response.json()) as { reasonCode?: string }).reasonCode).toBe("IMPORT_URL_HOST_NOT_PUBLIC");
  });
});

describe("契约校验真的挂在这条路由上", () => {
  it("缺字段 ⇒ 400 且是字段级的，不是笼统 400", async () => {
    const response = await post(ADMIN, ORG, { name: "no url" });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { fields?: { path: string }[]; message?: { fields?: { path: string }[] } };
    const paths = (payload.fields ?? payload.message?.fields ?? []).map((f: any) => f.path);
    expect(JSON.stringify(payload)).toContain("sourceUrl");
    expect(paths.length === 0 || paths.includes("sourceUrl")).toBe(true);
  });

  it("多余字段被拒（契约是 .strict()）", async () => {
    const response = await post(ADMIN, ORG, {
      sourceUrl: "https://example.com/SKILL.md",
      name: "x",
      idempotencyKey: "idem-http-strict",
      unexpected: true,
    });
    expect(response.status).toBe(400);
  });
});
