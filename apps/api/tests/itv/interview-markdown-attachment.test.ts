import { beforeAll,beforeEach,afterAll,it,expect } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDigitalInterviewRepository } from "../../src/infrastructure/interview/pg-digital-interview-repository";
import { PgInterviewScopeRepository } from "../../src/infrastructure/interview/pg-interview-scope-repository";
import { PgInterviewMarkdownReader } from "../../src/infrastructure/interview/pg-interview-markdown-reader";
import { PgInterviewMarkdownAttachmentRepository } from "../../src/infrastructure/interview/pg-interview-markdown-attachment-repository";
import { UuidDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { AnydocAttachmentToMarkdown } from "../../src/infrastructure/chat/anydoc-attachment-to-markdown";
import { importInterviewMarkdownAttachment } from "../../src/application/interview/import-interview-markdown-attachment";
import { confirmInterviewMarkdownDraft } from "../../src/application/interview/read-interview-markdown";
import { ensureDatabase,migrateOnce,resetOrgs,seedOrg,addOrgMember } from "../support/db";
import { toOrgId } from "../../src/domain/org-id";
const ORG=toOrgId("org-md-attachment-4483"),ID="itv-md-attachment-4483",actorId=`${ORG}-owner`;
let db:PgDatabase,root:string,store:FsObjectStore;
const RAW="# 原件\r\n中文 🧪 `a_b`\r\n";
function deps() {return {repo:new PgDigitalInterviewRepository(db),scope:new PgInterviewScopeRepository(db),decisions:new UuidDecisionIdFactory(),reader:new PgInterviewMarkdownReader(db),attachments:new PgInterviewMarkdownAttachmentRepository(db),store,converter:new AnydocAttachmentToMarkdown()};}
const input={orgId:ORG,interviewId:ID,actorId,expectedVersion:2,expectedDocumentVersion:0,filename:"研究.md",mime:"text/markdown",bytes:Buffer.from(RAW)};
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),"itv-md-attachment-"));store=new FsObjectStore(root);},120000);
afterAll(async()=>{await resetOrgs(ORG);await db?.close();if(root)await rm(root,{recursive:true,force:true});});
beforeEach(async()=>{
  await resetOrgs(ORG);await seedOrg({orgId:ORG,projectId:"project-md-attachment-4483"});await addOrgMember(ORG,actorId,"consultant",null);
  await new PgDigitalInterviewRepository(db).createDraft({orgId:ORG,actorId,interviewId:ID,scope:{kind:"none",projectId:null,researchProjectId:null},name:"附件",tags:[],topic:"初始化"});
  await db.withTenant(ORG,s=>s.query(`UPDATE interview_sessions SET topic=NULL,digital_status='topic_pending' WHERE org_id=$1 AND id=$2`,[ORG,ID]));
  await new PgInterviewMarkdownReader(db).initialize({...input,expectedVersion:1});
});
it("stores original bytes and only appends extracted Markdown as an unconfirmed source version",async()=>{
  const result=await importInterviewMarkdownAttachment(deps(),input);
  expect(result.source.documents[0]?.markdown).toContain(RAW);expect(result.source.states[0]?.status).toBe("draft");
  expect(result.source.documents[0]?.references).toContainEqual({anchor:`attachment-${result.original.assetId}`,documentId:result.original.assetId,version:1});
  await db.withTenant(ORG,async s=>{
    const row=(await s.query<{storage_ref:string}>(`SELECT storage_ref FROM interview_markdown_attachments WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows[0]!;
    expect(Buffer.from((await store.get(row.storage_ref))!)).toEqual(input.bytes);
    expect((await s.query(`SELECT 1 FROM digital_interview_topic_versions WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows).toHaveLength(0);
  });
});
it("uses the real Anydoc converter for CSV and rejects forged MIME",async()=>{
  const csv=await importInterviewMarkdownAttachment(deps(),{...input,filename:"研究.csv",mime:"text/csv",bytes:Buffer.from("场景,次数\n备课,17\n")});
  expect(csv.source.documents[0]?.markdown).toContain("备课");
  await expect(importInterviewMarkdownAttachment(deps(),{...input,expectedVersion:csv.source.version,expectedDocumentVersion:1,mime:"application/pdf"})).rejects.toThrow("MIME_MISMATCH");
});
it("denies unauthorized extraction and rechecks version after conversion",async()=>{
  let called=0;
  const converter={convert:async()=>{called++;return {ok:true as const,markdown:"# 转换正文"};}};
  await expect(importInterviewMarkdownAttachment({...deps(),converter},{...input,actorId:"outsider",mime:"text/csv"})).rejects.toThrow();expect(called).toBe(0);
  const results=await Promise.allSettled([importInterviewMarkdownAttachment(deps(),input),importInterviewMarkdownAttachment(deps(),input)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  await db.withTenant(ORG,async s=>expect((await s.query(`SELECT 1 FROM interview_markdown_attachments WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows).toHaveLength(1));
});
it("does not write converted data after actor membership is revoked during conversion",async()=>{
  const converter={convert:async()=>{
    await db.withTenant(ORG,s=>s.query(`DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2`,[ORG,actorId]));
    return {ok:true as const,markdown:"# 不应披露"};
  }};
  await expect(importInterviewMarkdownAttachment({...deps(),converter},{...input,filename:"材料.csv",mime:"text/csv",bytes:Buffer.from("列\n值\n")})).rejects.toThrow();
  await db.withTenant(ORG,async s=>expect((await s.query(`SELECT 1 FROM interview_markdown_attachments WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows).toHaveLength(0));
});
it("rejects oversized files and unsupported scanned extraction without storing fabricated content",async()=>{
  await expect(importInterviewMarkdownAttachment(deps(),{...input,bytes:Buffer.alloc(3*1024*1024+1,97)})).rejects.toThrow("FILE_TOO_LARGE");
  const converter={convert:async()=>({ok:false as const,code:"unsupported" as const})};
  await expect(importInterviewMarkdownAttachment({...deps(),converter},{...input,filename:"扫描.pdf",mime:"application/pdf",bytes:Buffer.from("%PDF-1.7\nscanned")})).rejects.toThrow("ATTACHMENT_EXTRACTION_UNSUPPORTED");
  await db.withTenant(ORG,async s=>expect((await s.query(`SELECT 1 FROM interview_markdown_attachments WHERE org_id=$1 AND interview_id=$2`,[ORG,ID])).rows).toHaveLength(0));
});
it("rejects uploads to a confirmed immutable intake before conversion",async()=>{
  const uploaded=await importInterviewMarkdownAttachment(deps(),input);
  const source=await confirmInterviewMarkdownDraft(deps(),{orgId:ORG,interviewId:ID,viewerUserId:actorId,step:"intake",expectedVersion:uploaded.source.version,expectedDocumentVersion:1});
  let called=0;
  const converter={convert:async()=>{called++;return {ok:true as const,markdown:"# 不应提取"};}};
  await expect(importInterviewMarkdownAttachment({...deps(),converter},{...input,expectedVersion:source.version,expectedDocumentVersion:2,filename:"材料.csv",mime:"text/csv"})).rejects.toThrow("DIGITAL_INTERVIEW_STEP_INVALID");
  expect(called).toBe(0);
});
