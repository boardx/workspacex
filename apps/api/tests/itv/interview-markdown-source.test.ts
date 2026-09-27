import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { toOrgId } from "../../src/domain/org-id";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, asOwner, addOrgMember } from "../support/db";
import { migrateInterviewMarkdown, readInterviewMarkdownDocuments, appendInterviewMarkdownDocument } from "../../src/infrastructure/interview/interview-markdown-migration";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import { decideInterviewVisibility } from "../../src/domain/interview/visibility-decision";
import type { TenantSession } from "../../src/application/ports/database.port";
import { PgInterviewMarkdownReader } from "../../src/infrastructure/interview/pg-interview-markdown-reader";

const ORG = toOrgId("org-markdown-source-4382");
const OTHER = toOrgId("org-markdown-other-4382");
const ID = "itv-markdown-source-4382";
const REV = "rev-markdown-source-4382";
const RAW = "# 研究需求\r\n\r\n中文 🧪\r\n\r\n| 目标 | 值 |\r\n| --- | --- |\r\n| 原文 | `a_b` |\r\n";
let db: PgDatabase;
async function readDocuments(session: TenantSession) {
  const result = await readInterviewMarkdownDocuments(session, ORG, ID, REV);
  const decision = decideInterviewVisibility({
    decisionId: "decision-md-test-4382", orgRole: "consultant", viewerTeamId: null,
    interview: { projectId: null, createdBy: `${ORG}-owner`, isExplicitCollaborator: false },
    viewer: { userId: `${ORG}-owner`, projectIds: [] },
  });
  const disclosed = discloseDecided(result.documents, decision);
  if (!isDisclosed(disclosed)) throw new Error("fixture owner denied");
  return disclosed.payload;
}
beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); }, 120000);
afterAll(async () => { await resetOrgs(ORG, OTHER); await db?.close(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: "project-md-4382" });
  await seedOrg({ orgId: OTHER, projectId: "project-md-other-4382" });
  await new PgDigitalInterviewRepository(db).createDraft({
    orgId: ORG, actorId: `${ORG}-owner`, interviewId: ID,
    scope: { kind: "none", projectId: null, researchProjectId: null },
    name: "Markdown 单源", tags: [], topic: RAW,
  });
  await db.withTenant(ORG, async (session) => {
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)`, [ORG, REV, ID, `${ORG}-owner`]);
    await session.query(`INSERT INTO digital_interview_skill_threads(org_id,id,interview_id,created_by) VALUES($1,'thread-md-4382',$2,$3)`, [ORG, ID, `${ORG}-owner`]);
  });
});

describe("Markdown source persistence", () => {
  it("does not freeze running evidence and archives it after completion", async () => {
    await db.withTenant(ORG, async (session) => {
      await session.query(`INSERT INTO digital_interview_expert_runs
        (org_id,interview_id,revision_id,expert_id,display_name,ordinal,status,total_questions,answers)
        VALUES ($1,$2,$3,'expert-md','专家',1,'running',1,'[]')`, [ORG, ID, REV]);
      await migrateInterviewMarkdown(session, ORG, ID);
      expect((await readDocuments(session)).some((doc) => doc.step === "runs")).toBe(false);
      await session.query(`UPDATE digital_interview_expert_runs SET status='completed', answers=$4 WHERE org_id=$1 AND interview_id=$2 AND revision_id=$3`,
        [ORG, ID, REV, JSON.stringify([{ questionId: "q-md", question: "最近一次？", answer: "完整保存的回答" }])]);
      await migrateInterviewMarkdown(session, ORG, ID);
      expect((await readDocuments(session)).find((doc) => doc.step === "runs")?.markdown).toContain("完整保存的回答");
    });
  });
  it("explicit initialization hydrates legacy Markdown once and rejects a stale baseline", async () => {
    await addOrgMember(ORG, `${ORG}-owner`, "consultant", null);
    const reader = new PgInterviewMarkdownReader(db);
    const version = (await reader.readCurrent(ORG, ID))!.version;
    await reader.initialize({ orgId: ORG, interviewId: ID, actorId: `${ORG}-owner`, expectedVersion: version });
    const hydrated = (await reader.readCurrent(ORG, ID))!;
    expect(hydrated.version).toBe(version + 1);
    await db.withTenant(ORG, async (session) => expect((await readDocuments(session)).find((doc) => doc.step === "intake")?.markdown).toBe(RAW));
    await reader.initialize({ orgId: ORG, interviewId: ID, actorId: `${ORG}-owner`, expectedVersion: hydrated.version });
    expect((await reader.readCurrent(ORG, ID))!.version).toBe(hydrated.version);
    await expect(reader.initialize({ orgId: ORG, interviewId: ID, actorId: `${ORG}-owner`, expectedVersion: version })).rejects.toThrow("CONCURRENT_MODIFICATION");
    await expect(reader.initialize({ orgId: ORG, interviewId: ID, actorId: `${OTHER}-owner`, expectedVersion: hydrated.version })).rejects.toThrow();
  });
  it("migration separates original intake from detailed analysis and preserves thin projections", async () => {
    await db.withTenant(ORG, async (session) => {
      const brief = { decision: "决定试点学校", learningGoals: [{ goalId: "g1", statement: "了解教师工作负担" }], targetRoles: ["乡村教师"], outOfScope: ["不比较考试分数"], successCriteria: ["形成可验证的试点标准"] };
      await session.query(`INSERT INTO digital_interview_research_briefs(org_id,id,interview_id,revision_id,brief,rule_version,request_id,created_by) VALUES($1,'brief-md-4382',$2,$3,$4,'v1','request-md-4382',$5)`, [ORG, ID, REV, brief, `${ORG}-owner`]);
      await session.query(`INSERT INTO digital_interview_artifact_versions(org_id,artifact_id,interview_id,revision_id,step,version_number,title,markdown,status,evidence_mode) VALUES($1,'thin-intake-4382',$2,$3,'intake',1,'需求','# 简略需求','confirmed','simulated')`, [ORG, ID, REV]);
      await migrateInterviewMarkdown(session, ORG, ID);
      const docs = await readDocuments(session);
      const intake = docs.find((doc) => doc.step === "intake")!.markdown;
      const analysis = docs.find((doc) => doc.step === "analysis")?.markdown;
      expect(analysis).toContain("乡村教师");
      expect(analysis).toContain("形成可验证的试点标准");
      expect(intake).toContain("# 简略需求");
      expect(intake).toContain(RAW);
      expect(intake).not.toContain("乡村教师");
    });
  });
  it("migrationIsIdempotent and preserves original Markdown bytes", async () => {
    await db.withTenant(ORG, async (session) => {
      await migrateInterviewMarkdown(session, ORG, ID);
      await migrateInterviewMarkdown(session, ORG, ID);
      const docs = await readDocuments(session);
      const intake = docs.find((doc) => doc.step === "intake")!;
      expect(intake.markdown).toBe(RAW);
      expect(intake.contentHash).toBe(createHash("sha256").update(RAW).digest("hex"));
      const count = await session.query<{ count: string }>(`SELECT count(*)::text AS count FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='intake'`, [ORG, ID]);
      expect(count.rows[0]?.count).toBe("1");
    });
  });
  it("migration retains unconfirmed question candidates as a draft", async () => {
    await db.withTenant(ORG, async (session) => {
      await session.query(`INSERT INTO digital_interview_question_candidates(org_id,revision_id,question_id,expert_id,ordinal,body,purpose) VALUES($1,$2,'q-md-4382','expert-md-4382',1,'请描述最近一次备课经历','了解真实工作流程')`, [ORG, REV]);
      await migrateInterviewMarkdown(session, ORG, ID);
      const outline = (await readDocuments(session)).find((doc) => doc.step === "outline");
      expect(outline?.markdown).toContain("请描述最近一次备课经历");
      expect(outline?.markdown).toContain("了解真实工作流程");
      const result = await session.query<{ status: string }>(`SELECT status FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='outline' ORDER BY version_number DESC LIMIT 1`, [ORG, ID]);
      expect(result.rows[0]?.status).toBe("draft");
    });
  });
  it("markdownIsAuthoritativeAfterMigration", async () => {
    await db.withTenant(ORG, async (session) => {
      await migrateInterviewMarkdown(session, ORG, ID);
      await session.query(`UPDATE interview_sessions SET topic='旧字段修改' WHERE org_id=$1 AND id=$2`, [ORG, ID]);
      await migrateInterviewMarkdown(session, ORG, ID);
      expect((await readDocuments(session)).find((doc) => doc.step === "intake")?.markdown).toBe(RAW);
    });
  });
  it("tenantCannotReadOtherTenantDocument", async () => {
    await db.withTenant(ORG, (session) => migrateInterviewMarkdown(session, ORG, ID));
    const docs = await db.withTenant(OTHER, (session) => readInterviewMarkdownDocuments(session, ORG, ID, REV));
    expect(docs.versions).toEqual([]);
  });
  it("migration retains partial failure rather than promoting it to confirmed", async () => {
    await db.withTenant(ORG, async (session) => {
      await session.query(`INSERT INTO digital_interview_artifact_versions(org_id,artifact_id,interview_id,revision_id,step,version_number,title,markdown,status,failure,evidence_mode)
        VALUES($1,'partial-report-4382',$2,$3,'report',1,'部分报告','# 已保存片段','failed','{"code":"AI_GENERATION_UNAVAILABLE","retryable":true}','simulated')`, [ORG, ID, REV]);
      await migrateInterviewMarkdown(session, ORG, ID);
      const result = await session.query<{ status: string; failure: unknown }>(`SELECT status,failure FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='report' ORDER BY version_number DESC LIMIT 1`, [ORG, ID]);
      expect(result.rows[0]).toEqual({ status: "failed", failure: { code: "AI_GENERATION_UNAVAILABLE", retryable: true } });
    });
  });
  it("repository rejects a corrupted marked source document", async () => {
    await db.withTenant(ORG, (session) => migrateInterviewMarkdown(session, ORG, ID));
    // Simulate offline corruption, not an app-role update which is denied separately.
    await asOwner((session) => session.query(`UPDATE digital_interview_artifact_versions SET markdown='篡改' WHERE org_id=$1 AND interview_id=$2`, [ORG, ID]));
    await expect(new PgDigitalInterviewRepository(db).loadWorkflow(ORG, ID)).rejects.toThrow("MARKDOWN_CONTENT_INTEGRITY_FAILED");
  });
  it("confirmedVersionIsImmutable and stale append cannot overwrite", async () => {
    await db.withTenant(ORG, (session) => migrateInterviewMarkdown(session, ORG, ID));
    await expect(db.withTenant(ORG, (session) => session.query(`UPDATE digital_interview_artifact_versions SET markdown='overwrite' WHERE org_id=$1 AND interview_id=$2`, [ORG, ID]))).rejects.toThrow();
    await db.withTenant(ORG, async (session) => {
      const doc = await appendInterviewMarkdownDocument(session, { orgId: ORG, interviewId: ID, revisionId: REV, step: "intake", title: "新需求", markdown: "# 新需求", evidenceMode: "simulated", references: [], expectedVersion: 1 });
      expect(doc.version).toBe(2);
    });
    await expect(db.withTenant(ORG, (session) => appendInterviewMarkdownDocument(session, { orgId: ORG, interviewId: ID, revisionId: REV, step: "intake", title: "过期", markdown: "过期覆盖", evidenceMode: "simulated", references: [], expectedVersion: 1 }))).rejects.toThrow("MARKDOWN_VERSION_CONFLICT");
  });
});
