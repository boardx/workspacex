/**
 * F22 下半：**组织停用 = 只读降级**（O-29 ③ / UC-1.5 V12，coverage V6 与缺口 A-2）。
 *
 * V12 三条，逐条对应本文件的三个 describe：
 *   ① 普通成员登录成功但**全部写接口被拒**
 *   ② **管理员仍可导出**
 *   ③ 数据**未被立即销毁**，仍可按留存期查询到
 *
 * ## 这个文件为什么两个方向都断言
 *
 * 「写被拒」单独成立时，一个把整张表都关掉的实现同样全绿——而那不是只读降级，
 * 那是提前销毁，直接违反 ③。所以每一条「被拒」旁边都有一条「仍然通」：
 *   写被拒 ∧ 读仍通 ∧ 登录仍成功 ∧ 导出仍可用 ∧ 恢复后写又能写。
 * verify-rls.sh 的文件头讲的是同一件事：隔离与瘫痪必须可分辨。
 *
 * ## 为什么写是用 `asApp` 直接打库，而不是走某条业务路由
 *
 * 冻结在 PG 的 RESTRICTIVE 策略里，声称的性质是「**任何**写都被挡」——
 * 挑一条路由来验，验的是那条路由。`asApp` 是生产运行时用的同一个角色、同一条
 * `SET LOCAL app.current_org` 路径，没有任何应用层过滤，
 * 这与 verify-rls.sh 坚持裸 `SELECT *` 的理由完全一样。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as A } from "@repo/contracts";
import { retentionUntil } from "../../src/domain/auth/org-lifecycle";
import { PgOrgLifecycleRepository } from "../../src/infrastructure/auth/pg-org-lifecycle-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import {
  addOrgMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { frozenTableAudit, readOrgLifecycle } from "../support/auth-db";

process.env.KERNEL_QUIET = "1";

const FROZEN = "org-f22-frozen";
const LIVE = "org-f22-live";
const ADMIN = "u-f22-admin";
const MEMBER = "u-f22-member";
const OUTSIDER = "u-f22-outsider";
const DOMAIN = "f22disabled.test";
const PASSWORD = "correct-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;
let db: PgDatabase;
let orgs: PgOrgLifecycleRepository;

const login = async (userId: string) => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${userId}@${DOMAIN}`, password: PASSWORD }),
  });
  return { status: res.status, body: (await res.json()) as { sessionToken?: string } };
};

const exportAs = (token: string, orgId: string) =>
  fetch(`${BASE}/auth/org-export?orgId=${orgId}`, {
    headers: { authorization: `Bearer ${token}` },
  });

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  orgs = new PgOrgLifecycleRepository(db);
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.close?.();
});

beforeEach(async () => {
  await resetOrgs(FROZEN, LIVE);
  await resetCredentials(
    [ADMIN, MEMBER, OUTSIDER],
    [`${ADMIN}@${DOMAIN}`, `${MEMBER}@${DOMAIN}`, `${OUTSIDER}@${DOMAIN}`],
  );
  await seedOrg({ orgId: FROZEN, projectId: `${FROZEN}-p1` });
  await seedOrg({ orgId: LIVE, projectId: `${LIVE}-p1` });
  await addOrgMember(FROZEN, ADMIN, "admin", null);
  await addOrgMember(FROZEN, MEMBER, "consultant", null);
  await addOrgMember(LIVE, OUTSIDER, "admin", null);
  for (const u of [ADMIN, MEMBER, OUTSIDER]) {
    await seedCredential({ userId: u, email: `${u}@${DOMAIN}`, password: PASSWORD });
  }
});

/** 一次真实的租户写。返回 null = 成功，否则是被拒的原因。 */
async function tryWrite(orgId: string, id: string): Promise<string | null> {
  try {
    await asApp(orgId, (c) =>
      c.query("INSERT INTO projects (id, org_id, name) VALUES ($1, $2, $3)", [id, orgId, "probe"]),
    );
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

describe("V12 ①：停用后全部写被拒，而读仍然通", () => {
  it("三种写（INSERT / UPDATE / DELETE）全部被库拒掉", async () => {
    // 先证明这条写路径本来是通的——否则下面的「被拒」可能只是这条路径根本不能写。
    expect(await tryWrite(FROZEN, `${FROZEN}-before`), "停用前必须写得进去").toBeNull();

    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));

    const insertErr = await tryWrite(FROZEN, `${FROZEN}-after`);
    expect(insertErr, "停用后 INSERT 必须被拒").not.toBeNull();
    // 拒的必须是 RLS，而不是别的什么（比如主键冲突）——否则这条断言会在
    // 「写因为一个无关的原因失败」时假绿。
    expect(insertErr).toMatch(/row-level security|policy/i);

    await expect(
      asApp(FROZEN, (c) =>
        c.query("UPDATE projects SET name = 'renamed' WHERE org_id = $1", [FROZEN]),
      ),
    ).rejects.toThrow(/row-level security|policy/i);

    // ⚠ DELETE 单独一条断言。`WITH CHECK` 只作用于新行，DELETE 没有新行——
    // 只加 INSERT/UPDATE 两条策略时，停用组织是「插不进、改不了、但删得掉」，
    // 而所有「写被拒」的断言依然全绿。迁移 0012 因此给 DELETE 单列了一条 RESTRICTIVE。
    const del = await asApp(FROZEN, (c) =>
      c.query("DELETE FROM projects WHERE org_id = $1", [FROZEN]),
    );
    expect(del.rowCount, "DELETE 必须一行都删不掉").toBe(0);
  });

  it("读**没有**被关掉 —— 这是只读降级，不是提前销毁（V12 ③）", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));

    const r = await asApp(FROZEN, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM projects WHERE org_id = $1", [FROZEN]),
    );
    expect(Number(r.rows[0]!.n), "停用组织的数据必须仍然读得到").toBeGreaterThan(0);
  });

  it("普通成员**登录仍然成功**（停用的是组织，不是账号）", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    const r = await login(MEMBER);
    expect(r.status, "V12 ①：『登录成功但写被拒』，不是『登录被拒』").toBe(200);
    expect(r.body.sessionToken).toBeTruthy();
  });

  it("冻结只针对被停用的那个组织 —— 隔壁组织照写不误", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    expect(await tryWrite(LIVE, `${LIVE}-probe`), "别的组织不得被连坐").toBeNull();
  });

  it("恢复之后写又能写 —— 停用不是删除（双向）", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    expect(await tryWrite(FROZEN, `${FROZEN}-x`)).not.toBeNull();

    await orgs.reactivate(toOrgId(FROZEN));
    expect(await tryWrite(FROZEN, `${FROZEN}-y`), "恢复后必须可写，否则停用等于删除").toBeNull();

    const row = await readOrgLifecycle(FROZEN);
    expect(row?.status).toBe("active");
    // 三个字段同生共死（CHECK organizations_disabled_is_atomic）。
    expect(row?.disabled_at).toBeNull();
    expect(row?.retention_until).toBeNull();
  });

  it("`rls_probe` 不在冻结范围内 —— RLS 的证据表不许被本 feature 波及", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    // 它的 org_id 没有指向 organizations 的外键，'org-a' 根本不是一个组织。
    // 冻结它会让 verify-rls.sh 的 seed 写不进去，而那张表是内核资产（UC-0.6 R7）。
    await expect(
      asApp("org-a", (c) =>
        c.query(
          "INSERT INTO rls_probe (org_id, payload) VALUES ('org-a','f22-probe') ON CONFLICT DO NOTHING",
        ),
      ),
    ).resolves.toBeDefined();
    await asApp("org-a", (c) => c.query("DELETE FROM rls_probe WHERE payload = 'f22-probe'"));
  });
});

describe("V12 ②：仅管理员可导出", () => {
  it("管理员导出成功，且响应逐条对得上契约", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    const { body } = await login(ADMIN);

    const res = await exportAs(body.sessionToken!, FROZEN);
    expect(res.status, await res.clone().text()).toBe(200);
    const out = (await res.json()) as {
      lifecycle: { status: string; retentionUntil: string | null };
      tables: { table: string; rowCount: number }[];
    };

    const parsed = A.operations.exportOrganization.out.safeParse(out);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(out.lifecycle.status).toBe("disabled");
    expect(out.lifecycle.retentionUntil).not.toBeNull();
    // 清单非空——一份「导出成功但什么都没有」的响应会让这条验收空转。
    expect(out.tables.length).toBeGreaterThan(5);
    expect(out.tables.some((t) => t.rowCount > 0)).toBe(true);
  });

  it("同组织的普通成员**导不了**，且拿到的是 404 不是 403", async () => {
    const at = new Date();
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));
    const { body } = await login(MEMBER);
    const res = await exportAs(body.sessionToken!, FROZEN);
    // 403 会告诉调用者「这个组织在，你只是不够格」；404 什么也不说。
    expect(res.status).toBe(404);
  });

  it("非成员导不了自己不属于的组织", async () => {
    const { body } = await login(OUTSIDER);
    const res = await exportAs(body.sessionToken!, FROZEN);
    expect(res.status).toBe(404);
    // 非空转：同一个人导自己的组织是通的。
    const own = await exportAs(body.sessionToken!, LIVE);
    expect(own.status, "拒绝必须是隔离，不是瘫痪").toBe(200);
  });

  it("组织没停用时管理员也能导出（导出不是停用的附属品）", async () => {
    const { body } = await login(ADMIN);
    const res = await exportAs(body.sessionToken!, FROZEN);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { lifecycle: { status: string } }).lifecycle.status).toBe("active");
  });
});

describe("V12 ③ / 单一事实源：留存期", () => {
  it("库里落下的 retention_until = 停用时刻 + 契约里那个常量", async () => {
    const at = new Date("2026-07-29T00:00:00.000Z");
    await orgs.disable(toOrgId(FROZEN), at, retentionUntil(at));

    const row = await readOrgLifecycle(FROZEN);
    expect(row?.status).toBe("disabled");
    expect(row?.disabled_at?.toISOString()).toBe(at.toISOString());

    // ⚠ 期望值从契约常量算出来，**不写死 180 也不写死日期**。
    // 写死就是第三份副本，而且是最难发现的那种：改了常量之后测试红，
    // 于是有人把测试里的数字也改掉，两处一起漂。
    const expected = new Date(
      at.getTime() + A.AUTH_POLICY.orgRetentionDays * 24 * 60 * 60 * 1000,
    );
    expect(row?.retention_until?.toISOString()).toBe(expected.toISOString());
  });

  it("这条断言不是空转的：换一个天数它会红", () => {
    const at = new Date("2026-07-29T00:00:00.000Z");
    const real = retentionUntil(at);
    const wrong = new Date(at.getTime() + (A.AUTH_POLICY.orgRetentionDays + 1) * 86_400_000);
    expect(real.toISOString()).not.toBe(wrong.toISOString());
  });

  it("SQL 里没有第二份留存期 —— 迁移不得自己算日期", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../../migrations", import.meta.url));
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(`${dir}/${f}`, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(--|\*)/.test(l))
        .join("\n");
      // `interval '... days'` 出现在 retention_until 附近就是第二份副本。
      if (/retention_until[^;]*interval/is.test(sql)) offenders.push(f);
      if (/\b180\b/.test(sql)) offenders.push(`${f} (裸的 180)`);
    }
    expect(
      offenders,
      "留存期只有一份：packages/contracts/src/auth.ts 的 AUTH_POLICY.orgRetentionDays",
    ).toEqual([]);
  });

  it("契约里没有 `purged` 状态 —— 销毁没实现就不许在枚举里出现（C13）", () => {
    // 加一个取值会让读到枚举的人（包括写界面的人）以为销毁已经存在。
    expect(A.OrgStatus.options).toEqual(["active", "disabled"]);
  });
});

describe("冻结覆盖面：catalog 推导，不是一张手写清单", () => {
  it("每一张带租户外键的表都有 INSERT / UPDATE / DELETE 三条 RESTRICTIVE 策略", async () => {
    const audit = await frozenTableAudit();
    const missing = audit.filter((t) => t.ins !== 1 || t.upd !== 1 || t.del !== 1);
    expect(
      missing.map((t) => `${t.table}(ins=${t.ins},upd=${t.upd},del=${t.del})`),
      "新表默认不在冻结范围内——它带着 0003 那种老式策略进来，而这条断言就是那道警报。\n" +
        "补法：在迁移里对新表加三条 AS RESTRICTIVE 策略（照 0012 的写法）。",
    ).toEqual([]);
  });

  it("这条断言不是空转的：它确实扫到了表，而且 rls_probe 不在其中", async () => {
    const audit = await frozenTableAudit();
    // 少于 8 张就说明推导坏了，而不是「schema 里真的只有这么几张」。
    expect(audit.length, "冻结审计一张表都没扫到，上面那条会永远为真").toBeGreaterThanOrEqual(8);
    expect(audit.map((t) => t.table)).not.toContain("rls_probe");
    expect(audit.map((t) => t.table)).not.toContain("organizations");
  });
});
