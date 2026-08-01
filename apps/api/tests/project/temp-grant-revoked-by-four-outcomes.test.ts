/**
 * F127 UC-P7 `advanceAgendaSegment` -- `revokedTemporaryGrants` 从恒 0 接上真实收回：
 * 一条挂在某环节上的活跃临时提权，在该环节以四种去向中的任意一种终结时，都必须在
 * **下一次请求**里被服务端主动收回（`temporary-grant.ts` 头部/`advance-agenda-segment.ts`
 * 头部："失效条件是流程节点不是时间点"，advance/closeEarly/merge 落 `closed`，
 * skip 落 `skipped`，四者共用同一条收回路径）。
 *
 * 每个 outcome 各建一个独立工作坊 + 各一条临时提权（同 F119
 * `advance-segment-four-outcomes.test.ts` 的理由：四个 it 共享一个工作坊会在
 * `agenda_segments_one_active_per_workshop` 部分唯一索引上互相踩踏）。
 *
 * ⚠ **本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`**
 *   （issue #74；仓库当前纪律：DB 验证测试只在 CI/测试 agent 环境跑，同
 *   `advance-segment-four-outcomes.test.ts` 文件头的处理）。
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

const ORG = "f127-org-four-outcomes";
const FACILITATOR = "u-f127-facilitator";
const GRANTEE = "u-f127-grantee";

const SCOPE = { action: "read.rawTranscript", groupId: "g2" } as const;

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f127-outcomes-d-${this.n}`;
  }
}

class SeqIds {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f127-grant-${this.n}`;
  }
}

let db: PgDatabase;
let deps: AdvanceAgendaSegmentDeps;
let grants: PgTemporaryGrantRepository;
let ids: SeqIds;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  grants = new PgTemporaryGrantRepository(db);
  ids = new SeqIds();
  deps = {
    auth: { repo: new PgIdentityRepository(db), ids: new SeqDecisionIds() },
    segments: new PgAgendaSegmentRepository(db),
    provenance: new PgProvenanceRepository(db),
    grants,
    clock: { now: () => new Date().toISOString() },
  };
  await resetOrgs(ORG);
  await asApp(ORG, (c) =>
    c.query("INSERT INTO organizations (id, name, kind) VALUES ($1,$2,'organization')", [ORG, `org ${ORG}`]),
  );
  await addOrgMember(ORG, FACILITATOR, "consultant", null);
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
  await addProjectMember(ORG, workshopId, FACILITATOR, "facilitator", null);
}

async function seedSegment(
  workshopId: string,
  id: string,
  ordinal: number,
  state: "pending" | "active" | "closed" | "skipped",
): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agenda_segments (id, org_id, workshop_id, ordinal, title, duration, state)
       VALUES ($1,$2,$3,$4,'seg',15,$5)`,
      [id, ORG, workshopId, ordinal, state],
    ),
  );
}

async function grantOn(workshopId: string, segmentId: string) {
  return grants.create({
    id: ids.next(),
    orgId: toOrgId(ORG),
    workshopId,
    granterId: FACILITATOR,
    granteeId: GRANTEE,
    scope: SCOPE,
    agendaSegmentId: segmentId,
    createdAt: new Date().toISOString(),
  });
}

describe("F127: 四种去向各自触发一次真实收回", () => {
  it("advance（正常推进）：挂在当前环节上的临时提权被收回，revokedTemporaryGrants === 1", async () => {
    const W = `${ORG}-w-advance`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    const grant = await grantOn(W, CUR);

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
    expect(out.revokedTemporaryGrants).toBe(1);
    const stillActive = await grants.findActiveBySegment(toOrgId(ORG), W, CUR);
    expect(stillActive).toHaveLength(0);
    expect((await grants.findActive(toOrgId(ORG), GRANTEE, SCOPE))?.id).not.toBe(grant.id);
  });

  it("closeEarly（提前结束）：同样立即收回，不靠时间点", async () => {
    const W = `${ORG}-w-close-early`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    await grantOn(W, CUR);

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "closeEarly",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
    expect(out.revokedTemporaryGrants).toBe(1);
  });

  it("skip（跳过）：落 skipped 同样触发收回", async () => {
    const W = `${ORG}-w-skip`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    await grantOn(W, CUR);

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "skip",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("skipped");
    expect(out.revokedTemporaryGrants).toBe(1);
  });

  it("merge（合并）：同样落 closed，同样触发收回", async () => {
    const W = `${ORG}-w-merge`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    const TARGET = `${W}-target`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    await seedSegment(W, TARGET, 2, "pending");
    await grantOn(W, CUR);

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "merge",
      mergeIntoSegmentId: TARGET,
    });

    expect(out.segment.state).toBe("closed");
    expect(out.revokedTemporaryGrants).toBe(1);
  });

  it("同一环节挂两条不同 grantee 的临时提权：两条都被收回，count === 2", async () => {
    const W = `${ORG}-w-two-grants`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    await grantOn(W, CUR);
    await grants.create({
      id: ids.next(),
      orgId: toOrgId(ORG),
      workshopId: W,
      granterId: FACILITATOR,
      granteeId: "u-f127-second-grantee",
      scope: { action: "read.privateChat", groupId: null },
      agendaSegmentId: CUR,
      createdAt: new Date().toISOString(),
    });

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.revokedTemporaryGrants).toBe(2);
  });

  it("同一环节没有任何临时提权时，revokedTemporaryGrants === 0（不是恒 0，是如实为 0）", async () => {
    const W = `${ORG}-w-no-grants`;
    const CUR = `${W}-cur`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.revokedTemporaryGrants).toBe(0);
  });
});
