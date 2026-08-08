/**
 * #627 UC-P6 `createAgendaSegment` —— 全仓从来没有 controller 挂这条已签核契约，
 * 补上的是实现缺口，不是设计缺口（见 `application/project/create-agenda-segment.ts`
 * 文件头）。
 *
 * ⚠ 本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`（issue #74）。
 *
 * 权限那半：`agendaSegment.create` 是这次新加的动作词，`project-role-matrix.test.ts`
 * （其实是 `rbac-role-matrix.test.ts`，穷举 4 角色 × 每个声明动作）已经自动覆盖它——
 * 本文件不重复穷举四个角色，只钉两条代表性断言（facilitator 通过、member 被拒）+
 * 无角色一条，剩下交给那份已有的穷举测试。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgAgendaSegmentRepository } from "../../src/infrastructure/project/pg-agenda-segment-repository";
import { PgProjectArchiveRepository } from "../../src/infrastructure/project/pg-project-archive-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import {
  createAgendaSegment,
  type CreateAgendaSegmentDeps,
} from "../../src/application/project/create-agenda-segment";
import { ProjectError } from "../../src/application/project/errors";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "i627-org-create-segment";

const FACILITATOR = "u-i627-facilitator";
const MEMBER = "u-i627-member";
const NO_ROLE = "u-i627-no-role";

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `i627-d-${this.n}`;
  }
}

let db: PgDatabase;
let deps: CreateAgendaSegmentDeps;
let archiveRepo: PgProjectArchiveRepository;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = {
    auth: { repo: new PgIdentityRepository(db), ids: new SeqDecisionIds() },
    segments: new PgAgendaSegmentRepository(db, new UuidIdFactory()),
  };
  archiveRepo = new PgProjectArchiveRepository(db);

  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
  await addOrgMember(ORG, MEMBER, "consultant", null);
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

describe("#627 createAgendaSegment", () => {
  it("facilitator 建成功：真的落库，state 恒 pending，不接受入参覆盖", async () => {
    const workshopId = "i627-wksp-ok";
    await seedWorkshop(workshopId);
    await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);

    const row = await createAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId,
      agendaSegmentDefinitionId: null,
      ordinal: 0,
      title: "开场",
      duration: 15,
    });

    expect(row.workshopId).toBe(workshopId);
    expect(row.title).toBe("开场");
    expect(row.duration).toBe(15);
    expect(row.state).toBe("pending");
    expect(row.mergedInto).toBeNull();
    expect(row.acceptedSources).toEqual([]);

    // 真的落库，不是只在内存里造了个对象——用 findById 独立复核一次。
    const persisted = await deps.segments.findById(toOrgId(ORG), workshopId, row.id);
    expect(persisted).toEqual(row);
  });

  it("🔴 member 被拒：PROJECT_ROLE_INSUFFICIENT，且没有落库任何行", async () => {
    const workshopId = "i627-wksp-member";
    await seedWorkshop(workshopId);
    await addProjectMember(ORG, workshopId, MEMBER, "member", null);

    await expect(
      createAgendaSegment(deps, {
        userId: MEMBER,
        orgId: toOrgId(ORG),
        workshopId,
        agendaSegmentDefinitionId: null,
        ordinal: 0,
        title: "不该建成",
        duration: 10,
      }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ROLE_INSUFFICIENT" });

    const count = await asApp(ORG, (c) =>
      c.query<{ n: string }>("SELECT count(*)::text AS n FROM agenda_segments WHERE workshop_id = $1", [
        workshopId,
      ]),
    );
    expect(count.rows[0]!.n).toBe("0");
  });

  it("🔴 无项目角色：NO_PROJECT_ROLE（I-P9：正常状态，不是异常）", async () => {
    const workshopId = "i627-wksp-norole";
    await seedWorkshop(workshopId);
    // NO_ROLE 是组织成员，但没有加进这个工作坊——刻意不调 addProjectMember。

    await expect(
      createAgendaSegment(deps, {
        userId: NO_ROLE,
        orgId: toOrgId(ORG),
        workshopId,
        agendaSegmentDefinitionId: null,
        ordinal: 0,
        title: "x",
        duration: 10,
      }),
    ).rejects.toMatchObject({ reasonCode: "NO_PROJECT_ROLE" });
  });

  it("🔴 已归档的工作坊：PROJECT_ARCHIVED（F124 的 RESTRICTIVE INSERT 策略拒写，仓储翻译）", async () => {
    const workshopId = "i627-wksp-archived";
    await seedWorkshop(workshopId);
    await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);

    const archived = await archiveRepo.archive(toOrgId(ORG), workshopId);
    expect(archived.kind).toBe("archived"); // 反证前提：先确认真的归档成功了，下面的红才立得住。

    await expect(
      createAgendaSegment(deps, {
        userId: FACILITATOR,
        orgId: toOrgId(ORG),
        workshopId,
        agendaSegmentDefinitionId: null,
        ordinal: 0,
        title: "不该建成",
        duration: 10,
      }),
    ).rejects.toMatchObject({ reasonCode: "PROJECT_ARCHIVED" });
  });

  it("🔴 反证的反证：同一个 facilitator，同一份输入，工作坊没归档时是正常 201 路径（证明上一条真的是因为归档，不是别的原因）", async () => {
    const workshopId = "i627-wksp-archived-control";
    await seedWorkshop(workshopId);
    await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);

    const row = await createAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId,
      agendaSegmentDefinitionId: null,
      ordinal: 0,
      title: "对照组",
      duration: 10,
    });
    expect(row.state).toBe("pending");
  });
});

describe("#627 PgAgendaSegmentRepository.create —— 仓储层三态判定（不经 authorize，直接测驱动异常翻译）", () => {
  it("🔴 工作坊 id 不存在：外键冲突（23503）被翻译成 not-found，不是原样抛出", async () => {
    const segments = new PgAgendaSegmentRepository(db, new UuidIdFactory());
    const outcome = await segments.create({
      orgId: toOrgId(ORG),
      workshopId: "i627-does-not-exist",
      agendaSegmentDefinitionId: null,
      ordinal: 0,
      title: "x",
      duration: 10,
    });
    expect(outcome.kind).toBe("not-found");
  });
});
