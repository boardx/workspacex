/**
 * F02（phase-11，issue #1647）—— 观察者只拿到脱敏聚合投影：原始洞察库不可见（矩阵格子的
 * `quoteIds` 一律清空），聚合信号（`sessionCount`/`subjectCount`/`strength`/
 * `counterexample`）原样保留，沿用 `apps/web/components/project/tab-research.tsx`
 * 的观察者态注释规则（R5：整块内部过程不可见，脱敏聚合仍可见）。
 *
 * 同一份真实持久化数据，分别用 `facilitator`（非观察者）与 `observer` 两个项目角色
 * 各调一次 `getEvidenceMatrix`，断言两次响应的差异**只在** `quoteIds`。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { indexSegment } from "../support/retrieval-fixtures";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgSegmentReader } from "../../src/infrastructure/interview/pg-segment-reader";
import { PgInterviewQuoteRepository } from "../../src/infrastructure/interview/pg-interview-quote-repository";
import { PgInterviewInsightRepository } from "../../src/infrastructure/interview/pg-interview-insight-repository";
import { PgEvidenceMatrixReader } from "../../src/infrastructure/interview/pg-evidence-matrix-reader";
import { InMemoryInsightCandidateStore } from "../../src/infrastructure/interview/in-memory-insight-candidate-store";
import { HeuristicCandidateInsightGenerator } from "../../src/infrastructure/interview/heuristic-candidate-insight-generator";
import { UuidIdFactory } from "../../src/infrastructure/artifact/uuid-id-factory";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { extractQuotes } from "../../src/application/interview/extract-quotes";
import { generateCandidateInsights } from "../../src/application/interview/generate-candidate-insights";
import { confirmInsight } from "../../src/application/interview/confirm-insight";
import { getEvidenceMatrix } from "../../src/application/interview/get-evidence-matrix";
import type { InsightContextApi } from "../../src/application/interview/insight-ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1647-observer-redaction";
const ORG_ID = toOrgId(ORG);
const PROJECT_ID = "proj-i1647-redact";
const INTERVIEW_ID = "itv-i1647-redact";
const RESEARCHER = "u-i1647-redact-researcher";
const OBSERVER = "u-i1647-redact-observer";
const SUBJECT_ID = "subj-i1647-redact";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const insights = new PgInterviewInsightRepository(db);
const evidence = new PgEvidenceMatrixReader(db);
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

const contextItemsByRun = new Map<string, { segmentId: string; content: string }[]>();
const alwaysAuthorizedContext: InsightContextApi = {
  read: async ({ runId }) => ({ packId: `${runId}-pack`, runId, items: contextItemsByRun.get(runId) ?? [] }),
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();

  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG_ID, projectId: PROJECT_ID });
  await addOrgMember(ORG, RESEARCHER, "consultant", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, PROJECT_ID, RESEARCHER, "facilitator", null);
  // ⚠ 观察者：`project_role = 'observer'`——R5 唯一定义脱敏的那一档。
  await addProjectMember(ORG, PROJECT_ID, OBSERVER, "observer", null);

  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1, $2, $3, 'human', $4)`,
      [SUBJECT_ID, ORG, "受访者", RESEARCHER],
    ),
  );
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_sessions (id, org_id, project_id, source_kind, title, created_by)
       VALUES ($1,$2,$3,'human','观察者脱敏用例',$4)`,
      [INTERVIEW_ID, ORG, PROJECT_ID, RESEARCHER],
    ),
  );
  await indexSegment({
    orgId: ORG, segmentId: "seg-i1647-redact-1", artifactId: "art-i1647-redact-1",
    content: "受访者说：审批流程太慢了。", sourceType: "interview",
    speakerSubjectId: SUBJECT_ID, anchor: { kind: "timecode", locator: "00:00:01" },
  });

  const extracted = await extractQuotes(
    { scope, decisions, segments, quotes, ids },
    { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, segmentIds: ["seg-i1647-redact-1"], rqBinding: "rq-approval" },
  );
  expect(extracted.quotes).toHaveLength(1);

  const runId = "run-i1647-redact";
  contextItemsByRun.set(runId, [{ segmentId: "seg-i1647-redact-1", content: "受访者说：审批流程太慢了。" }]);
  const candidates = new InMemoryInsightCandidateStore();
  const generated = await generateCandidateInsights(
    {
      context: alwaysAuthorizedContext, quotes,
      consent: { listAiAnalysisDeclinedSubjects: async () => [] },
      generator: new HeuristicCandidateInsightGenerator(), candidates, ids,
    },
    { orgId: ORG_ID, actorId: RESEARCHER, interviewId: INTERVIEW_ID, themeScope: null, contextPackId: runId },
  );
  expect(generated.candidates).toHaveLength(1);
  await confirmInsight(
    { candidates, quotes, insights },
    { orgId: ORG_ID, actorId: RESEARCHER, candidateId: generated.candidates[0]!.insightId, edits: null },
  );
}, 180_000);

afterAll(async () => {
  await resetOrgs(ORG);
  await db.close();
});

describe("F02 证据矩阵读路径 —— 观察者脱敏只读投影", () => {
  it("非观察者（facilitator）看到完整的 quoteIds", async () => {
    const matrix = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: RESEARCHER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
    );
    expect(matrix.sessionCount).toBe(1);
    expect(matrix.subjectCount).toBe(1);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0]!.cells).toHaveLength(1);
    expect(matrix.rows[0]!.cells[0]!.quoteIds.length).toBeGreaterThan(0);
  });

  it("观察者（project_role=observer）：quoteIds 一律清空，聚合信号原样保留", async () => {
    const full = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: RESEARCHER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
    );
    const redacted = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: OBSERVER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
    );

    // 聚合信号不变——R5「脱敏聚合仍可见」。
    expect(redacted.sessionCount).toBe(full.sessionCount);
    expect(redacted.subjectCount).toBe(full.subjectCount);
    expect(redacted.rows.map((r) => r.themeId)).toEqual(full.rows.map((r) => r.themeId));
    expect(redacted.rows[0]!.cells.map((c) => ({ subjectId: c.subjectId, strength: c.strength, counterexample: c.counterexample }))).toEqual(
      full.rows[0]!.cells.map((c) => ({ subjectId: c.subjectId, strength: c.strength, counterexample: c.counterexample })),
    );

    // 原始证据（可回链到具体引述）——R5「原始洞察库不可见」在矩阵上的落点：一律清空。
    expect(full.rows[0]!.cells[0]!.quoteIds.length).toBeGreaterThan(0);
    for (const row of redacted.rows) {
      for (const cell of row.cells) {
        expect(cell.quoteIds).toEqual([]);
      }
    }
  });

  it("research/none 两档没有项目角色模型，本读端不脱敏（R5 已知缺口，见 scope.ts 文件头）", async () => {
    const matrix = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: OBSERVER, scope: { kind: "none", projectId: null, researchProjectId: null } },
    );
    // 该 org 下没有任何 kind:"none" 的访谈（本用例的一场访谈挂在 PROJECT_ID 上），
    // 断言的是这条路径本身不因为观察者身份而异常，而是走到合法的 A1 空态。
    expect(matrix).toEqual({ sessionCount: 0, subjectCount: 0, rows: [] });
  });
});
