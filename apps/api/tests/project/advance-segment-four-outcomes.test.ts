/**
 * F119 UC-P7 `advanceAgendaSegment` —— 四种去向（推进 / 提前结束 / 跳过 / 合并），
 * 各自一条断言，不合并成一个泛化的状态转移测试（见 feature notes）。
 *
 * ⚠ **本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`**
 *   （issue #74；仓库当前纪律：DB 验证测试只在 CI/测试 agent 环境跑）。
 *
 * 每个 outcome 各建一个独立工作坊（两条环节：ordinal 0 起 `active`，ordinal 1 `pending`），
 * 避免四个 it 共享一个工作坊时，`agenda_segments_one_active_per_workshop` 的部分唯一索引
 * 让它们互相踩踏。
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
import { MergeTargetRequiredError } from "../../src/application/project/advance-agenda-segment-errors";
import { ProjectError } from "../../src/application/project/errors";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addProjectMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f119-org-outcomes";
const FACILITATOR = "u-f119-facilitator";

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f119-outcomes-d-${this.n}`;
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

async function stateOf(id: string): Promise<{ state: string; merged_into: string | null } | undefined> {
  return asOwner(async (c) => {
    const r = await c.query<{ state: string; merged_into: string | null }>(
      "SELECT state, merged_into FROM agenda_segments WHERE id = $1",
      [id],
    );
    return r.rows[0];
  });
}

describe("F119: 四种去向各自一条断言", () => {
  it("advance（正常推进）：当前环节 closed，下一条 pending 环节成为 active", async () => {
    const W = `${ORG}-w-advance`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
    expect(out.segment.mergedInto).toBeNull();
    expect(await stateOf(NEXT)).toMatchObject({ state: "active" });
  });

  it("closeEarly（提前结束）：当前环节 closed，下一条 pending 环节成为 active", async () => {
    const W = `${ORG}-w-close-early`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "closeEarly",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
    expect(await stateOf(NEXT)).toMatchObject({ state: "active" });
  });

  it("skip（跳过）：当前环节 skipped，下一条 pending 环节成为 active", async () => {
    const W = `${ORG}-w-skip`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "skip",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("skipped");
    expect(await stateOf(NEXT)).toMatchObject({ state: "active" });
  });

  it("merge（合并）：当前环节 closed 且 mergedInto 指向目标环节，下一条 pending 环节仍成为 active", async () => {
    const W = `${ORG}-w-merge`;
    const CUR = `${W}-cur`;
    const NEXT = `${W}-next`;
    const TARGET = `${W}-target`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");
    await seedSegment(W, NEXT, 1, "pending");
    await seedSegment(W, TARGET, 2, "pending");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: CUR,
      action: "merge",
      mergeIntoSegmentId: TARGET,
    });

    expect(out.segment.state).toBe("closed");
    expect(out.segment.mergedInto).toBe(TARGET);
    // 合并进哪一条与「谁是下一条」是两件事：TARGET 是 ordinal 2，NEXT（ordinal 1）才是
    // 紧邻的下一条——两者不应混同。
    expect(await stateOf(NEXT)).toMatchObject({ state: "active" });
    expect(await stateOf(TARGET)).toMatchObject({ state: "pending" });
  });

  it("反证：merge 缺 mergeIntoSegmentId 被拒（契约无专门码，见 advance-agenda-segment-errors.ts）", async () => {
    const W = `${ORG}-w-merge-missing-target`;
    const CUR = `${W}-cur`;
    await seedWorkshop(W);
    await seedSegment(W, CUR, 0, "active");

    await expect(
      advanceAgendaSegment(deps, {
        userId: FACILITATOR,
        orgId: toOrgId(ORG),
        workshopId: W,
        segmentId: CUR,
        action: "merge",
        mergeIntoSegmentId: null,
      }),
    ).rejects.toBeInstanceOf(MergeTargetRequiredError);
  });

  it("反证：对已 closed 的环节再次推进得到 SEGMENT_TERMINAL，两个终态都要各测一次", async () => {
    const W = `${ORG}-w-terminal`;
    const CLOSED = `${W}-closed`;
    const SKIPPED = `${W}-skipped`;
    await seedWorkshop(W);
    await seedSegment(W, CLOSED, 0, "closed");
    await seedSegment(W, SKIPPED, 1, "skipped");

    for (const segmentId of [CLOSED, SKIPPED]) {
      await expect(
        advanceAgendaSegment(deps, {
          userId: FACILITATOR,
          orgId: toOrgId(ORG),
          workshopId: W,
          segmentId,
          action: "advance",
          mergeIntoSegmentId: null,
        }),
      ).rejects.toMatchObject({ reasonCode: "SEGMENT_TERMINAL" } satisfies Partial<ProjectError>);
    }
  });

  it("反证：本环节是工作坊最后一条时，没有下一条可激活——这是正常收尾，不是错误", async () => {
    const W = `${ORG}-w-last-segment`;
    const ONLY = `${W}-only`;
    await seedWorkshop(W);
    await seedSegment(W, ONLY, 0, "active");

    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: ONLY,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
  });
});
