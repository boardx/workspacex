/**
 * F119 UC-P7 `advanceAgendaSegment` —— 权限闭集判定：谁能做这四个动作是闭集，不是
 * 开放式判断。动作词引用 `apps/api/src/domain/identity/project-role-matrix.ts` 的
 * `stage.advance`（I-P10 / I-P12），只有 `facilitator` 持有它。
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
import {
  advanceAgendaSegment,
  type AdvanceAgendaSegmentDeps,
} from "../../src/application/project/advance-agenda-segment";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f119-org-role-gate";
const WORKSHOP = `${ORG}-w1`;

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
  };

  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      WORKSHOP,
      ORG,
      `workshop ${WORKSHOP}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [WORKSHOP, ORG]));

  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, FACILITATOR, "facilitator", null);
  await addOrgMember(ORG, GROUP_LEAD, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, GROUP_LEAD, "groupLead", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, MEMBER, "member", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, WORKSHOP, OBSERVER, "observer", null);
  // 组织 admin，但**没有**这个工作坊的项目角色——D-18「管理员不是超级用户」。
  await addOrgMember(ORG, ADMIN_NO_PROJECT_ROLE, "admin", null);
});

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
});

/** 每条断言各自建一条独立的 active 环节，互不干扰（同 outcomes 文件的理由）。 */
async function seedActiveSegment(id: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,0,'seg',15,'active')`,
      [id, ORG, WORKSHOP],
    ),
  );
}

async function tryAdvance(userId: string, segmentId: string) {
  return advanceAgendaSegment(deps, {
    userId,
    orgId: toOrgId(ORG),
    workshopId: WORKSHOP,
    segmentId,
    action: "advance",
    mergeIntoSegmentId: null,
  });
}

describe("F119: 权限闭集判定——谁能做这四个动作", () => {
  it("正向控制组：facilitator 持有 stage.advance，调用成功", async () => {
    const SEG = "f119-rg-seg-facilitator";
    await seedActiveSegment(SEG);
    const out = await tryAdvance(FACILITATOR, SEG);
    expect(out.segment.state).toBe("closed");
  });

  it("groupLead：有项目角色但角色里没有 stage.advance → PROJECT_ROLE_INSUFFICIENT", async () => {
    const SEG = "f119-rg-seg-group-lead";
    await seedActiveSegment(SEG);
    await expect(tryAdvance(GROUP_LEAD, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("member：同上 → PROJECT_ROLE_INSUFFICIENT", async () => {
    const SEG = "f119-rg-seg-member";
    await seedActiveSegment(SEG);
    await expect(tryAdvance(MEMBER, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("observer：同上（read-only ≠ 可推进）→ PROJECT_ROLE_INSUFFICIENT", async () => {
    const SEG = "f119-rg-seg-observer";
    await seedActiveSegment(SEG);
    await expect(tryAdvance(OBSERVER, SEG)).rejects.toMatchObject({
      reasonCode: "PROJECT_ROLE_INSUFFICIENT",
    });
  });

  it("无项目角色（含组织 admin）：NO_PROJECT_ROLE——正常状态，不是异常（I-P9）", async () => {
    const SEG = "f119-rg-seg-admin";
    await seedActiveSegment(SEG);
    await expect(tryAdvance(ADMIN_NO_PROJECT_ROLE, SEG)).rejects.toMatchObject({
      reasonCode: "NO_PROJECT_ROLE",
    });
  });
});
