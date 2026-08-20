/**
 * F02（phase-11，issue #1647）—— `getEvidenceMatrix` 读路径真正投影真实 Postgres 数据，
 * 且 `sessionCount`/`subjectCount` 两个数在样本不对齐场景下都正确。
 *
 * ## 走的是真实的用例 → 真实的仓储 → 真实的 Postgres
 *
 * 走 F01 已合入 main 的写路径（`extractQuotes` → `generateCandidateInsights` →
 * `confirmInsight`）真正落 `interview_insights` + `interview_insight_source_snapshots`，
 * 再用 F02 的 `getEvidenceMatrix` 把它们投影回矩阵——不构造假仓储、不绕开真实的
 * `interview_sessions`/`project_memberships` 可见性判定。
 *
 * ## 覆盖的验收线索
 *
 * V6：`sessionCount` 与 `subjectCount` 两个数不相等时都正确——两个场景各覆盖一个方向：
 *   ① 同一位受访者被分两场访谈各问一次 ⇒ sessionCount(2) > subjectCount(1)。
 *   ② 一场群访里出现两位不同受访者 ⇒ sessionCount(1) < subjectCount(2)。
 * A1：无引述时矩阵显示真实空态（未确认任何洞察的场景，见第三个 it）。
 * NO_INTERVIEW_ACCESS：非组织成员调用整个 scope 被拒。
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
import { NoInterviewAccessError } from "../../src/application/interview/errors";
import type { InsightContextApi } from "../../src/application/interview/insight-ports";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i1647-evidence-matrix";
const ORG_ID = toOrgId(ORG);
const PROJECT_ID = "proj-i1647";
const RESEARCHER = "u-i1647-researcher";
const OUTSIDER = "u-i1647-outsider";

const db = new PgDatabase(appConfig());
const scope = new PgInterviewScopeRepository(db);
const segments = new PgSegmentReader(db);
const quotes = new PgInterviewQuoteRepository(db);
const insights = new PgInterviewInsightRepository(db);
const evidence = new PgEvidenceMatrixReader(db);
const ids = new UuidIdFactory();
const decisions = new UuidDecisionIdFactory();

/** 一个总在这里说「已授权、能取材」的假 Context API——本文件不测 Context Pack 本身。 */
const alwaysAuthorizedContext: InsightContextApi = {
  read: async ({ runId }) => ({
    packId: `${runId}-pack`,
    runId,
    items: contextItemsByRun.get(runId) ?? [],
  }),
};
const contextItemsByRun = new Map<string, { segmentId: string; content: string }[]>();

async function seedSubject(subjectId: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_subjects (id, org_id, display_name, source_kind, created_by)
       VALUES ($1, $2, $3, 'human', $4)`,
      [subjectId, ORG, `受访者 ${subjectId}`, RESEARCHER],
    ),
  );
}

async function seedInterview(interviewId: string, title: string): Promise<void> {
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO interview_sessions (id, org_id, project_id, source_kind, title, created_by)
       VALUES ($1,$2,$3,'human',$4,$5)`,
      [interviewId, ORG, PROJECT_ID, title, RESEARCHER],
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

/** 抽引述 → 归纳候选（走确定性启发式）→ 确认入库，一路真实落库。返回确认后的 insightId。 */
async function extractAndConfirm(input: {
  interviewId: string;
  segmentId: string;
  content: string;
  subjectId: string | null;
  rqBinding: string | null;
}): Promise<string> {
  const extracted = await extractQuotes(
    { scope, decisions, segments, quotes, ids },
    {
      orgId: ORG_ID, actorId: RESEARCHER, interviewId: input.interviewId,
      segmentIds: [input.segmentId], rqBinding: input.rqBinding,
    },
  );
  expect(extracted.quotes).toHaveLength(1);

  const runId = `run-${input.segmentId}`;
  contextItemsByRun.set(runId, [{ segmentId: input.segmentId, content: input.content }]);
  const candidates = new InMemoryInsightCandidateStore();
  const generated = await generateCandidateInsights(
    {
      context: alwaysAuthorizedContext, quotes,
      consent: { listAiAnalysisDeclinedSubjects: async () => [] },
      generator: new HeuristicCandidateInsightGenerator(), candidates, ids,
    },
    { orgId: ORG_ID, actorId: RESEARCHER, interviewId: input.interviewId, themeScope: null, contextPackId: runId },
  );
  expect(generated.candidates).toHaveLength(1);

  const confirmed = await confirmInsight(
    { candidates, quotes, insights },
    { orgId: ORG_ID, actorId: RESEARCHER, candidateId: generated.candidates[0]!.insightId, edits: null },
  );
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

describe("F02 证据矩阵读路径 —— sessionCount/subjectCount 样本不对齐场景", () => {
  beforeAll(async () => {
    await resetOrgs(ORG);
    await seedOrg({ orgId: ORG_ID, projectId: PROJECT_ID });
    await addOrgMember(ORG, RESEARCHER, "consultant", null);
    await addProjectMember(ORG, PROJECT_ID, RESEARCHER, "facilitator", null);
  });

  it("① 同一受访者被分两场访谈各问一次 ⇒ sessionCount(2) > subjectCount(1)", async () => {
    await seedSubject("subj-i1647-repeat");
    await seedInterview("itv-i1647-a", "第一场");
    await seedInterview("itv-i1647-b", "第二场（同一人）");
    await seedSegment("seg-i1647-a1", "第一场里这个人说：流程太慢。", "subj-i1647-repeat");
    await seedSegment("seg-i1647-b1", "第二场里同一个人说：还是慢。", "subj-i1647-repeat");

    await extractAndConfirm({
      interviewId: "itv-i1647-a", segmentId: "seg-i1647-a1",
      content: "第一场里这个人说：流程太慢。", subjectId: "subj-i1647-repeat", rqBinding: "rq-flow",
    });
    await extractAndConfirm({
      interviewId: "itv-i1647-b", segmentId: "seg-i1647-b1",
      content: "第二场里同一个人说：还是慢。", subjectId: "subj-i1647-repeat", rqBinding: "rq-flow",
    });

    const matrix = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: RESEARCHER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
    );

    expect(matrix.sessionCount).toBe(2);
    expect(matrix.subjectCount).toBe(1);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0]!.themeId).toBe("rq-flow");
    expect(matrix.rows[0]!.cells).toHaveLength(1);
    expect(matrix.rows[0]!.cells[0]!.subjectId).toBe("subj-i1647-repeat");
    expect(matrix.rows[0]!.cells[0]!.quoteIds).toHaveLength(2);
  });

  it("② 一场群访里出现两位不同受访者 ⇒ sessionCount(1) < subjectCount(2)", async () => {
    await seedSubject("subj-i1647-group-x");
    await seedSubject("subj-i1647-group-y");
    await seedInterview("itv-i1647-group", "群访");
    await seedSegment("seg-i1647-gx", "X 说：预算不够。", "subj-i1647-group-x");
    await seedSegment("seg-i1647-gy", "Y 说：也不够。", "subj-i1647-group-y");

    await extractAndConfirm({
      interviewId: "itv-i1647-group", segmentId: "seg-i1647-gx",
      content: "X 说：预算不够。", subjectId: "subj-i1647-group-x", rqBinding: "rq-budget",
    });
    await extractAndConfirm({
      interviewId: "itv-i1647-group", segmentId: "seg-i1647-gy",
      content: "Y 说：也不够。", subjectId: "subj-i1647-group-y", rqBinding: "rq-budget",
    });

    const matrix = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: RESEARCHER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
    );

    // 累加自 ①：sessionCount 现在覆盖 itv-i1647-a/b/group 三场，subjectCount 覆盖三位受访者。
    expect(matrix.sessionCount).toBe(3);
    expect(matrix.subjectCount).toBe(3);
    const budgetRow = matrix.rows.find((r) => r.themeId === "rq-budget");
    expect(budgetRow).toBeDefined();
    expect(budgetRow!.cells.map((c) => c.subjectId).sort()).toEqual([
      "subj-i1647-group-x", "subj-i1647-group-y",
    ]);
  });

  it("A1：这个 scope 里还没有任何已确认洞察 ⇒ 真实空态，不编造示例数据", async () => {
    const emptyProject = "proj-i1647-empty";
    await asApp(ORG, (c) =>
      c.query(`INSERT INTO projects (id, org_id, name, kind) VALUES ($1,$2,$3,'workshop')`, [
        emptyProject, ORG, "空项目",
      ]),
    );
    await asApp(ORG, (c) =>
      c.query(`INSERT INTO workshops (id, org_id) VALUES ($1,$2)`, [emptyProject, ORG]),
    );
    await addProjectMember(ORG, emptyProject, RESEARCHER, "facilitator", null);

    const matrix = await getEvidenceMatrix(
      { scope, decisions, evidence, projectRole: evidence },
      { orgId: ORG_ID, viewerUserId: RESEARCHER, scope: { kind: "project", projectId: emptyProject, researchProjectId: null } },
    );

    expect(matrix).toEqual({ sessionCount: 0, subjectCount: 0, rows: [] });
  });

  it("NO_INTERVIEW_ACCESS：非组织成员调用整个 scope 被拒", async () => {
    await expect(
      getEvidenceMatrix(
        { scope, decisions, evidence, projectRole: evidence },
        { orgId: ORG_ID, viewerUserId: OUTSIDER, scope: { kind: "project", projectId: PROJECT_ID, researchProjectId: null } },
      ),
    ).rejects.toBeInstanceOf(NoInterviewAccessError);
  });
});
