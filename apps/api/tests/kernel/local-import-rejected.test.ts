/**
 * F17 V11⑤ —— **单向**：正式组织 → 本地组织的导入一律被拒。
 *
 * ## 反向为什么是一条安全性质而不是一个未做的功能
 *
 * 本地组织的承诺是「这里只有我，且数据不出本机」。一次反向导入会同时破坏两半：
 * 组织里出现了不是这个人产生的内容，而那份内容来自一个他不能单方面控制的组织——
 * 于是「这台机器上的东西都是我的」不再为真，而这句话正是 F16 的全部。
 *
 * 所以本文件断言的不只是「反向请求返回错误」，还有更强的一条：
 * **契约里没有反向操作，代码里也没有反向路由**。一条「返回 403」的占位路由会被读作
 * 「这个功能还没做」，而真相是它永远不会做。
 *
 * ## 三层，每层各自拒绝
 *
 *   契约层  没有任何操作能表达「导入到本地组织」
 *   用例层  方向判定在读取任何内容之前结束请求
 *   数据库  令牌插不进去（0016 的触发器），带反向来源标注的行也插不进去
 *
 * 三层都要，因为它们挡的是不同的写入者：第三层挡的是**还没写出来的那个批量脚本**。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember } from "../support/db";
import { seedExportFixture, useTempObjectStore, type ExportFixture } from "../support/export-db";
import { isExportDirectionAllowed } from "../../src/domain/identity/local-export";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const OBJECT_ROOT = useTempObjectStore();

const LOCAL_ORG = "org-f17-oneway-local";
const REAL_ORG = "org-f17-oneway-real";
/** 第二个本地组织：用来挡「本地 → 本地」，那是只查源的实现会放过的方向。 */
const OTHER_LOCAL_ORG = "org-f17-oneway-local2";
const OTHER_REAL_ORG = "org-f17-oneway-real2";
const PREFIX = "f17oneway";

let BASE: string;
let app: NestExpressApplication;
let fx: ExportFixture;

const authFor = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(LOCAL_ORG, REAL_ORG, OTHER_LOCAL_ORG, OTHER_REAL_ORG);
});

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG, REAL_ORG, OTHER_LOCAL_ORG, OTHER_REAL_ORG);
  fx = await seedExportFixture({
    prefix: PREFIX, localOrg: LOCAL_ORG, realOrg: REAL_ORG, objectRoot: OBJECT_ROOT,
  });
  // 另一个人的本地组织。
  //
  // ⚠ 它**必须**属于另一个人，而这不是夹具的选择：第一版让 fx.owner 拥有它，
  //   插入当场被 `organizations_one_personal_local_per_user` 拒掉（I-2，每人恰好一个）。
  //   而把 fx.owner 加成成员也不行（I-3，本地组织只收所有者）。
  //   ⇒ 「本地 → 本地」这条路径在 HTTP 上**根本走不到方向判定**，成员资格先把它挡了，
  //     而那道拦截正是 F16 的隔离本身。方向规则因此在纯函数层与数据库层单独断言。
  await seedOrg({
    orgId: OTHER_LOCAL_ORG, kind: "personal-local", ownerUserId: `u-${PREFIX}-stranger`,
    projectId: `${OTHER_LOCAL_ORG}-p`,
  });
  await addOrgMember(OTHER_LOCAL_ORG, `u-${PREFIX}-stranger`, "admin", null);
  await seedOrg({ orgId: OTHER_REAL_ORG, projectId: `${OTHER_REAL_ORG}-p` });
  await addOrgMember(OTHER_REAL_ORG, fx.owner, "consultant", null);
});

function previewBetween(from: string, to: string): Promise<Response> {
  return fetch(`${BASE}/identity/export/preview`, {
    method: "POST",
    headers: authFor(fx.owner, from),
    body: JSON.stringify({ fromLocalOrgId: from, toOrgId: to, artifactIds: fx.artifactIds }),
  });
}

function exportBetween(from: string, to: string): Promise<Response> {
  return fetch(`${BASE}/identity/export`, {
    method: "POST",
    headers: authFor(fx.owner, from),
    body: JSON.stringify({
      fromLocalOrgId: from, toOrgId: to,
      artifactIds: fx.artifactIds, confirmedPreviewToken: "xprv-anything",
    }),
  });
}

/* ═══════════════════ 契约层：反向操作根本不存在 ═══════════════════ */

describe("契约里没有任何一个操作能表达「导入到本地组织」", () => {
  it("identity 束里没有 import / pull / sync 这类操作", () => {
    // 结构性断言，因为风险是**将来**的某个端点而不是今天的代码：
    // 一旦有人要做「把公司资料同步到我的本地」，他要加的就是这样一个操作。
    const names = Object.keys(C.operations);
    for (const n of names) {
      expect(/import|pull|sync|download/i.test(n), `${n} 看起来是一条反向通道`).toBe(false);
    }
    expect(names.length, "一个操作都没读到——这条断言会永远为真").toBeGreaterThan(5);
  });

  it("导出操作的两个方向参数不可互换：入参把「源必须是本地组织」写进了字段名", () => {
    // `fromLocalOrgId` 而不是 `fromOrgId`。字段名不是保证，但它让一个反向调用
    // 在代码审查里长得就是错的——而这正是这个命名唯一能做的事，故只断言它存在。
    expect(Object.keys(C.operations.exportToOrganization.in.shape)).toContain("fromLocalOrgId");
    expect(Object.keys(C.operations.previewExport.in.shape)).toContain("fromLocalOrgId");
  });

  it("`LocalExportReason` 与两个操作的 err **必须一致**——否则失败面有两份声明", () => {
    // ⚠ 这个枚举是 F17 新加的（错误边界只放行闭枚举的成员，否则 reasonCode 被静默丢弃）。
    //   加了枚举就有了第二处声明失败码的地方，所以它与 `err` 的一致性要机械核对。
    const declared = new Set<string>([
      ...C.operations.previewExport.err,
      ...C.operations.exportToOrganization.err,
    ]);
    for (const member of C.LocalExportReason.options) {
      expect(declared.has(member), `${member} 在枚举里但不在任何操作的 err 里`).toBe(true);
    }
    // 反方向：导出专有的失败码都必须进枚举，否则它到不了客户端。
    for (const code of declared) {
      if (!code.startsWith("EXPORT_")) continue;
      expect(
        (C.LocalExportReason.options as readonly string[]).includes(code),
        `${code} 是导出专有失败码但不在 LocalExportReason 里，错误边界会把它丢掉`,
      ).toBe(true);
    }
  });
});

/* ═══════════════════ 用例层：方向判定 ═══════════════════ */

describe("方向判定：源必须是本地组织，目标必须不是", () => {
  it("正式 → 本地（真正的反向导入）被拒", async () => {
    for (const r of [
      await previewBetween(REAL_ORG, LOCAL_ORG),
      await exportBetween(REAL_ORG, LOCAL_ORG),
    ]) {
      expect(r.status).toBe(403);
      expect((await r.json()) as { reasonCode: string }).toMatchObject({
        reasonCode: "EXPORT_DIRECTION_FORBIDDEN",
      });
    }
  });

  it("本地 → 本地在 HTTP 上被**更早**的一道门挡住：404，而不是 403", async () => {
    // 把 A 的私有数据搬进 B 的私有组织，是一次没人能审计的转移。
    // 但它到不了方向判定：F16 的 I-2 / I-3 让任何人都不可能同时是两个本地组织的成员，
    // 所以成员资格先失败，且是 404——403 会确认「那个本地组织存在」。
    //
    // ⚠ 因此方向规则里「本地 → 本地」这一支只能在纯函数层与数据库层断言（见下方两处）。
    //   把它写成 403 的期望会得到一个永远绿的错误断言。
    const r = await previewBetween(LOCAL_ORG, OTHER_LOCAL_ORG);
    expect(r.status).toBe(404);
  });

  it("正式 → 正式被拒 —— 只查目标的实现会放过它", async () => {
    // 这不是本操作。它会绕过目标组织自己的入库审核，而目标侧那句
    // 「未经本组织入库审核」的标注正是为审核而存在的。
    const r = await previewBetween(REAL_ORG, OTHER_REAL_ORG);
    expect(r.status).toBe(403);
  });

  it("反证：正确方向确实通 —— 上面三条不是由「全拒」满足的", async () => {
    const r = await previewBetween(LOCAL_ORG, REAL_ORG);
    expect(r.status, await r.clone().text()).toBe(200);
  });

  it("被拒的方向**什么都没读到、什么都没写下**", async () => {
    await previewBetween(REAL_ORG, LOCAL_ORG);
    await exportBetween(REAL_ORG, LOCAL_ORG);
    const tokens = await asApp(LOCAL_ORG, (c) =>
      c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM local_export_previews WHERE org_id = $1", [LOCAL_ORG],
      ),
    );
    // 一份「反向导入的预览」哪怕只是被生成出来，也已经在教用户去做一件被禁止的事。
    expect(tokens.rows[0]!.n).toBe("0");
  });

  it("纯判定函数四个组合都对，且拒绝缺席的一方", () => {
    expect(isExportDirectionAllowed(C.LOCAL_ORG_KIND, "organization")).toBe(true);
    expect(isExportDirectionAllowed("organization", C.LOCAL_ORG_KIND)).toBe(false);
    expect(isExportDirectionAllowed(C.LOCAL_ORG_KIND, C.LOCAL_ORG_KIND)).toBe(false);
    expect(isExportDirectionAllowed("organization", "organization")).toBe(false);
    // 缺席的默认必须是「拒绝」：一个打错的 id 不该是一次放行。
    expect(isExportDirectionAllowed(null, "organization")).toBe(false);
    expect(isExportDirectionAllowed(C.LOCAL_ORG_KIND, undefined)).toBe(false);
  });
});

/* ═══════════════════ 数据库层：挡还没写出来的那个脚本 ═══════════════════ */

describe("数据库自己也拒绝反向，因此绕过应用层也不行", () => {
  it("方向错误的预览令牌插不进去", async () => {
    await expect(
      asApp(REAL_ORG, (c) =>
        c.query(
          `INSERT INTO local_export_previews (token, org_id, to_org_id, actor_id, artifact_ids, expires_at)
           VALUES ($1,$2,$3,$4,$5::text[], now() + interval '1 hour')`,
          [`xprv-${PREFIX}-reverse`, REAL_ORG, LOCAL_ORG, fx.owner, fx.artifactIds],
        ),
      ),
    ).rejects.toThrow(/EXPORT_DIRECTION_FORBIDDEN/);
  });

  it("标着「来自正式组织」的行也插不进本地组织", async () => {
    // 一段「批量迁移脚本」绕开路由直接写行——这一层挡的就是它。
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized,
                                  imported_from_org_id, imported_from_artifact_id, imported_from_note)
           VALUES ($1,$2,NULL,'upload','smuggled',$3,false,$4,$5,'note')`,
          [`${PREFIX}-smuggled`, LOCAL_ORG, fx.owner, REAL_ORG, "whatever"],
        ),
      ),
    ).rejects.toThrow(/EXPORT_DIRECTION_FORBIDDEN/);
  });

  it("反证：正确方向的那一条确实写得进去 —— 触发器不是「全拒」", async () => {
    await asApp(REAL_ORG, (c) =>
      c.query(
        `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized,
                                imported_from_org_id, imported_from_artifact_id, imported_from_note)
         VALUES ($1,$2,NULL,'upload','legit',$3,false,$4,$5,'note')`,
        [`${PREFIX}-legit`, REAL_ORG, fx.owner, LOCAL_ORG, fx.artifactIds[0]],
      ),
    );
    const r = await asApp(REAL_ORG, (c) =>
      c.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM artifacts WHERE org_id = $1 AND imported_from_org_id = $2",
        [REAL_ORG, LOCAL_ORG],
      ),
    );
    expect(r.rows[0]!.n).toBe("1");
  });

  it("本地 → 本地的令牌也插不进去 —— HTTP 层到不了的那一支，在这里被断言", async () => {
    await expect(
      asApp(LOCAL_ORG, (c) =>
        c.query(
          `INSERT INTO local_export_previews (token, org_id, to_org_id, actor_id, artifact_ids, expires_at)
           VALUES ($1,$2,$3,$4,$5::text[], now() + interval '1 hour')`,
          [`xprv-${PREFIX}-l2l`, LOCAL_ORG, OTHER_LOCAL_ORG, fx.owner, fx.artifactIds],
        ),
      ),
    ).rejects.toThrow(/EXPORT_DIRECTION_FORBIDDEN/);
  });

  it("判定函数四个方向组合都对，且对缺席的组织返回 false", async () => {
    // ⚠ 这是数据库那一半的真值表。SECURITY DEFINER 让它能同时看见两个组织的 kind——
    //   以调用者身份跑的话 RLS 会让另一侧「看不见」，而看不见会被下游读成「不知道，放行吧」。
    const r = await asApp(LOCAL_ORG, (c) =>
      c.query<{ ok: boolean; rev: boolean; l2l: boolean; r2r: boolean; miss_to: boolean; miss_from: boolean }>(
        `SELECT kernel_export_direction_ok($1, $2) AS ok,
                kernel_export_direction_ok($2, $1) AS rev,
                kernel_export_direction_ok($1, $3) AS l2l,
                kernel_export_direction_ok($2, $4) AS r2r,
                kernel_export_direction_ok($1, 'org-does-not-exist') AS miss_to,
                kernel_export_direction_ok('org-does-not-exist', $2) AS miss_from`,
        [LOCAL_ORG, REAL_ORG, OTHER_LOCAL_ORG, OTHER_REAL_ORG],
      ),
    );
    expect(r.rows[0]).toEqual({
      ok: true, rev: false, l2l: false, r2r: false,
      // 缺席的默认必须是「拒绝」：一个打错的 id 不该是一次放行。
      miss_to: false, miss_from: false,
    });
  });
});
