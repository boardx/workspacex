import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgInterviewMarkdownReader } from "../../src/infrastructure/interview/pg-interview-markdown-reader";
import { PgInterviewMarkdownExecutionStore } from "../../src/infrastructure/interview/pg-interview-markdown-execution-store";
import { appendInterviewMarkdownDocument } from "../../src/infrastructure/interview/interview-markdown-store";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { executeInterviewMarkdown } from "../../src/application/interview/execute-interview-markdown";
import { generateInterviewMarkdown } from "../../src/application/interview/generate-interview-markdown";
import { listDigitalInterviews } from "../../src/application/interview/list-digital-interviews";
import { toOrgId } from "../../src/domain/org-id";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg, addOrgMember } from "../support/db";
const ORG = toOrgId("org-md-execution-4483");
const ID = "itv-md-execution-4483";
const REV = "rev-md-execution-4483";
const actorId = `${ORG}-owner`;
let db: PgDatabase;
let store: PgInterviewMarkdownExecutionStore;
let reader: PgInterviewMarkdownReader;
const input = { orgId: ORG, interviewId: ID, actorId };
async function version() { return (await reader.readCurrent(ORG, ID))!.version; }
beforeAll(async () => { ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig()); store = new PgInterviewMarkdownExecutionStore(db); reader = new PgInterviewMarkdownReader(db); }, 120000);
afterAll(async () => { await resetOrgs(ORG); await db?.close(); });
beforeEach(async () => {
  await resetOrgs(ORG); await seedOrg({ orgId: ORG, projectId: "project-md-execution-4483" });
  await addOrgMember(ORG, actorId, "consultant", null);
  await new PgDigitalInterviewRepository(db).createDraft({ ...input, scope: { kind: "none", projectId: null, researchProjectId: null }, name: "Markdown 执行", tags: [], topic: "原始需求" });
  await db.withTenant(ORG, async (session) => {
    await session.query(`INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)`, [ORG,REV,ID,actorId]);
    for (const [step,markdown] of [["intake","# 需求"],["analysis","# 分析"],["experts","## [教师](#expert-teacher)\n画像\n\n## [校长](#expert-principal)\n画像"],["outline","## [教师](#expert-teacher)\n最近一次备课？\n\n## [校长](#expert-principal)\n具体反例？"]] as const) {
      await appendInterviewMarkdownDocument(session, { orgId:ORG,interviewId:ID,revisionId:REV,step,markdown,title:step,evidenceMode:"simulated",references:[],expectedVersion:0 });
    }
  });
});
describe("Markdown task execution", () => {
  it("branches confirmed source versions without touching historical bodies or execution",async()=>{
    await store.control({...input,expectedVersion:await version(),action:"start"});
    const claim=(await store.claim(input))!;
    await store.finish({...input,claimId:claim.claimId,markdown:"原版本回答",failed:false});
    const inFlight=(await store.claim(input))!;
    const before=await db.withTenant(ORG,session=>session.query(`SELECT artifact_id,markdown,content_hash,status,evidence_mode,controlled_references FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 ORDER BY artifact_id`,[ORG,REV]));
    const oldVersion=await version();
    await expect(reader.branch({...input,expectedVersion:oldVersion-1,fromStep:"experts"})).rejects.toThrow("CONCURRENT_MODIFICATION");
    await expect(reader.branch({...input,actorId:"outsider",expectedVersion:oldVersion,fromStep:"experts"})).rejects.toThrow("PERMISSION_REVOKED_MIDWAY");
    await reader.branch({...input,expectedVersion:oldVersion,fromStep:"experts"});
    const next=(await reader.readCurrent(ORG,ID))!;
    expect(next.revisionId).not.toBe(REV);expect(next.version).toBe(oldVersion+1);expect(next.execution).toBeNull();
    await db.withTenant(ORG,async session=>{
      const old=await session.query(`SELECT artifact_id,markdown,content_hash,status,evidence_mode,controlled_references FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 ORDER BY artifact_id`,[ORG,REV]);
      expect(old.rows).toEqual(before.rows);
      expect((await session.query(`SELECT status,tasks FROM interview_markdown_execution WHERE org_id=$1 AND revision_id=$2`,[ORG,REV])).rows[0]).toMatchObject({status:"running"});
      const current=await session.query<{step:string;status:string;markdown:string}>(`SELECT step,status,markdown FROM digital_interview_artifact_versions WHERE org_id=$1 AND revision_id=$2 ORDER BY step`,[ORG,next.revisionId]);
      expect(current.rows.map(row=>row.step)).toEqual(["analysis","experts","intake"]);
      expect(current.rows.find(row=>row.step==="experts")?.status).toBe("draft");
      expect(current.rows.find(row=>row.step==="analysis")?.status).toBe("confirmed");
      expect(current.rows.find(row=>row.step==="experts")?.markdown).toContain("## [教师](#expert-teacher)");
    });
    await reader.saveDraft({...input,expectedVersion:next.version,expectedDocumentVersion:1,step:"experts",markdown:"## [新教师](#expert-new-teacher)\n新画像"});
    expect((await reader.readCurrent(ORG,ID))!.version).toBe(next.version+1);
    await expect(store.finish({...input,claimId:inFlight.claimId,markdown:"旧任务迟到回答",failed:false})).rejects.toThrow("CONCURRENT_MODIFICATION");
  });
  it("projects truthful history from source execution without rewriting legacy research fields",async()=>{
    const history=(status?:"report_pending"|"completed"|"draft")=>listDigitalInterviews({repo:new PgDigitalInterviewRepository(db),scope:new PgInterviewScopeRepository(db),decisions:new UuidDecisionIdFactory()},{orgId:ORG,viewerUserId:actorId,status});
    expect((await history()).items[0]).toMatchObject({status:"questions_pending",sourceStep:"runs",expertCount:2,completedExpertCount:0});
    await store.control({...input,expectedVersion:await version(),action:"start"});
    const first=(await store.claim(input))!;
    await store.finish({...input,claimId:first.claimId,markdown:"教师回答",failed:false});
    expect((await history()).items[0]).toMatchObject({status:"running",sourceStep:"runs",expertCount:2,completedExpertCount:1});
    const second=(await store.claim(input))!;
    await store.finish({...input,claimId:second.claimId,markdown:"校长回答",failed:false});
    expect((await history("report_pending")).items[0]).toMatchObject({status:"report_pending",sourceStep:"runs",completedExpertCount:2});
    expect((await history("draft")).items).toHaveLength(0);
    await db.withTenant(ORG,session=>appendInterviewMarkdownDocument(session,{orgId:ORG,interviewId:ID,revisionId:REV,step:"report",title:"报告",markdown:"# 模拟研究报告",evidenceMode:"simulated",references:[],expectedVersion:0,status:"draft"}));
    expect((await history("completed")).items[0]).toMatchObject({status:"completed",sourceStep:"report",primaryAction:"view_report",expertCount:2,completedExpertCount:2});
    await db.withTenant(ORG,async session=>{
      const row=(await session.query<{digital_status:string;selected_expert_ids:string[]}>(`SELECT digital_status,selected_expert_ids FROM interview_sessions WHERE org_id=$1 AND id=$2`,[ORG,ID])).rows[0];
      expect(row).toEqual({digital_status:"draft",selected_expert_ids:[]});
    });
  });
  it("calls the actual model port with confirmed Markdown, retains failure, and only reports after tasks complete", async () => {
    let calls=0;
    const deps={repo:new PgDigitalInterviewRepository(db),scope:new PgInterviewScopeRepository(db),decisions:new UuidDecisionIdFactory(),reader,store,modelProvider:"test",modelId:"test",model:{complete:async(request:{user:string;system:string})=>{
      expect(request.user).toContain("最近一次备课？");expect(request.system).toContain("Markdown");
      calls++;return calls===1?{text:"### 已保存部分\n回答 🧪",truncated:true}:{text:"\n### 剩余回答\n具体反例"};
    }}};
    const first=await executeInterviewMarkdown(deps,{...input,expectedVersion:await version(),action:"start"});
    expect(first.execution?.status).toBe("failed");
    expect(first.documents.find(d=>d.step==="runs")?.markdown).toContain("回答 🧪");
    await expect(generateInterviewMarkdown(deps,{orgId:ORG,viewerUserId:actorId,interviewId:ID,step:"report",expectedVersion:first.version,expectedDocumentVersion:0})).rejects.toThrow("DIGITAL_INTERVIEW_STEP_INVALID");
    const retry=await executeInterviewMarkdown(deps,{...input,expectedVersion:first.version,action:"retry"});
    expect(retry.execution?.tasks[0]?.status).toBe("completed");
    const complete=await executeInterviewMarkdown(deps,{...input,expectedVersion:retry.version,action:"advance"});
    expect(complete.execution?.status).toBe("completed");
    expect(complete.documents.find(d=>d.step==="runs")?.markdown.match(/回答 🧪/gu)).toHaveLength(1);
  });
  it("claims one expert, persists answer Markdown before scheduling and resumes without duplicating it", async () => {
    await store.control({ ...input, expectedVersion:await version(), action:"start" });
    const claim = await store.claim(input); expect(claim?.expertId).toBe("teacher");
    expect(await store.claim(input)).toBeNull();
    await store.control({ ...input, expectedVersion:await version(), action:"pause" });
    await store.finish({ ...input, claimId:claim!.claimId, markdown:"### 回答\r\n原样 🧪", failed:false });
    expect(await store.claim(input)).toBeNull();
    expect((await reader.readCurrent(ORG, ID))!.execution?.status).toBe("paused");
    await store.control({ ...input, expectedVersion:await version(), action:"resume" });
    const second = await store.claim(input); expect(second?.expertId).toBe("principal");
    await store.finish({ ...input, claimId:second!.claimId, markdown:"### 反例\n完整回答", failed:false });
    const source = (await reader.readCurrent(ORG, ID))!;
    expect(source.execution?.status).toBe("completed");
    await db.withTenant(ORG, async (session) => {
      const result = await session.query<{markdown:string; status:string; evidence_mode:string}>(`SELECT markdown,status,evidence_mode FROM digital_interview_artifact_versions WHERE org_id=$1 AND interview_id=$2 AND step='runs' ORDER BY version_number DESC LIMIT 1`, [ORG,ID]);
      expect(result.rows[0]!.markdown).toContain("### 回答\r\n原样 🧪");
      expect(result.rows[0]!.status).toBe("completed");
      expect(result.rows[0]!.evidence_mode).toBe("simulated");
      expect((await session.query(`SELECT 1 FROM digital_interview_expert_runs WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows).toHaveLength(0);
    });
  });
  it("preserves failed text, retries only its gap and rejects stale versions or unauthorized control", async () => {
    await store.control({ ...input, expectedVersion:await version(), action:"start" });
    const claim = (await store.claim(input))!;
    await store.finish({ ...input, claimId:claim.claimId, markdown:"已保存片段", failed:true });
    expect((await reader.readCurrent(ORG, ID))!.execution?.status).toBe("failed");
    await expect(store.control({ ...input, expectedVersion:1,action:"retry" })).rejects.toThrow("CONCURRENT_MODIFICATION");
    await expect(store.control({ ...input,actorId:"outsider",expectedVersion:await version(),action:"retry" })).rejects.toThrow();
    await store.control({ ...input,expectedVersion:await version(),action:"retry" });
    expect((await store.claim(input))?.expertId).toBe("teacher");
  });
  it("rechecks actor visibility when the model answer returns", async()=>{
    await store.control({...input,expectedVersion:await version(),action:"start"});
    const claim=(await store.claim(input))!;
    await db.withTenant(ORG,session=>session.query(`DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2`,[ORG,actorId]));
    await expect(store.finish({...input,claimId:claim.claimId,markdown:"不应保存",failed:false})).rejects.toThrow("PERMISSION_REVOKED_MIDWAY");
  });
  it("recovers an expired claim and refuses writeback from the obsolete worker",async()=>{
    await store.control({...input,expectedVersion:await version(),action:"start"});
    const old=(await store.claim(input))!;
    await db.withTenant(ORG,session=>session.query(`UPDATE interview_markdown_execution SET claim_expires_at=now()-interval '1 second' WHERE org_id=$1 AND revision_id=$2`,[ORG,REV]));
    const recovered=(await store.claim(input))!;
    expect(recovered.expertId).toBe(old.expertId);
    expect(recovered.claimId).not.toBe(old.claimId);
    await expect(store.finish({...input,claimId:old.claimId,markdown:"重复结果",failed:false})).rejects.toThrow("CONCURRENT_MODIFICATION");
    await store.finish({...input,claimId:recovered.claimId,markdown:"有效回答",failed:false});
  });
  it("pins confirmed versions and refuses a changed source during model execution",async()=>{
    await store.control({...input,expectedVersion:await version(),action:"start"});
    const claim=(await store.claim(input))!;
    await db.withTenant(ORG,session=>appendInterviewMarkdownDocument(session,{orgId:ORG,interviewId:ID,revisionId:REV,step:"intake",title:"新需求",markdown:"修改后的需求",evidenceMode:"simulated",references:[],expectedVersion:1}));
    await expect(store.finish({...input,claimId:claim.claimId,markdown:"基于旧需求",failed:false})).rejects.toThrow("CONCURRENT_MODIFICATION");
  });
});
