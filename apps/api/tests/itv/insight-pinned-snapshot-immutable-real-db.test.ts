/**
 * F01（phase-06，issue #1628）—— V1：入库时固化来源快照，原始转写事后被编辑不影响
 * 已入库洞察的证据文本（R7「入库时必须固化来源快照，日后原始转写被编辑不影响已入库
 * 洞察的证据文本」）。
 *
 * 本文件专门证明这一条不变量本身，与 `insight-write-path-persists-real-db.test.ts`
 * 覆盖三个算子的全链路职责分开——两个文件各自独立可读，不是同一个断言拆成两半。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { indexSegment } from "../support/retrieval-fixtures";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgSegmentReader } from "../../src/infrastructure/interview/pg-segment-reader";
import { PgInterviewQuoteRepository } from "../../src/infrastructure/interview/pg-interview-quote-repository";
import { PgInterviewInsightRepository } from "../../src/infrastructure/interview/pg-interview-insight-repository";
import { PgConsentDeclineReader } from "../../src/infrastructure/interview/pg-consent-decline-reader";
import { ContextApiInsightMaterialReader } from "../../src/infrastructure/interview/context-api-insight-material-reader";
import { InMemoryInsightCandidateStore } from "../../src/infrastructure/interview/in-memory-insight-candidate-store";
import { HeuristicCandidateInsightGenerator } from "../../src/infrastructure/interview/heuristic-candidate-insight-generator";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { extractQuotes } from "../../src/application/interview/extract-quotes";
import { generateCandidateInsights } from "../../src/application/interview/generate-candidate-insights";
import { confirmInsight } from "../../src/application/interview/confirm-insight";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1628-insight-snapshot";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1628-snap-researcher";
const INTERVIEW_ID = "itv-i1628-snap-session";
const SEGMENT_ID = "seg-i1628-snap-1";
const SUBJECT_ID = "subj-i1628-snap-1";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const insights = new PgInterviewInsightRepository(db);
const consent = new PgConsentDeclineReader(db);
const context = new ContextApiInsightMaterialReader(db, new PgIdentityRepository(db));
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();
const candidates = new InMemoryInsightCandidateStore();

const ORIGINAL_TEXT = "原始逐字稿：用户对审批流程的原话。";
const EDITED_TEXT = "被后来编辑过的逐字稿——已入库洞察不该跟着变。";

async function seedFixture(): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1,$2,'受访者','human',$3)`,
      [SUBJECT_ID, ORG, RESEARCHER],
    ),
  );
  // 同 F10 既有 fixture helper：一个事务内建齐 artifact/version/segment/anchor/segment_text
  // （I-7 是 DEFERRED 约束，拆开建会在 segment 那步先失败）。
  await indexSegment({
    orgId: ORG,
    segmentId: SEGMENT_ID,
    artifactId: "art-i1628-snap",
    content: ORIGINAL_TEXT,
    sourceType: "interview",
    speakerSubjectId: SUBJECT_ID,
    anchor: { kind: "timecode", locator: "00:00:01" },
  });
}

async function bindContextPack(runId: string): Promise<void> {
  const { assembleFromRecorded } = await import("../../src/application/context-pack/replay-pack");
  const { packContentHash } = await import("../../src/domain/context-pack/pack-hash");
  const recorded = {
    runId, packId: `${runId}-pack`, orgId: ORG_ID,
    query: {
      tenantId: ORG, principalId: RESEARCHER, projectIds: [], task: "decision-support",
      query: "快照固化验证", timeRange: null, allowedSensitivity: ["internal"], tokenBudget: 1000,
      freshnessRequirement: null, evidencePolicy: "all",
    },
    retrievalPlan: [{ channel: "fts", weight: 1, hitCount: 1 }],
    candidates: [{
      segmentId: SEGMENT_ID, content: "材料-0", sourceType: "interview",
      artifactVersionId: "art-i1628-snap-v1", anchor: { page: 1 }, retrievalReasons: ["recall"],
      channels: ["fts"], score: 0.9, permissionDecisionId: "decision-snap", relevance: 0.9,
      relevanceProvenance: "fixture", tokens: 10, fingerprint: SEGMENT_ID, confidential: false,
    }],
    withheld: [], unanchorable: [], claims: [], thresholdUsed: 0.45,
  } as const;
  const hash = packContentHash(assembleFromRecorded(recorded as never, null));
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO context_packs (run_id, org_id, status, recorded, content_hash, threshold_used)
       VALUES ($1,$2,'assembled',$3::jsonb,$4,$5)`,
      [runId, ORG, JSON.stringify(recorded), hash, recorded.thresholdUsed],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: "proj-i1628-snap" });
  await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy ?? null);
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_sessions (id, org_id, source_kind, title, created_by)
       VALUES ($1,$2,'human','U-8 洞察库',$3)`,
      [INTERVIEW_ID, ORG, RESEARCHER],
    ),
  );
  await seedFixture();
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F01 V1 —— 入库时固化来源快照，原始转写事后编辑不影响已入库洞察", () => {
  it("原始 segment_text.content 被编辑后，已入库洞察的证据文本纹丝不动", async () => {
    const extracted = await extractQuotes(
      { scope, decisions, segments, quotes, ids },
      { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, segmentIds: [SEGMENT_ID], rqBinding: null },
    );
    expect(extracted.quotes[0]!.text).toBe(ORIGINAL_TEXT);

    await bindContextPack("run-i1628-snap");
    const generated = await generateCandidateInsights(
      { context, quotes, consent, generator: new HeuristicCandidateInsightGenerator(), candidates, ids },
      { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null, contextPackId: "run-i1628-snap" },
    );
    expect(generated.candidates).toHaveLength(1);

    const confirmed = await confirmInsight(
      { candidates, quotes, insights },
      { orgId: ORG_ID, actorId: RESEARCHER, candidateId: generated.candidates[0]!.insightId, edits: null },
    );
    expect(confirmed.text).toBe(ORIGINAL_TEXT);

    // ⚠ 原始转写被编辑——直连 SQL，绕开 extractQuotes/confirmInsight，模拟"事后编辑"这个
    // 与洞察写路径完全独立的事件。
    await asApp(ORG, (c) =>
      c.query(`UPDATE segment_text SET content = $1 WHERE org_id = $2 AND segment_id = $3`, [
        EDITED_TEXT, ORG, SEGMENT_ID,
      ]),
    );

    // 原始片段确实变了——排除"编辑没生效"这种假阴性。
    const rawAfterEdit = await asApp(ORG, (c) =>
      c.query(`SELECT content FROM segment_text WHERE org_id=$1 AND segment_id=$2`, [ORG, SEGMENT_ID]),
    );
    expect(rawAfterEdit.rows[0]!.content).toBe(EDITED_TEXT);

    // 已入库洞察的固化快照不受影响——这是 R7 的核心断言。
    const snapshotAfterEdit = await asApp(ORG, (c) =>
      c.query(`SELECT quotes FROM interview_insight_source_snapshots WHERE org_id=$1 AND id=$2`, [
        ORG, confirmed.pinnedSourceSnapshotId,
      ]),
    );
    const frozenQuotes = snapshotAfterEdit.rows[0]!.quotes as { text: string; segmentId: string }[];
    expect(frozenQuotes).toHaveLength(1);
    expect(frozenQuotes[0]!.text).toBe(ORIGINAL_TEXT);
    expect(frozenQuotes[0]!.segmentId).toBe(SEGMENT_ID);

    // 洞察本体（confirmInsight 的返回值/getById 回读）同样不受影响。
    const reread = await insights.getById(ORG_ID, confirmed.insightId);
    expect(reread!.text).toBe(ORIGINAL_TEXT);

    // `interview_quotes.text`（未编辑的引述行本身）也是原文——快照与它此刻仍一致，
    // 但快照的不变量是"就算它以后也被改，快照依然不动"，见下一个断言。
    const quoteRow = await asApp(ORG, (c) =>
      c.query(`SELECT text FROM interview_quotes WHERE org_id=$1 AND segment_id=$2`, [ORG, SEGMENT_ID]),
    );
    expect(quoteRow.rows[0]!.text).toBe(ORIGINAL_TEXT);
  });
});
