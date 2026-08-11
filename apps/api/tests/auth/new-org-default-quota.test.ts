/**
 * devapp 实测缺陷（2026-08-11）的反证：**新组织的默认配额必须让管理员能直接发出
 * 第一个邀请**。
 *
 * 背景：人类在 devapp.boardx.us 上用 bootstrap 流程建的组织发邀请，撞
 * 「组织成员配额已用尽」——20260731085758_f11 把 seat_quota 默认成 0，而产品里
 * 不存在任何分配额度的路径。修法：20260811040000 迁移把列默认值改 50 并回填存量。
 *
 * 三条断言：
 *   ① 生产建组织路径的 INSERT 形状（不写 seat_quota，靠列默认值）建出的组织，
 *      管理员的第一个邀请**直接成功**——这正是人类在 devapp 撞到的那一步。
 *   ② 回填：造一行 seat_quota=0 的 kind='organization' → 重放迁移文件 → 变 50；
 *      运维手动设过的非 0 值（如 7）不被碰。
 *   ③ personal-local 组织不回填，保持 0（个人组织不该能邀人，I-9 在那里是正确语义）。
 *
 * I-9 本身（quota=0 ⇒ 硬阻断）的反证仍在 quota-exhausted-hard-block.test.ts，
 * 该文件显式置 0，与本文件互不覆盖。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inviteOrgMember } from "../../src/application/auth/invite-org-member";
import { PgOrgInviteRepository } from "../../src/infrastructure/auth/pg-org-invite-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addCredential, addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "org-default-quota-fresh";
const ADMIN = "u-default-quota-admin";

const HOOK_TIMEOUT_MS = 60_000;

const MIGRATION_FILE = join(
  __dirname,
  "../../migrations/20260811040000_devapp_seat_quota_default.sql",
);

let db: PgDatabase;
let repo: PgOrgInviteRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgOrgInviteRepository(db);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

beforeEach(async () => {
  await resetOrgs(ORG);
});

describe("新组织默认配额（20260811040000）", () => {
  it("① 生产 INSERT 形状（不写 seat_quota）建出的组织，管理员第一个邀请直接成功", async () => {
    // 与 pg-registration-repository.ts 的三条建组织路径完全同形：只写 id/name/kind，
    // seat_quota 交给列默认值——测的就是这个默认值。
    await asApp(ORG, (c) =>
      c.query(`INSERT INTO organizations (id, name, kind) VALUES ($1, $2, 'organization')`, [
        ORG,
        "fresh org",
      ]),
    );
    await addCredential(ADMIN, "admin@default-quota.test", "Admin");
    await addOrgMember(ORG, ADMIN, "admin", null);

    const quota = await asOwner(async (c) => {
      const r = await c.query<{ seat_quota: number }>(
        "SELECT seat_quota FROM organizations WHERE id = $1",
        [ORG],
      );
      return r.rows[0]?.seat_quota;
    });
    expect(quota).toBe(50);

    const out = await inviteOrgMember(
      { repo },
      {
        orgId: toOrgId(ORG),
        actorId: ADMIN,
        actorOrgRole: "admin",
        email: "first-invite@default-quota.test",
        orgRole: "consultant",
        teamId: null,
      },
    );
    expect(out.status).toBe("pending");
    expect(out.quotaReserved).toBe(1);
  });

  it("② 回填只动 seat_quota=0 的组织；运维手动设过的非 0 值不被碰", async () => {
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO organizations (id, name, kind, seat_quota) VALUES ($1, $2, 'organization', 0)`,
        [ORG, "legacy zero-quota org"],
      ),
    );
    const OTHER = `${ORG}-manual`;
    await resetOrgs(OTHER);
    await asApp(OTHER, (c) =>
      c.query(
        `INSERT INTO organizations (id, name, kind, seat_quota) VALUES ($1, $2, 'organization', 7)`,
        [OTHER, "manually allocated org"],
      ),
    );

    // 重放迁移文件本体（migrate:check 也这样干）——回填对 0 生效、对 7 无感。
    await asOwner((c) => c.query(readFileSync(MIGRATION_FILE, "utf8")));

    const quotas = await asOwner(async (c) => {
      const r = await c.query<{ id: string; seat_quota: number }>(
        "SELECT id, seat_quota FROM organizations WHERE id = ANY($1::text[]) ORDER BY id",
        [[ORG, OTHER]],
      );
      return Object.fromEntries(r.rows.map((row) => [row.id, row.seat_quota]));
    });
    expect(quotas[ORG]).toBe(50);
    expect(quotas[OTHER]).toBe(7);
    await resetOrgs(OTHER);
  });

  it("③ personal-local 组织不回填，保持 0", async () => {
    const OWNER = `${ORG}-owner`;
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO organizations (id, name, kind, owner_user_id, seat_quota)
         VALUES ($1, $2, 'personal-local', $3, 0)`,
        [ORG, "personal org", OWNER],
      ),
    );
    await asOwner((c) => c.query(readFileSync(MIGRATION_FILE, "utf8")));
    const quota = await asOwner(async (c) => {
      const r = await c.query<{ seat_quota: number }>(
        "SELECT seat_quota FROM organizations WHERE id = $1",
        [ORG],
      );
      return r.rows[0]?.seat_quota;
    });
    expect(quota).toBe(0);
  });
});
