/**
 * F125 UC-P9 / UC-00.3 R7①・R12 V13 —— 展示别名不落库。
 *
 * 「协同引导师」是**进场身份的展示别名**，与落库的四种项目角色不是同一张表：以「协同
 * 引导师」身份进场时，`project_memberships.project_role` 的值必须是 `facilitator`
 * （多实例，其中一名带 `is_host`），且**全库**（不只是这一行）不存在任何 `co-facilitator`
 * 字样。
 *
 * ⚠ **本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`**（issue #74，
 * 同 `advance-segment-role-gate.test.ts` 头注的处理方式）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgProjectMembershipRepository } from "../../src/infrastructure/project/pg-project-membership-repository";
import { PgInviteTokenMemberResolver } from "../../src/infrastructure/project/pg-invite-token-member-resolver";
import { addProjectMember } from "../../src/application/project/add-project-member";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember as seedProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f125-alias-org";
const WORKSHOP = "f125-alias-workshop";
const HOST_FACILITATOR = "u-f125-alias-host";
const CO_FACILITATOR = "u-f125-alias-co";
const HOOK_TIMEOUT_MS = 120_000;

let db: PgDatabase;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());

  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      WORKSHOP, ORG, `workshop ${WORKSHOP}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [WORKSHOP, ORG]));

  await addOrgMember(ORG, HOST_FACILITATOR, "consultant", null);
  // 首位引导师，带 is_host——用来授权本测试里发起「加人」的调用者。
  await seedProjectMember(ORG, WORKSHOP, HOST_FACILITATOR, "facilitator", null, true);
}, HOOK_TIMEOUT_MS);

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
}, HOOK_TIMEOUT_MS);

describe("UC-00.3 R7①・V13：以「协同引导师」身份进场，落库是 facilitator，全库无 co-facilitator", () => {
  it("addProjectMember 以 isHost:false 的 facilitator 授予，等价于「协同引导师」这个展示别名", async () => {
    const identity = new PgIdentityRepository(db);
    const members = new PgProjectMembershipRepository(db);
    const resolver = new PgInviteTokenMemberResolver(db);
    const provenance = new PgProvenanceRepository(db);

    const out = await addProjectMember(
      { identity, members, resolver, provenance },
      {
        actorId: HOST_FACILITATOR,
        orgId: toOrgId(ORG),
        projectId: WORKSHOP,
        // 契约的四值闭集里没有「协同引导师」这个选项——界面把它翻译成
        // `projectRole: "facilitator"` 再提交（uc-00-3 R8「界面不得把展示别名当作角色值提交」）。
        subject: { kind: "orgUser", ref: CO_FACILITATOR },
        projectRole: "facilitator",
        isHost: false,
      },
    );

    expect(out.projectRole).toBe("facilitator");
    expect(out.isHost).toBe(false);

    const row = await asApp(ORG, (c) =>
      c.query<{ project_role: string; is_host: boolean }>(
        "SELECT project_role, is_host FROM project_memberships WHERE project_id = $1 AND user_id = $2",
        [WORKSHOP, CO_FACILITATOR],
      ),
    );
    expect(row.rows[0]?.project_role).toBe("facilitator");
    expect(row.rows[0]?.is_host).toBe(false);

    // 全库扫描：project_memberships 与 provenance_events 的 detail 里都不得出现
    // "co-facilitator" 字样（展示别名从未落库，不是"落库了但被这一条断言恰好没扫到"）。
    const memberships = await asApp(ORG, (c) =>
      c.query<{ project_role: string }>("SELECT project_role FROM project_memberships WHERE org_id = $1", [ORG]),
    );
    for (const r of memberships.rows) {
      expect(r.project_role).not.toMatch(/co-facilitator/i);
    }

    const events = await asApp(ORG, (c) =>
      c.query<{ detail: unknown }>("SELECT detail FROM provenance_events WHERE org_id = $1", [ORG]),
    );
    for (const r of events.rows) {
      expect(JSON.stringify(r.detail)).not.toMatch(/co-facilitator/i);
    }
  });
});
