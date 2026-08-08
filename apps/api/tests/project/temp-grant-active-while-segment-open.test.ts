/**
 * F127 🔴 反向反证: 只有 `temp-grant-revoked-by-four-outcomes.test.ts` 的四条正向断言，
 * 一个「advanceAgendaSegment 从不授权、永远返回一个假的非零/或永远返回全部存在的 grant 数」
 * 的实现也可能蒙混过关（例如：把工作坊里全部仍存活的临时提权一次性收回，而不是只收回
 * **这一条**刚终结的环节名下的那些）。本文件反过来断言：
 *
 *   ① 环节仍在进行中（active/pending）时，挂在它上面的临时提权不受"别的环节推进"影响；
 *   ② 推进 A 环节时，`revokedTemporaryGrants` 只数 A 名下的 grant，不牵连挂在 B（仍在
 *      进行中）上的 grant——即便 A 与 B 同属一个工作坊。
 *
 * 与 F05 `tests/auth/temp-grant-expires-on-stage.test.ts` 里同名的反向反证（fakes 上）
 * 是同一条断言的两层：那边测的是 `checkTemporaryGrantAccess` 的纯判定逻辑，这里测的是
 * F127 新增的、`advanceAgendaSegment` 对真实 Postgres 存储层的收回范围。
 *
 * ⚠ **本文件需要真实 Postgres，本地只跑 `tsc` 做类型检查，不执行 `vitest run`**（issue #74）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgAgendaSegmentRepository } from "../../src/infrastructure/project/pg-agenda-segment-repository";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { PgTemporaryGrantRepository } from "../../src/infrastructure/identity/pg-temporary-grant-repository";
import {
  advanceAgendaSegment,
  type AdvanceAgendaSegmentDeps,
} from "../../src/application/project/advance-agenda-segment";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";

const ORG = "f127-org-active-while-open";
const FACILITATOR = "u-f127-aw-facilitator";
const GRANTEE_A = "u-f127-aw-grantee-a";
const GRANTEE_B = "u-f127-aw-grantee-b";

const SCOPE_A = { action: "read.rawTranscript", groupId: "g1" } as const;
const SCOPE_B = { action: "read.rawTranscript", groupId: "g2" } as const;

class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f127-aw-d-${this.n}`;
  }
}

class SeqIds {
  private n = 0;
  next(): string {
    this.n += 1;
    return `f127-aw-grant-${this.n}`;
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
    segments: new PgAgendaSegmentRepository(db, new UuidIdFactory()),
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

describe("F127 🔴 反向反证: 环节仍进行中时，挂在它上面的临时提权不因别的环节推进而被收回", () => {
  it("推进 A（active -> closed），B（pending -> active）名下的 grant 完全不受影响", async () => {
    const W = `${ORG}-w-two-segments`;
    const A = `${W}-a`;
    const B = `${W}-b`;
    const C = `${W}-c`;
    await seedWorkshop(W);
    await seedSegment(W, A, 0, "active");
    await seedSegment(W, B, 1, "pending");
    await seedSegment(W, C, 2, "pending");

    // 正向前提：两条环节各挂一条临时提权，此刻都活着（A active，B pending -- 都不是终态）。
    await grants.create({
      id: ids.next(),
      orgId: toOrgId(ORG),
      workshopId: W,
      granterId: FACILITATOR,
      granteeId: GRANTEE_A,
      scope: SCOPE_A,
      agendaSegmentId: A,
      createdAt: new Date().toISOString(),
    });
    const grantB = await grants.create({
      id: ids.next(),
      orgId: toOrgId(ORG),
      workshopId: W,
      granterId: FACILITATOR,
      granteeId: GRANTEE_B,
      scope: SCOPE_B,
      agendaSegmentId: B,
      createdAt: new Date().toISOString(),
    });

    const beforeB = await grants.findActive(toOrgId(ORG), GRANTEE_B, SCOPE_B);
    expect(beforeB?.id).toBe(grantB.id);
    expect(beforeB?.revokedAt).toBeNull();

    // 只推进 A -- B 自己还没被 advanceAgendaSegment 碰过（它只是被动地从 pending 变成
    // active，因为它是下一条），所以 B 名下的 grant 不应该被这次调用当成"挂在被推进环节上"的一员。
    const out = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: A,
      action: "advance",
      mergeIntoSegmentId: null,
    });

    expect(out.segment.state).toBe("closed");
    // 只收回 A 名下的那一条，不是"工作坊里全部活着的 grant"。
    expect(out.revokedTemporaryGrants).toBe(1);

    // B 仍是 active（下一条被自动激活），B 名下的 grant 依旧存活、未被收回。
    const afterB = await grants.findActive(toOrgId(ORG), GRANTEE_B, SCOPE_B);
    expect(afterB?.id).toBe(grantB.id);
    expect(afterB?.revokedAt).toBeNull();

    const stillOnB = await grants.findActiveBySegment(toOrgId(ORG), W, B);
    expect(stillOnB).toHaveLength(1);
    expect(stillOnB[0]!.id).toBe(grantB.id);

    // C 从未被触碰，本来就没有 grant——不是这条断言的重点，只是确认它没有被意外牵连。
    const onC = await grants.findActiveBySegment(toOrgId(ORG), W, C);
    expect(onC).toHaveLength(0);
  });

  it("反过来推进 B 之后，A 名下先前已经因为自己终结而收回的 grant 不会被重复计入 B 这次的收回数", async () => {
    const W = `${ORG}-w-sequential`;
    const A = `${W}-a`;
    const B = `${W}-b`;
    await seedWorkshop(W);
    await seedSegment(W, A, 0, "active");
    await seedSegment(W, B, 1, "pending");

    await grants.create({
      id: ids.next(),
      orgId: toOrgId(ORG),
      workshopId: W,
      granterId: FACILITATOR,
      granteeId: GRANTEE_A,
      scope: SCOPE_A,
      agendaSegmentId: A,
      createdAt: new Date().toISOString(),
    });
    await grants.create({
      id: ids.next(),
      orgId: toOrgId(ORG),
      workshopId: W,
      granterId: FACILITATOR,
      granteeId: GRANTEE_B,
      scope: SCOPE_B,
      agendaSegmentId: B,
      createdAt: new Date().toISOString(),
    });

    const first = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: A,
      action: "advance",
      mergeIntoSegmentId: null,
    });
    expect(first.revokedTemporaryGrants).toBe(1); // A 的 grant

    const second = await advanceAgendaSegment(deps, {
      userId: FACILITATOR,
      orgId: toOrgId(ORG),
      workshopId: W,
      segmentId: B,
      action: "advance",
      mergeIntoSegmentId: null,
    });
    expect(second.revokedTemporaryGrants).toBe(1); // 只有 B 自己的 grant，不是 0 也不是 2
  });
});
