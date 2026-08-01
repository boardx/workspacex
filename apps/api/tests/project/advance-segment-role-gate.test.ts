/**
 * F119 UC-P7 `advanceAgendaSegment` —— 权限闭集判定：谁能做这四个动作是闭集，不是
 * 开放式判断。动作词引用 `apps/api/src/domain/identity/project-role-matrix.ts` 的
 * `agendaSegment.advance`（I-P10 / I-P12，F121 改名后的字面量），只有 `facilitator` 持有它。
 *
 * ⚠ **本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`**（issue #74）。
 *
 * 五个身份各一条断言（闭集穷举，不是抽样）：
 *   facilitator            → 通过（正向控制组——没有它，下面四条「全部被拒」也会全绿）
 *   groupLead / member / observer → PROJECT_ROLE_INSUFFICIENT（有角色，角色里没有这个动作）
 *   无项目角色（含组织 admin）    → NO_PROJECT_ROLE（正常状态，不是异常，见 I-P9）
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgAgendaSegmentRepository } from "../../src/infrastructure/project/pg-agenda-segment-repository";
import { PgTemporaryGrantRepository } from "../../src/infrastructure/identity/pg-temporary-grant-repository";
import {
  advanceAgendaSegment,
  type AdvanceAgendaSegmentDeps,
} from "../../src/application/project/advance-agenda-segment";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f119-org-role-gate";

const FACILITATOR = "u-f119-rg-facilitator";
const GROUP_LEAD = "u-f119-rg-group-lead";
const MEMBER = "u-f119-rg-member";
const OBSERVER = "u-f119-rg-observer";
const ADMIN_NO_PROJECT_ROLE = "u-f119-rg-admin";

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f119-rg-d-${this.n}`;
  }
}

let db: PgDatabase;
let deps: AdvanceAgendaSegmentDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    auth: { repo: new PgIdentityRepository(db), ids: new SeqDecisionIds() },
    segments: new PgAgendaSegmentRepository(db),
    provenance: new PgProvenanceRepository(db),
    // F127: real storage layer, wired the same way production does (`kernel.module.ts`).
    // This file's own assertions are all about the role gate, not about grants -- no grant
    // is ever created here, so `revokedTemporaryGrants` is expected to be 0 throughout.
    grants: new PgTemporaryGrantRepository(db),
    clock: { now: () => new Date().toISOString() },
  };

  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );

  // 组织成员资格是一次性的（同一个 (user_id, org_id) 只能有一行），跟工作坊无关，
  // 所以放在 beforeAll 里建一次；下面每条断言各建一个独立工作坊的是项目成员资格。
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  // 组织 admin，但**没有**任何工作坊的项目角色——D-18「管理员不是超级用户」。
  await addOrgMember(ORG, ADMIN_NO_PROJECT_ROLE, "admin", null);
});

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
});

/**
 * 每条断言各建一个独立工作坊（而不是共用一个），原因不只是「互不干扰」这么简单：
 * `agenda_segments_one_active_per_workshop` 是按 workshop 分区的部分唯一索引——上一条
 * 断言里被**正确拒绝**的调用，环节仍然停在 `active`（拒绝不改变状态），如果和下一条断言
 * 共用同一个工作坊，下一条的 `seedActiveSegment` 会在插入第二条 active 环节时撞上这条
 * 索引。给每条断言一个专属工作坊，让「拒绝后环节原地不动」这件事不会外溢到别的断言。
 */
async function seedWorkshopWithRole(workshopId: string, userId: string, role: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      workshopId,
      ORG,
      `workshop ${workshopId}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [workshopId, ORG]));
  await addProjectMember(ORG, workshopId, userId, role, null);
}

async function seedActiveSegment(workshopId: string, id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,'seg',15,'active')`,
      [id, ORG, workshopId],
    ),
  );
}

async function tryAdvance(userId: string, workshopId: string, segmentId: string) {
  return advanceAgendaSegment(deps, {
    userId,
    orgId: toOrgId(ORG),
    workshopId,
    segmentId,
    action: "advance",
    mergeIntoSegmentId: null,
  });
}

describe("F119: 权限闭集判定——谁能做这四个动作", () => {
  it("正向控制组：facilitator 持有 agendaSegment.advance，调用成功", async () => {
    const W = `${ORG}-w-facilitator`;
    const SEG = "f119-rg-seg-facilitator";
    await seedWorkshopWithRole(W, FACILITATOR, "facilitator");
    await seedActiveSegment(W, SEG);
    const out = await tryAdvance(FACILITATOR, W, SEG);
    expect(out.segment.state).toBe("closed");
  });

  it("groupLead：有项目角色但角色里没有 agendaSegment.advance → PROJECT_ROLE_INSUFFICIENT", async () => {
    const W = `${ORG}-w-group-lead`;
    const SEG = "f119-rg-seg-group-lead";
    await seedWorkshopWithRole(W, GROUP_LEAD, "groupLead");
    await seedActiveSegment(W, SEG);
    await expect(tryAdvance(GROUP_LEAD, W, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("member：同上 → PROJECT_ROLE_INSUFFICIENT", async () => {
    const W = `${ORG}-w-member`;
    const SEG = "f119-rg-seg-member";
    await seedWorkshopWithRole(W, MEMBER, "member");
    await seedActiveSegment(W, SEG);
    await expect(tryAdvance(MEMBER, W, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("observer：同上（read-only ≠ 可推进）→ PROJECT_ROLE_INSUFFICIENT", async () => {
    const W = `${ORG}-w-observer`;
    const SEG = "f119-rg-seg-observer";
    await seedWorkshopWithRole(W, OBSERVER, "observer");
    await seedActiveSegment(W, SEG);
    await expect(tryAdvance(OBSERVER, W, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("无项目角色（含组织 admin）：NO_PROJECT_ROLE——正常状态，不是异常（I-P9）", async () => {
    const W = `${ORG}-w-admin`;
    const SEG = "f119-rg-seg-admin";
    // ADMIN_NO_PROJECT_ROLE 故意不调用 addProjectMember——这条断言就是要验证「有工作坊、
    // 但这个人在这个工作坊里没有项目角色」这一状态，而不是「工作坊不存在」。
    await asApp(ORG, (c) =>
      c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
        W,
        ORG,
        `workshop ${W}`,
      ]),
    );
    await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [W, ORG]));
    await seedActiveSegment(W, SEG);
    await expect(tryAdvance(ADMIN_NO_PROJECT_ROLE, W, SEG)).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });
});
