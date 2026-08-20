/**
 * F01（phase-06，issue #1628）—— 洞察写路径的三个算子真正落 Postgres。
 *
 * ## 走的是真实的用例 → 真实的仓储 → 真实的 Postgres
 *
 * `extractQuotes` 读真实的 `segment_text`/`interview_subjects`，写真实的
 * `interview_quotes`；`generateCandidateInsights` 经真实的 `PgContextPackStore`（同
 * `quick-digital-interview.test.ts` 的 `bindContextMaterial` 手法，直接 INSERT 一行
 * `context_packs`，不搭一整条检索管线）取材；`confirmInsight` 落真实的
 * `interview_insights` + `interview_insight_source_snapshots`。只有 Context Pack 的
 * `PgContextPackStore.constraints`（识别模型约束）与候选归纳器是构造出来的替身——
 * 前者是本域权限判断链路之外的另一件事，后者是本 feature 明确"确定性启发式，非
 * 真实模型调用"的既有边界（见 `heuristic-candidate-insight-generator.ts`）。
 *
 * ## 覆盖的验收线索
 *
 * V1（每条洞察可点回不可变来源快照）、V2（ai_analysis=false 的受访者：extractQuotes
 * 仍返回原文，generateCandidateInsights 候选不含该人，excludedSubjectIds 写留痕）、
 * V11/E1（归纳失败已抽引述保留，不产半截洞察）、E2（INSIGHT_NO_EVIDENCE）、
 * A2（全员拒绝退化为 degradedToQuotesOnly）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interview as C } from "@repo/contracts";
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
import { InsightGenerationUnavailableError, InsightNoEvidenceError } from "../../src/application/interview/errors";
import type { CandidateInsightGenerator } from "../../src/application/interview/insight-ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1628-insight-write";
const ORG_ID = toOrgId(ORG);
const RESEARCHER = "u-i1628-researcher";
const INTERVIEW_ID = "itv-i1628-session";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const insights = new PgInterviewInsightRepository(db);
const consent = new PgConsentDeclineReader(db);
const context = new ContextApiInsightMaterialReader(db, new PgIdentityRepository(db));
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

function deps(generator: CandidateInsightGenerator = new HeuristicCandidateInsightGenerator()) {
  return {
    extractDeps: { scope, decisions, segments, quotes, ids },
    generateDeps: { context, quotes, consent, generator, candidates: new InMemoryInsightCandidateStore(), ids },
    confirmDepsFor: (candidates: InMemoryInsightCandidateStore) => ({ candidates, quotes, insights }),
  };
}

async function seedSubject(subjectId: string, sourceKind: "human" | "virtual"): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [subjectId, ORG, `受访者 ${subjectId}`, sourceKind, RESEARCHER],
    ),
  );
}

/**
 * `segment_text`（`extractQuotes` 读它）挂在完整的 artifact → artifact_version →
 * segment（+ 必需的 anchor，I-7 是 DEFERRED 约束）链条下面（0006）。这条链本身不是本
 * 文件要测的事——复用既有的 `indexSegment` fixture helper（F10 既有先例，一个事务内
 * 建齐 artifact/version/segment/anchor/segment_text，见该文件文件头「为什么不能拆开」）。
 */
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
      query: "洞察归纳", timeRange: null, allowedSensitivity: ["internal"], tokenBudget: 1000,
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

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F01 洞察写路径 —— extractQuotes → generateCandidateInsights → confirmInsight", () => {
  beforeAll(async () => {
    await resetOrgs(ORG);
    const fx = await seedOrg({ orgId: ORG_ID, projectId: "proj-i1628" });
    await addOrgMember(ORG, RESEARCHER, "consultant", fx.teams.energy ?? null);
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO interview_sessions (id, org_id, source_kind, title, created_by)
         VALUES ($1,$2,'human','U-8 洞察库',$3)`,
        [INTERVIEW_ID, ORG, RESEARCHER],
      ),
    );
  });

  it("三步全链路真实落库：quotes → 候选 → 已入库洞察，evidenceQuoteIds 与快照一致", async () => {
    await seedSubject("subj-i1628-a", "human");
    await seedSegment("seg-i1628-a1", "用户说：审批流程太慢了。", "subj-i1628-a");
    await seedSegment("seg-i1628-a2", "用户又说：希望能加个提醒。", "subj-i1628-a");

    const { extractDeps, generateDeps, confirmDepsFor } = deps();
    const extracted = await extractQuotes(extractDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: ["seg-i1628-a1", "seg-i1628-a2"], rqBinding: null,
    });
    expect(extracted.quotes).toHaveLength(2);

    // ⚠ 断言查的是已提交的行，不是同一事务内的可见性——独立一次仓储读取。
    const persistedQuotes = await quotes.listByInterviewAndSegments(ORG_ID, INTERVIEW_ID, [
      "seg-i1628-a1", "seg-i1628-a2",
    ]);
    expect(persistedQuotes).toHaveLength(2);

    await bindContextPack("run-i1628-a", ["seg-i1628-a1", "seg-i1628-a2"]);
    const generated = await generateCandidateInsights(generateDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null,
      contextPackId: "run-i1628-a",
    });
    expect(generated.degradedToQuotesOnly).toBe(false);
    expect(generated.candidates).toHaveLength(1);
    expect(generated.candidates[0]!.strong).toBe(false);
    expect(generated.candidates[0]!.pinnedSourceSnapshotId).toBeNull();

    const confirmed = await confirmInsight(confirmDepsFor(generateDeps.candidates), {
      orgId: ORG_ID, actorId: RESEARCHER, candidateId: generated.candidates[0]!.insightId, edits: null,
    });

    expect(confirmed.pinnedSourceSnapshotId).not.toBeNull();
    expect(confirmed.evidenceQuoteIds.sort()).toEqual(
      persistedQuotes.map((q) => q.quoteId).sort(),
    );

    const stored = await insights.getById(ORG_ID, confirmed.insightId);
    expect(stored).not.toBeNull();
    expect(stored!.text).toBe(confirmed.text);

    const snapshotRow = await asApp(ORG, (c) =>
      c.query(`SELECT quotes FROM interview_insight_source_snapshots WHERE org_id=$1 AND id=$2`, [
        ORG, confirmed.pinnedSourceSnapshotId,
      ]),
    );
    expect(snapshotRow.rows).toHaveLength(1);
    const frozen = snapshotRow.rows[0]!.quotes as { text: string }[];
    expect(frozen.map((q) => q.text).sort()).toEqual(
      ["用户说：审批流程太慢了。", "用户又说：希望能加个提醒。"].sort(),
    );
  });

  it("ai_analysis=false 的受访者：extractQuotes 仍返回原文，候选排除该人且留痕", async () => {
    await seedSubject("subj-i1628-declined", "human");
    await seedSegment("seg-i1628-b1", "拒绝 AI 分析的人说的原话。", "subj-i1628-declined");
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO interview_consent_submissions
           (id, org_id, interview_session_id, subject_id, record, transcript, ai_analysis, attribution)
         VALUES ($1,$2,$3,$4,true,true,false,true)`,
        ["consent-i1628-declined", ORG, INTERVIEW_ID, "subj-i1628-declined"],
      ),
    );

    const { extractDeps, generateDeps } = deps();
    const extracted = await extractQuotes(extractDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: ["seg-i1628-b1"], rqBinding: null,
    });
    // ⚠ 限制的是模型处理，不是人工判断——原文照样返回。
    expect(extracted.quotes[0]!.text).toBe("拒绝 AI 分析的人说的原话。");

    await bindContextPack("run-i1628-b", ["seg-i1628-b1"]);
    const generated = await generateCandidateInsights(generateDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null,
      contextPackId: "run-i1628-b",
    });
    // 唯一一条引述属于声明拒绝的受访者 ⇒ 全部候选被排除 ⇒ A2 退化，不是错误。
    expect(generated.degradedToQuotesOnly).toBe(true);
    expect(generated.candidates).toEqual([]);
    expect(generated.excludedSubjectIds).toContain("subj-i1628-declined");
  });

  it("E2：候选没有证据 ⇒ INSIGHT_NO_EVIDENCE（Context Pack 授权到的片段一条引述都没抽过）", async () => {
    await seedSegment("seg-i1628-c1", "从未 extractQuotes 过的片段。", null);
    await bindContextPack("run-i1628-c", ["seg-i1628-c1"]);
    const { generateDeps } = deps();
    await expect(
      generateCandidateInsights(generateDeps, {
        orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null,
        contextPackId: "run-i1628-c",
      }),
    ).rejects.toBeInstanceOf(InsightNoEvidenceError);
  });

  it("E1：归纳服务失败 ⇒ AI_GENERATION_UNAVAILABLE，事务性——已抽引述原样保留，不产半截洞察", async () => {
    await seedSubject("subj-i1628-e1", "human");
    await seedSegment("seg-i1628-e1", "用于验证事务性的引述。", "subj-i1628-e1");

    const { extractDeps } = deps();
    await extractQuotes(extractDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: ["seg-i1628-e1"], rqBinding: null,
    });
    const before = await quotes.listByInterviewAndSegments(ORG_ID, INTERVIEW_ID, ["seg-i1628-e1"]);
    expect(before).toHaveLength(1);
    const insightCountBefore = await asApp(ORG, (c) =>
      c.query(`SELECT count(*)::int AS n FROM interview_insights WHERE org_id=$1`, [ORG]),
    );

    await bindContextPack("run-i1628-e1", ["seg-i1628-e1"]);
    const failingGenerator: CandidateInsightGenerator = {
      generate: async () => { throw new Error("upstream model outage"); },
    };
    const { generateDeps } = deps(failingGenerator);
    await expect(
      generateCandidateInsights(generateDeps, {
        orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null,
        contextPackId: "run-i1628-e1",
      }),
    ).rejects.toBeInstanceOf(InsightGenerationUnavailableError);

    const after = await quotes.listByInterviewAndSegments(ORG_ID, INTERVIEW_ID, ["seg-i1628-e1"]);
    expect(after).toEqual(before);
    const insightCountAfter = await asApp(ORG, (c) =>
      c.query(`SELECT count(*)::int AS n FROM interview_insights WHERE org_id=$1`, [ORG]),
    );
    expect(insightCountAfter.rows[0]!.n).toBe(insightCountBefore.rows[0]!.n);
  });

  it("HTTP 契约形状：extractQuotes 的响应体经契约 schema 校验", async () => {
    await seedSubject("subj-i1628-shape", "human");
    await seedSegment("seg-i1628-shape", "形状校验用引述。", "subj-i1628-shape");
    const { extractDeps } = deps();
    const result = await extractQuotes(extractDeps, {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID,
      segmentIds: ["seg-i1628-shape"], rqBinding: "rq-1",
    });
    expect(() => C.operations.extractQuotes.out.parse(result)).not.toThrow();
  });
});
