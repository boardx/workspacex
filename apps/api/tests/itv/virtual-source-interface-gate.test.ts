/**
 * F03（phase-11-research-insight-backend，issue #1648）—— 虚拟来源隔离门：
 * `markStrongInsight` / `referenceForDecision` 在接口层拒绝虚拟来源（uc-6-5 R3 step5,
 * R7，`packages/contracts/src/interview.ts` `markStrongInsight`/`referenceForDecision`）。
 *
 * ## 这个文件必须立住的一条不变量
 *
 * **接口层拒绝，不是前端按钮置灰**（AC3/V3/I-28）：本文件直接调
 * `application/interview/mark-strong-insight.ts` 与 `reference-for-decision.ts`——
 * 这是 controller 背后真正执行判定的那一层，不经任何前端组件，"绕过前端直接调 API
 * 仍被拒" 这条断言看的正是"调用被拒绝"本身。两个用例共用同一道门
 * `domain/interview/insight-source-gate.ts` 的 `checkSourceAllowsStrongUse`。
 *
 * ## 真实持久化
 *
 * 走真实 Postgres：先用 F01 已合入 main 的 `extractQuotes` → `generateCandidateInsights`
 * → `confirmInsight` 三步真实落一条真人来源洞察与一条虚拟来源洞察，再对这两条已入库的
 * 洞察调 `markStrongInsight`/`referenceForDecision`。混合来源的 `sourceKind` 传播规则
 * 由 F01 的 `candidate-insight.ts` 落定，本文件只消费既成结果，不重算。
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
import { markStrongInsight } from "../../src/application/interview/mark-strong-insight";
import { referenceForDecision } from "../../src/application/interview/reference-for-decision";
import { NoInterviewAccessError, VirtualSourceForbiddenError } from "../../src/application/interview/errors";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1648-virtual-gate";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1648-researcher";
const INTERVIEW_ID = "itv-i1648-session";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const insights = new PgInterviewInsightRepository(db);
const consent = new PgConsentDeclineReader(db);
const context = new ContextApiInsightMaterialReader(db, new PgIdentityRepository(db));
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

async function seedSubject(subjectId: string, sourceKind: "human" | "virtual"): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [subjectId, ORG, `受访者 ${subjectId}`, sourceKind, RESEARCHER],
    ),
  );
}

async function seedSegment(segmentId: string, content: string, subjectId: string | null): Promise<void> {
  await indexSegment({
    orgId: ORG,
    segmentId,
    artifactId: `art-${segmentId}`,
    content,
    sourceType: "interview",
    speakerSubjectId: subjectId,
    anchor: { kind: "timecode", locator: "00:00:01" },
  });
}

async function bindContextPack(runId: string, segmentIds: readonly string[]): Promise<void> {
  const { assembleFromRecorded } = await import("../../src/application/context-pack/replay-pack");
  const { packContentHash } = await import("../../src/domain/context-pack/pack-hash");
  const recorded = {
    runId, packId: `${runId}-pack`, orgId: ORG_ID,
    query: {
      tenantId: ORG, principalId: RESEARCHER, projectIds: [], task: "decision-support",
      query: "虚拟来源隔离", timeRange: null, allowedSensitivity: ["internal"], tokenBudget: 1000,
      freshnessRequirement: null, evidencePolicy: "all",
    },
    retrievalPlan: [{ channel: "fts", weight: 1, hitCount: segmentIds.length }],
    candidates: segmentIds.map((segmentId, i) => ({
      segmentId, content: `材料-${i}`, sourceType: "interview", artifactVersionId: `art-${segmentId}-v1`,
      anchor: { page: 1 }, retrievalReasons: ["recall"], channels: ["fts"], score: 0.9,
      permissionDecisionId: `decision-${segmentId}`, relevance: 0.9, relevanceProvenance: "fixture",
      tokens: 10, fingerprint: segmentId, confidential: false,
    })),
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

/** 走真实三步写路径（F01），产出一条已入库、真实来源为 `sourceKind` 的洞察 id。 */
async function confirmRealInsight(label: string, sourceKind: "human" | "virtual"): Promise<string> {
  const subjectId = `subj-i1648-${label}`;
  const segmentId = `seg-i1648-${label}`;
  const runId = `run-i1648-${label}`;

  await seedSubject(subjectId, sourceKind);
  await seedSegment(segmentId, `${label} 的原话，用于虚拟隔离测试。`, subjectId);

  const candidates = new InMemoryInsightCandidateStore();
  const generator = new HeuristicCandidateInsightGenerator();

  const extracted = await extractQuotes(
    { scope, decisions, segments, quotes, ids },
    { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, segmentIds: [segmentId], rqBinding: null },
  );
  expect(extracted.quotes).toHaveLength(1);

  await bindContextPack(runId, [segmentId]);
  const generated = await generateCandidateInsights(
    { context, quotes, consent, generator, candidates, ids },
    { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null, contextPackId: runId },
  );
  expect(generated.candidates).toHaveLength(1);
  expect(generated.candidates[0]!.sourceKind).toBe(sourceKind);

  const confirmed = await confirmInsight(
    { candidates, quotes, insights },
    { orgId: ORG_ID, actorId: RESEARCHER, candidateId: generated.candidates[0]!.insightId, edits: null },
  );
  expect(confirmed.sourceKind).toBe(sourceKind);
  expect(confirmed.strong).toBe(false);
  return confirmed.insightId;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F03 虚拟来源隔离门 —— markStrongInsight / referenceForDecision 接口层拒绝", () => {
  beforeAll(async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG_ID, projectId: "proj-i1648" });
    await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy ?? null);
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO interview_sessions (id, org_id, source_kind, title, created_by)
         VALUES ($1,$2,'human','F03 虚拟隔离',$3)`,
        [INTERVIEW_ID, ORG, RESEARCHER],
      ),
    );
  });

  it("真人来源：markStrongInsight 放行并真正落库 strong=true", async () => {
    const insightId = await confirmRealInsight("human-strong", "human");

    const result = await markStrongInsight({ insights }, { orgId: ORG_ID, insightId });
    expect(result).toEqual({ ok: true });

    // ⚠ 断言查的是已提交的行，不是同一次调用返回值的自我复述——独立一次仓储读取。
    const persisted = await insights.getById(ORG_ID, insightId);
    expect(persisted).not.toBeNull();
    expect(persisted!.strong).toBe(true);
  });

  it("虚拟来源：markStrongInsight 在接口层被拒绝（VIRTUAL_SOURCE_FORBIDDEN），且不改动 strong", async () => {
    const insightId = await confirmRealInsight("virtual-strong", "virtual");

    await expect(
      markStrongInsight({ insights }, { orgId: ORG_ID, insightId }),
    ).rejects.toBeInstanceOf(VirtualSourceForbiddenError);

    // 拒绝必须是真拒绝——DB 里这条洞察的 strong 依旧是 false，不是"报错但偷偷写了"。
    const persisted = await insights.getById(ORG_ID, insightId);
    expect(persisted!.strong).toBe(false);
  });

  it("真人来源：referenceForDecision 放行", async () => {
    const insightId = await confirmRealInsight("human-decision", "human");

    const result = await referenceForDecision(
      { insights },
      { orgId: ORG_ID, insightId, decisionId: "dec-i1648-allowed" },
    );
    expect(result).toEqual({ ok: true });
  });

  it("虚拟来源：referenceForDecision 在接口层被拒绝（VIRTUAL_SOURCE_FORBIDDEN）——同一道门，不是两处各自判定", async () => {
    const insightId = await confirmRealInsight("virtual-decision", "virtual");

    await expect(
      referenceForDecision({ insights }, { orgId: ORG_ID, insightId, decisionId: "dec-i1648-denied" }),
    ).rejects.toBeInstanceOf(VirtualSourceForbiddenError);
  });

  it("绕过前端直接调接口层同样被拒：两个算子对同一条虚拟来源洞察给出相同的拒绝理由", async () => {
    const insightId = await confirmRealInsight("virtual-both", "virtual");

    const markResult = await markStrongInsight({ insights }, { orgId: ORG_ID, insightId }).catch((e) => e);
    const refResult = await referenceForDecision(
      { insights },
      { orgId: ORG_ID, insightId, decisionId: "dec-i1648-both" },
    ).catch((e) => e);

    expect(markResult).toBeInstanceOf(VirtualSourceForbiddenError);
    expect(refResult).toBeInstanceOf(VirtualSourceForbiddenError);
    expect((markResult as VirtualSourceForbiddenError).code).toBe("VIRTUAL_SOURCE_FORBIDDEN");
    expect((refResult as VirtualSourceForbiddenError).code).toBe("VIRTUAL_SOURCE_FORBIDDEN");
  });

  it("不存在的 insightId：markStrongInsight 与 referenceForDecision 都不可区分地报『无访问权』", async () => {
    await expect(
      markStrongInsight({ insights }, { orgId: ORG_ID, insightId: "insight-does-not-exist" }),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
    await expect(
      referenceForDecision(
        { insights },
        { orgId: ORG_ID, insightId: "insight-does-not-exist", decisionId: "dec-i1648-missing" },
      ),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
  });
});
