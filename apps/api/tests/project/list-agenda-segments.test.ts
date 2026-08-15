/**
 * #853 UC-P6 `listAgendaSegments` —— 与 `createAgendaSegment`（#627）同一次签核、
 * 同一张表，全仓从来没有 controller/application 用例挂它，补上的是实现缺口
 * （见 `application/project/list-agenda-segments.ts` 文件头）。
 *
 * ⚠ 本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`（issue #74）。
 *
 * 权限那半：复用既有动作词 `read.published`（不是新动作词），四种角色都持有它，
 * `rbac-role-matrix.test.ts` 已经穷举过这个动作对四个角色的判定——本文件只钉
 * facilitator/observer 两条代表性通过断言 + 无角色一条拒绝,不重复穷举。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgAgendaSegmentRepository } from "../../src/infrastructure/project/pg-agenda-segment-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { createAgendaSegment } from "../../src/application/project/create-agenda-segment";
import {
  listAgendaSegments,
  type ListAgendaSegmentsDeps,
} from "../../src/application/project/list-agenda-segments";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "i853-org-list-segments";

const FACILITATOR = "u-i853-facilitator";
const OBSERVER = "u-i853-observer";
const NO_ROLE = "u-i853-no-role";

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `i853-d-${this.n}`;
  }
}

let db: PgDatabase;
let deps: ListAgendaSegmentsDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    auth: { repo: new PgIdentityRepository(db), ids: new SeqDecisionIds() },
    segments: new PgAgendaSegmentRepository(db, new UuidIdFactory()),
  };

  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addOrgMember(ORG, NO_ROLE, "consultant", null);
});

afterAll(async () => {
  await resetOrgs(ORG);
  await db?.close();
});

async function seedWorkshop(workshopId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')", [
      workshopId,
      ORG,
      `workshop ${workshopId}`,
    ]),
  );
  await asApp(ORG, (c) => c.query("INSERT INTO workshops (id, org_id) VALUES ($1,$2)", [workshopId, ORG]));
}

describe("#853 listAgendaSegments", () => {
  it("facilitator：按 ordinal 升序拿到刚建的两条，不筛状态（pending 也在）", async () => {
    const workshopId = "i853-wksp-two";
    await seedWorkshop(workshopId);
    await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);

    // 反空转：建之前必须是空数组——少了这条，下面「两条」有可能从第一天起就是假的
    // （种子若不慎种了行，或者本函数是个返回常量的桩，两者都会照样绿）。
    const before = await listAgendaSegments(deps, { userId: FACILITATOR, orgId: toOrgId(ORG), workshopId });
    expect(before).toEqual([]);

    const second = await createAgendaSegment(
      { auth: deps.auth, segments: deps.segments },
      {
        userId: FACILITATOR, orgId: toOrgId(ORG), workshopId,
        agendaSegmentDefinitionId: null, ordinal: 1, title: "第二环节", duration: 20,
      },
    );
    const first = await createAgendaSegment(
      { auth: deps.auth, segments: deps.segments },
      {
        userId: FACILITATOR, orgId: toOrgId(ORG), workshopId,
        agendaSegmentDefinitionId: null, ordinal: 0, title: "开场", duration: 15,
      },
    );

    const rows = await listAgendaSegments(deps, { userId: FACILITATOR, orgId: toOrgId(ORG), workshopId });
    expect(rows.map((r) => r.id)).toEqual([first.id, second.id]); // ordinal 升序，不是插入顺序
    expect(rows.every((r) => r.state === "pending")).toBe(true);
  });

  it("observer：只读角色也能看到（read.published 四角色共有）", async () => {
    const workshopId = "i853-wksp-observer";
    await seedWorkshop(workshopId);
    // 建的人是 facilitator（observer 没有 agendaSegment.create）；本条只验证「读」。
    await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);
    await createAgendaSegment(
      { auth: deps.auth, segments: deps.segments },
      {
        userId: FACILITATOR, orgId: toOrgId(ORG), workshopId,
        agendaSegmentDefinitionId: null, ordinal: 0, title: "观察者也能看到这条", duration: 10,
      },
    );
    await addProjectMember(ORG, workshopId, OBSERVER, "observer", null);

    const rows = await listAgendaSegments(deps, { userId: OBSERVER, orgId: toOrgId(ORG), workshopId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("观察者也能看到这条");
  });

  it("🔴 无项目角色：NO_PROJECT_ROLE（I-P9：正常状态，不是异常）", async () => {
    const workshopId = "i853-wksp-norole";
    await seedWorkshop(workshopId);
    // NO_ROLE 是组织成员，但没有加进这个工作坊——刻意不调 addProjectMember。

    await expect(
      listAgendaSegments(deps, { userId: NO_ROLE, orgId: toOrgId(ORG), workshopId }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });
});
