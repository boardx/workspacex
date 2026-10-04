import { buildReportEvidenceIndex } from "../../src/application/interview/workflow/interview-report-grounding";
import { readInterviewMarkdown } from "../../src/application/interview/read-interview-markdown";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgInterviewMarkdownReader } from "../../src/infrastructure/interview/pg-interview-markdown-reader";
import { PgInterviewMarkdownExecutionStore } from "../../src/infrastructure/interview/pg-interview-markdown-execution-store";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgInterviewMarkdownReportReviewRepository } from "../../src/infrastructure/interview/pg-interview-markdown-report-review-repository";
import { appendInterviewMarkdownDocument, interviewMarkdownContentHash } from "../../src/infrastructure/interview/interview-markdown-store";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { generateInterviewMarkdown } from "../../src/application/interview/generate-interview-markdown";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

// Synthetic opposing personas and sparse answers are fixtures, never participant evidence.
// PostgreSQL is real and isolated; the model port is a controlled double, not an external LLM.
const ORG = toOrgId("org-report-recovery-5104"), ID = "itv-report-recovery-5104", REV = "rev-report-recovery-5104";
const actorId = `${ORG}-owner`, input = { orgId: ORG, interviewId: ID, actorId };
const invalid = "# 原始合成报告\r\n\r\n教师支持试点；校长反对。🧪 保留字节与意见，不含完整分析链。\r\n";
const validTemplate = "# 完整重写的合成报告\n\n证据：[支持低成本试点（合成）](#answer-1)；[相反意见：成本过高（合成）](#answer-2)。\n\n跨回答综合：教师支持试点，校长相反意见强调成本，不能凭两段合成回答判定有效。\n决策影响：应优先验证低成本方案再决定投入。\n边界与反例：仅为虚拟角色模拟，证据不足，不代表真人意见。\n下一步验证建议：独立访谈五位真实教师，测量备课任务完成时长并记录反对证据。\n";
let db: PgDatabase, reader: PgInterviewMarkdownReader, store: PgInterviewMarkdownExecutionStore;
async function snapshot() { return (await reader.readCurrent(ORG, ID))!; }
async function rows() {
  return db.withTenant(ORG, async s => (await s.query<{ markdown: string; content_hash: string; status: string; evidence_mode: string; controlled_references: unknown; version_number: number; artifact_id: string }>(
    `SELECT markdown,content_hash,status,evidence_mode,controlled_references,version_number,artifact_id FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='report' ORDER BY version_number`, [ORG, ID])).rows);
}
function dependencies(complete: (request: { user: string; system: string }) => Promise<{ text: string }>) {
  return { repo: new PgDigitalInterviewRepository(db), scope: new PgInterviewScopeRepository(db), decisions: new UuidDecisionIdFactory(), reader, modelProvider: "controlled-test", modelId: "controlled-test", model: { complete } };
}
async function generate(complete: (request: { user: string; system: string }) => Promise<{ text: string }>) {
  const current = await snapshot();
  return generateInterviewMarkdown(dependencies(complete), { orgId: ORG, viewerUserId: actorId, interviewId: ID, step: "report", expectedVersion: current.version, expectedDocumentVersion: 0 });
}
async function groundedReport(markdown: string) {
  const source = await readInterviewMarkdown({ ...dependencies(async () => ({ text: "unused" })) }, { orgId: ORG, viewerUserId: actorId, interviewId: ID });
  const runs = source.documents.find(document => document.step === "runs")!;
  const index = buildReportEvidenceIndex(runs);
  return markdown.replace(/\[([^\]]+)\]\(#answer-\d+\)/g, (_match, quote: string) => {
    const entry = index.find(item => item.quote === quote && item.expertId && item.taskKey);
    expect(entry, "fixture quote must bind to a trusted saved answer").toBeDefined();
    return `[${quote}](#${entry!.anchor})`;
  });
}
beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); reader = new PgInterviewMarkdownReader(db); store = new PgInterviewMarkdownExecutionStore(db); }, 120000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await resetOrgs(ORG); await db?.close(); });
async function seedCompletedStudy(singleExpert = false) {
  await resetOrgs(ORG); await seedOrg({ orgId: ORG, projectId: "project-report-recovery-5104" });
  await addOrgMember(ORG, actorId, "consultant", null);
  await new PgDigitalInterviewRepository(db).createDraft({ ...input, scope: { kind: "none", projectId: null, researchProjectId: null }, name: "合成报告恢复", tags: [], topic: "证据不足的相反意见" });
  await db.withTenant(ORG, async s => {
    await s.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)`, [ORG, REV, ID, actorId]);
    for (const [step, markdown] of [["intake", "# 合成需求"], ["analysis", "# 合成分析：证据不足"], ["experts", "## [教师](#expert-teacher)\n合成支持角色\n\n## [校长](#expert-principal)\n合成反对角色"], ["outline", "## [教师](#expert-teacher)\n最近的支持案例？\n\n## [校长](#expert-principal)\n反对理由？"]] as const) {
      await appendInterviewMarkdownDocument(s, { orgId: ORG, interviewId: ID, revisionId: REV, step, markdown: singleExpert && (step === "experts" || step === "outline") ? markdown.split("\n\n## [校长]")[0]! : markdown, title: step, evidenceMode: "simulated", references: [], expectedVersion: 0 });
    }
  });
  await store.control({ ...input, expectedVersion: (await snapshot()).version, action: "start" });
  const claim = (await store.claim(input))!;
  await store.finish({ ...input, claimId: claim.claimId, results: claim.tasks.map(task => ({ expertId: task.expertId, markdown: task.expertId === "teacher" ? (singleExpert ? "问题一回答：支持低成本试点（合成）。\n问题二回答：备课时间增加时反对继续（合成）。" : "支持低成本试点（合成）") : "相反意见：成本过高（合成）", failed: false })) });
  expect((await snapshot()).execution?.status).toBe("completed");
}
beforeEach(() => seedCompletedStudy());

describe("#5104 real DB report quality recovery", () => {
  it("preserves rejected v1 bytes/hash/references then saves full rewritten v2 without concatenation, one increment per save", async () => {
    const before = await snapshot(); const savedVersions: number[] = [];
    const save = reader.saveDraft.bind(reader);
    vi.spyOn(reader, "saveDraft").mockImplementation(async value => { await save(value); savedVersions.push((await snapshot()).version); });
    const valid = await groundedReport(validTemplate);
    const complete = vi.fn(async (): Promise<{ text: string }> => ({ text: complete.mock.calls.length === 1 ? invalid : valid }));
    const result = await generate(complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(savedVersions).toEqual([before.version + 1, before.version + 2]);
    expect(result.version).toBe(before.version + 2);
    const documents = await rows(); expect(documents).toHaveLength(2);
    const sources = await db.withTenant(ORG, async s => (await s.query<{ artifact_id: string; version_number: number }>(`SELECT DISTINCT ON (step) artifact_id,version_number FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step<>'report' ORDER BY step,version_number DESC`, [ORG, ID])).rows);
    const references = sources.map((d, index) => ({ anchor: `source-${index + 1}`, documentId: d.artifact_id, version: d.version_number }));
    expect(documents[0]).toMatchObject({ markdown: invalid, content_hash: interviewMarkdownContentHash(invalid), status: "failed", evidence_mode: "simulated", controlled_references: references, version_number: 1 });
    expect(documents[1]).toMatchObject({ markdown: valid, content_hash: interviewMarkdownContentHash(valid), status: "draft", evidence_mode: "simulated", version_number: 2 });
    expect(documents[1]!.controlled_references).toEqual(expect.arrayContaining(references));
    expect((documents[1]!.controlled_references as Array<{locator?:unknown}>).filter(r=>r.locator)).toHaveLength(2);
    expect(documents[1]!.markdown).not.toContain(invalid);
  });
  it("bounds a still-invalid rewrite at two calls and retains both failed documents without granting approval", async () => {
    const before = await snapshot(); const second = invalid.replace("原始", "第二次");
    const complete = vi.fn(async (): Promise<{ text: string }> => ({ text: complete.mock.calls.length === 1 ? invalid : second }));
    await expect(generate(complete)).rejects.toThrow("AI_GENERATION_UNAVAILABLE");
    expect(complete).toHaveBeenCalledTimes(2);
    const documents = await rows(); expect(documents.map(d => d.markdown)).toEqual([invalid, second]);
    expect(documents.every(d => d.status === "failed" && d.evidence_mode === "simulated" && d.content_hash === interviewMarkdownContentHash(d.markdown))).toBe(true);
    const current = await snapshot(); expect(current.version).toBe(before.version + 2);
    const latest = documents[1]!;
    await expect(new PgInterviewMarkdownReportReviewRepository(db).submit({ ...input, revisionId: REV, documentId: latest.artifact_id, documentVersion: 2, contentHash: latest.content_hash, status: "approved", note: null, expectedVersion: current.version, requestId: "approval-failed-report" })).rejects.toThrow("REPORT_REVIEW_BLOCKED");
    expect((await snapshot()).version).toBe(current.version);
  });
  it("uses one call and one draft save for an already-qualified report", async () => {
    const valid = await groundedReport(validTemplate);
    const before = await snapshot(); const complete = vi.fn(async () => ({ text: valid }));
    const result = await generate(complete); expect(complete).toHaveBeenCalledTimes(1);
    expect(result.version).toBe(before.version + 1);
    expect(await rows()).toMatchObject([{ markdown: valid, status: "draft", evidence_mode: "simulated" }]);
  });
  it("recovers a single expert synthetic study without inventing agreement or participant evidence", async () => {
    await seedCompletedStudy(true);
    expect((await snapshot()).execution?.tasks).toHaveLength(1);
    const single = await groundedReport(validTemplate.replace("证据：[支持低成本试点（合成）](#answer-1)；[相反意见：成本过高（合成）](#answer-2)。", "证据：[问题一回答：支持低成本试点（合成）。](#answer-1)；[问题二回答：备课时间增加时反对继续（合成）。](#answer-2)。").replace("跨回答综合：教师支持试点，校长相反意见强调成本，不能凭两段合成回答判定有效。", "跨回答综合：同一合成专家两段回答共同指向时间成本约束，支持低成本试点但反对增加备课时间；不能推断多专家共识，证据不足。"));
    const singleInvalid = "# 单专家合成纪要\r\n问题一支持试点，问题二反对增加备课时间；无完整分析链。\r\n";
    const complete = vi.fn(async (): Promise<{ text: string }> => ({ text: complete.mock.calls.length === 1 ? singleInvalid : single }));
    const result = await generate(complete);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(await rows()).toMatchObject([{ markdown: singleInvalid, status: "failed", evidence_mode: "simulated" }, { markdown: single, status: "draft", evidence_mode: "simulated" }]);
    expect(result.execution?.tasks).toHaveLength(1);
  });
  it.each(["source_change", "permission_revocation"] as const)("rechecks %s after preserving failure and before calling the second model", async scenario => {
    const before = await snapshot(); const save = reader.saveDraft.bind(reader); let saved = false;
    vi.spyOn(reader, "saveDraft").mockImplementation(async value => {
      await save(value);
      if (saved || !value.failure) return; saved = true;
      await db.withTenant(ORG, async s => {
        if (scenario === "source_change") await s.query(`UPDATE interview_sessions SET version=version+1 WHERE org_id=$1 AND id=$2`, [ORG, ID]);
        else await s.query(`DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2`, [ORG, actorId]);
      });
    });
    const complete = vi.fn(async () => ({ text: invalid }));
    await expect(generate(complete)).rejects.toThrow(scenario === "source_change" ? "CONCURRENT_MODIFICATION" : /NO_INTERVIEW_ACCESS|PERMISSION_REVOKED_MIDWAY/u);
    expect(saved).toBe(true); expect(complete).toHaveBeenCalledTimes(1);
    expect(await rows()).toMatchObject([{ markdown: invalid, status: "failed", evidence_mode: "simulated" }]);
    expect((await snapshot()).version).toBe(before.version + (scenario === "source_change" ? 2 : 1));
  });
});

describe("#5289 saved canonical report recovery", () => {
 it("recovers numbered saved failure with identical bytes/hash, no model, and no duplicate version", async () => {
  const markdown = await groundedReport(validTemplate.replace("下一步验证建议：独立访谈五位真实教师，测量备课任务完成时长并记录反对证据。", "## 6. 下一步验证建议（可执行行动）\n\n独立访谈五位用户，对比任务完成时长。"));
  const before = await readInterviewMarkdown(dependencies(async () => ({text:"unused"})),{...input,viewerUserId:actorId});
  const references = before.documents.filter(document => document.step !== "report").map((document,index) => ({anchor:`source-${index+1}`,documentId:document.documentId,version:document.version}));
  await reader.saveDraft({...input,step:"report",expectedVersion:before.version,expectedDocumentVersion:0,markdown,references,failure:{code:"AI_GENERATION_UNAVAILABLE",retryable:true}});
  const failed = await snapshot(); const complete = vi.fn(async () => ({text:"must never run"}));
  const request = {...input,viewerUserId:actorId,step:"report" as const,expectedVersion:failed.version,expectedDocumentVersion:1};
  const started = performance.now();
  const recovered = await generateInterviewMarkdown({...dependencies(complete),modelProvider:"",modelId:""},request);
  expect(complete).not.toHaveBeenCalled();
  expect(await rows()).toMatchObject([{markdown,content_hash:interviewMarkdownContentHash(markdown),status:"failed",version_number:1},{markdown,content_hash:interviewMarkdownContentHash(markdown),status:"draft",version_number:2}]);
  await generateInterviewMarkdown(dependencies(complete),{...request,expectedVersion:recovered.version,expectedDocumentVersion:2});
  expect(await rows()).toHaveLength(2); expect(complete).not.toHaveBeenCalled();
  console.info("#5289 synthetic recovery",{durationMs:Math.round(performance.now()-started),hash:interviewMarkdownContentHash(markdown),modelCalls:complete.mock.calls.length});
 });
 it("persists the specific action-only reason and keeps the rejected report unapproved", async () => {
  const markdown = await groundedReport(validTemplate.replace("下一步验证建议：独立访谈五位真实教师，测量备课任务完成时长并记录反对证据。","").replace("决策影响：应优先验证低成本方案再决定投入。","决策影响：暂缓投入，因为证据不足。"));
  const complete = vi.fn(async () => ({text:markdown}));
  await expect(generate(complete)).rejects.toMatchObject({code:"AI_GENERATION_UNAVAILABLE",reasonCode:"REPORT_ACTION_VALIDATION_REJECTED"});
  const current = await readInterviewMarkdown(dependencies(complete),{...input,viewerUserId:actorId});
  expect(current.states.find(state => current.documents.find(document => document.step === "report")?.documentId === state.documentId)?.failure?.code).toBe("REPORT_ACTION_VALIDATION_REJECTED");
  expect((await rows()).every(row=>row.status === "failed")).toBe(true);
 });
});

describe("#5289 recovery CAS", () => {
 it("rejects source/project changes during recovery storage without creating a success version", async () => {
  const markdown = await groundedReport(validTemplate);
  const before = await readInterviewMarkdown(dependencies(async () => ({text:"unused"})),{...input,viewerUserId:actorId});
  const references = before.documents.map((document,index)=>({anchor:`source-${index+1}`,documentId:document.documentId,version:document.version}));
  await reader.saveDraft({...input,step:"report",expectedVersion:before.version,expectedDocumentVersion:0,markdown,references,failure:{code:"REPORT_ACTION_VALIDATION_REJECTED",retryable:true}});
  const failed = await snapshot(); const complete = vi.fn(async () => ({text:"must never run"}));
  const save = reader.saveDraft.bind(reader);
  vi.spyOn(reader,"saveDraft").mockImplementation(async value => {
    await db.withTenant(ORG,async session => {await session.query(`UPDATE interview_sessions SET version=version+1 WHERE org_id=$1 AND id=$2`,[ORG,ID]);});
    return save(value);
  });
  await expect(generateInterviewMarkdown(dependencies(complete),{...input,viewerUserId:actorId,step:"report",expectedVersion:failed.version,expectedDocumentVersion:1})).rejects.toThrow("CONCURRENT_MODIFICATION");
  expect(complete).not.toHaveBeenCalled(); expect(await rows()).toMatchObject([{markdown,status:"failed",version_number:1}]);
  expect(await rows()).toHaveLength(1);
 });
});
