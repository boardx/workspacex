/**
 * F17 V11④ —— **两侧**都写 `provenance_events`，目标侧标注来源；
 * 且**审计写不下去，这次导出就没有发生过**。
 *
 * ## 后一句才是这个文件的重点
 *
 * 「导出时写一条审计」是任何实现都会做的事，而且它一写就绿。会活下来的失效是另一种：
 * 副本已经落地、审计那一步失败了、请求返回了 500——于是目标组织里多了一份**没有任何
 * 记录说明它从哪来**的材料。没有任何东西会报警：行是完整的，查询是正常的，
 * 只有事后有人问「这份东西谁放进来的」时才会发现问题，而那时已经无法回答。
 *
 * F08 刚刚把 `provenance_events` 做成了真正的 append-only（触发器 + 撤销 DELETE 授权，
 * 并且证明了 referential action 会跳过子表权限检查）。那保证的是**已经写下的记不掉**。
 * 这里保证的是另一半：**该写的没写下来，事情就不算发生**。
 *
 * ## 断言 / 反证
 *
 *   两侧各一条事件，且能互相对上                ← 只查一侧会放过「只写了一半」
 *   目标侧事件带来源标注，措辞与落库、与契约一致 ← 三处措辞漂移会让「审没审过」有两个答案
 *   审计写失败 ⇒ 事务回滚 ⇒ 目标侧一行都没有    ← 这条是本文件存在的理由
 *   事件删不掉（F08 的 append-only 仍然生效）    ← 「留痕」若可撤销就不是留痕
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C, provenance as P } from "@repo/contracts";
import { asApp, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { seedExportFixture, useTempObjectStore, type ExportFixture } from "../support/export-db";
import { PgLocalExportRepository } from "../../src/infrastructure/identity/pg-local-export-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import type { TenantSession } from "../../src/application/ports/database.port";
import type {
  ProvenanceAppendInput,
  ProvenanceWriter,
} from "../../src/application/provenance/ports";
import type { OrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const OBJECT_ROOT = useTempObjectStore();

const LOCAL_ORG = "org-f17-prov-local";
const REAL_ORG = "org-f17-prov-real";
const PREFIX = "f17prov";

let BASE: string;
let app: NestExpressApplication;
let fx: ExportFixture;

const authFor = (user: string, org: string) => ({
  "x-kernel-test-principal": `${user}:${org}`,
  "content-type": "application/json",
});

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(LOCAL_ORG, REAL_ORG);
});

beforeEach(async () => {
  await resetOrgs(LOCAL_ORG, REAL_ORG);
  fx = await seedExportFixture({
    prefix: PREFIX, localOrg: LOCAL_ORG, realOrg: REAL_ORG, objectRoot: OBJECT_ROOT,
  });
});

async function runExport(): Promise<Response> {
  const p = await fetch(`${BASE}/identity/export/preview`, {
    method: "POST",
    headers: authFor(fx.owner, LOCAL_ORG),
    body: JSON.stringify({ fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG, artifactIds: fx.artifactIds }),
  });
  expect(p.status, await p.clone().text()).toBe(200);
  const { token } = (await p.json()) as { token: string };
  return fetch(`${BASE}/identity/export`, {
    method: "POST",
    headers: authFor(fx.owner, LOCAL_ORG),
    body: JSON.stringify({
      fromLocalOrgId: LOCAL_ORG, toOrgId: REAL_ORG,
      artifactIds: fx.artifactIds, confirmedPreviewToken: token,
    }),
  });
}

interface EventRow {
  id: string;
  type: string;
  actor_id: string;
  target_kind: string;
  target_id: string;
  detail: Record<string, unknown>;
}

async function exportEvents(orgId: string): Promise<EventRow[]> {
  const r = await asApp(orgId, (c) =>
    c.query<EventRow>(
      `SELECT id, type, actor_id, target_kind, target_id, detail
         FROM provenance_events WHERE org_id = $1 AND type = 'local-export' ORDER BY at, id`,
      [orgId],
    ),
  );
  return r.rows;
}

async function targetArtifactCount(): Promise<number> {
  const r = await asApp(REAL_ORG, (c) =>
    c.query<{ n: string }>("SELECT count(*)::text AS n FROM artifacts WHERE org_id = $1", [REAL_ORG]),
  );
  return Number(r.rows[0]!.n);
}

/* ═════════════════════ 两侧都留痕 ═════════════════════ */

describe("一次导出，两侧各留一条，且能互相对上", () => {
  it("本地侧与目标侧各有一条 local-export 事件，且响应里的 id 就是它们", async () => {
    const r = await runExport();
    expect(r.status, await r.clone().text()).toBe(200);
    const body = (await r.json()) as {
      localProvenanceEventId: string; targetProvenanceEventId: string; copiedArtifactIds: string[];
    };
    expect(C.operations.exportToOrganization.out.safeParse(body).success, JSON.stringify(body)).toBe(true);

    const local = await exportEvents(LOCAL_ORG);
    const target = await exportEvents(REAL_ORG);
    // 断言性质：两侧都恰好记录了这一次导出，且响应交出的 id 指向真实存在的行。
    expect(local.map((e) => e.id)).toContain(body.localProvenanceEventId);
    expect(target.map((e) => e.id)).toContain(body.targetProvenanceEventId);
    expect(body.localProvenanceEventId).not.toBe(body.targetProvenanceEventId);

    for (const e of [...local, ...target]) {
      expect(e.actor_id).toBe(fx.owner);
      // 事件形状仍然过共享契约——两束共用一张表、一个查询面（X-2）。
      expect(P.ProvenanceEventType.safeParse(e.type).success).toBe(true);
      expect(e.target_kind).toBe("organization");
    }
  });

  it("两条事件都载着**同一份**源→目标映射，于是「哪一件去了哪里」有答案", async () => {
    await runExport();
    const [local] = await exportEvents(LOCAL_ORG);
    const [target] = await exportEvents(REAL_ORG);
    const localCopies = local!.detail.copies as { sourceArtifactId: string; targetArtifactId: string }[];
    const targetCopies = target!.detail.copies as { sourceArtifactId: string; targetArtifactId: string }[];

    // ⚠ 这份映射是响应体表达不了的东西（KNOWN_CONTRACT_GAPS.C_F17_2），
    //   审计是它唯一的落脚点。两侧不一致就等于没有。
    expect(localCopies).toEqual(targetCopies);
    expect(localCopies.map((c) => c.sourceArtifactId).sort()).toEqual([...fx.artifactIds].sort());

    const targetIds = await asApp(REAL_ORG, (c) =>
      c.query<{ id: string }>("SELECT id FROM artifacts WHERE org_id = $1 ORDER BY id", [REAL_ORG]),
    );
    expect(localCopies.map((c) => c.targetArtifactId).sort())
      .toEqual(targetIds.rows.map((x) => x.id).sort());
  });

  it("目标侧的事件说清「来自本地组织，未经本组织入库审核」，措辞与库里、与契约逐字一致", async () => {
    await runExport();
    const [target] = await exportEvents(REAL_ORG);
    const expected = C.localExportUnvettedNote(fx.owner);

    expect(target!.detail.direction).toBe("inbound-from-local-org");
    expect(target!.detail.fromOrgId).toBe(LOCAL_ORG);
    expect(target!.detail.unvettedNote).toBe(expected);

    const rows = await asApp(REAL_ORG, (c) =>
      c.query<{ imported_from_note: string }>(
        "SELECT imported_from_note FROM artifacts WHERE org_id = $1", [REAL_ORG],
      ),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      // 三处（契约 / 行 / 事件）必须是同一句。散在三处各写一遍，就会出现
      // 「审计说未审核、条目说来自导入」这种彼此不矛盾却也不一致的状态。
      expect(row.imported_from_note).toBe(expected);
    }
  });

  it("本地侧的事件明说这是复制不是迁移", async () => {
    await runExport();
    const [local] = await exportEvents(LOCAL_ORG);
    expect(local!.detail.direction).toBe("outbound-to-organization");
    expect(local!.detail.toOrgId).toBe(REAL_ORG);
    expect(local!.detail.movedLocalCopy).toBe(false);
  });

  it("F08 仍然生效：这两条事件删不掉、改不了", async () => {
    // 「留痕」如果可以事后撤销，它就不是留痕。这一条不是重复 F08 的测试——
    // 它断言 F17 新写进来的这类事件也在同一道保护之内。
    await runExport();
    const [target] = await exportEvents(REAL_ORG);
    await expect(
      asApp(REAL_ORG, (c) =>
        c.query("DELETE FROM provenance_events WHERE id = $1", [target!.id]),
      ),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY|permission denied/);
    await expect(
      asApp(REAL_ORG, (c) =>
        c.query("UPDATE provenance_events SET detail = '{}'::jsonb WHERE id = $1", [target!.id]),
      ),
    ).rejects.toThrow(/AUDIT_APPEND_ONLY|permission denied/);
  });
});

/* ═════════════════════ 审计写失败 ⇒ 整个导出失败 ═════════════════════ */

/**
 * 一个只在**第 N 次** append 时炸的 writer。
 *
 * 直接用 repository 而不是走 HTTP：要注入的失败发生在事务中段，HTTP 层没有任何缝隙
 * 能塞进去。这里换来的是「测的是真实的 `commitExport`、真实的 PostgreSQL 事务」——
 * 而那正是这条性质的所在地。
 */
class FailingProvenanceWriter implements ProvenanceWriter {
  private calls = 0;
  constructor(private readonly inner: ProvenanceWriter, private readonly failOnCall: number) {}
  append(input: ProvenanceAppendInput): Promise<string> {
    return this.inner.append(input);
  }
  appendWithin(s: TenantSession, input: ProvenanceAppendInput): Promise<string> {
    this.calls += 1;
    if (this.calls === this.failOnCall) {
      return Promise.reject(new Error("simulated audit write failure"));
    }
    return this.inner.appendWithin(s, input);
  }
}

describe("审计写不下去，这次导出就没有发生过", () => {
  const plan = () => [{
    sourceArtifactId: fx.artifactIds[0]!,
    targetArtifactId: `${PREFIX}-target-1`,
    title: "copied",
    source: "upload",
    synthesized: false,
    versions: [{
      sourceVersionId: `${PREFIX}-seg-1-v1`,
      targetVersionId: `${PREFIX}-target-v1`,
      versionNumber: 1,
      sourceObjectKey: `local/${LOCAL_ORG}/artifacts/${fx.artifactIds[0]}/v1/${PREFIX}-seg-1-v1`,
      targetObjectKey: `${REAL_ORG}/imported/${PREFIX}-target-1/${PREFIX}-target-v1`,
      contentHash: "0".repeat(64),
      mime: "application/octet-stream",
      sizeBytes: 8,
    }],
  }];

  async function commitWith(failOnCall: number): Promise<unknown> {
    const db = new PgDatabase(appConfig());
    try {
      const real = new PgProvenanceRepository(db);
      const repo = new PgLocalExportRepository(db, new FailingProvenanceWriter(real, failOnCall));
      return await repo.commitExport({
        fromLocalOrgId: LOCAL_ORG as OrgId,
        toOrgId: REAL_ORG as OrgId,
        actorId: fx.owner,
        ownerDisplayId: fx.owner,
        items: plan(),
      });
    } finally {
      await db.close();
    }
  }

  it("先验：同一条路径在审计正常时确实会写出副本", async () => {
    // 没有这一条，下面两条会被一个「commitExport 永远什么都不做」的实现满足。
    const db = new PgDatabase(appConfig());
    try {
      const prov = new PgProvenanceRepository(db);
      const repo = new PgLocalExportRepository(db, prov);
      await repo.commitExport({
        fromLocalOrgId: LOCAL_ORG as OrgId, toOrgId: REAL_ORG as OrgId,
        actorId: fx.owner, ownerDisplayId: fx.owner, items: plan(),
      });
    } finally {
      await db.close();
    }
    expect(await targetArtifactCount()).toBe(1);
    expect((await exportEvents(LOCAL_ORG)).length).toBe(1);
    expect((await exportEvents(REAL_ORG)).length).toBe(1);
  });

  it("**本地侧**审计失败 ⇒ 目标组织一行都没有", async () => {
    await expect(commitWith(1)).rejects.toThrow(/simulated audit write failure/);
    expect(await targetArtifactCount(), "副本落地了，而没有任何记录说明它从哪来").toBe(0);
    expect((await exportEvents(LOCAL_ORG)).length).toBe(0);
    expect((await exportEvents(REAL_ORG)).length).toBe(0);
  });

  it("**目标侧**审计失败 ⇒ 副本也一起回滚，另一侧那条事件也不留下", async () => {
    // 这是最危险的顺序：行已经插完了，只差最后一条事件。
    // 一个「每步各自提交」的实现在这里会留下一份没有来源记录的材料，
    // 而且本地侧还会留着一条「我导出过」的事件，两边说法不一致。
    await expect(commitWith(2)).rejects.toThrow(/simulated audit write failure/);
    expect(await targetArtifactCount()).toBe(0);
    expect((await exportEvents(LOCAL_ORG)).length, "本地侧留下了一条对不上任何副本的事件").toBe(0);
    expect((await exportEvents(REAL_ORG)).length).toBe(0);
  });
});
