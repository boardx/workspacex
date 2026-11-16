import { expect, it } from "vitest";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";
import { PgAidtRawFilesRepository } from "../../src/infrastructure/aidt-files/pg-aidt-raw-files-repository";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import { decide } from "../../src/domain/identity/permission-decision";
import { toOrgId, type OrgId } from "../../src/domain/org-id";

it("projects persisted receipt submission columns rather than the current reader (SQL-port test, not PG evidence)", async () => {
  const orgId=toOrgId("org");
  const queries:string[]=[];
  const session:TenantSession={async query<T>(sql:string) {
    queries.push(sql);
    const rows=sql.includes("SELECT p.status")?[{status:"active",org_status:"active",kind:"general",aidt:true}]:sql.includes("FROM aidt_raw_upload_runs r JOIN artifacts a")?[{
      id:"run",project_id:"p",artifact_id:"a",artifact_version_id:"v",filename:"original.txt",mime:"text/plain; charset=utf-8",sha256:"a".repeat(64),size_bytes:"3",object_storage_key:"private-object-key",content_hash:"version-hash",
      created_by:"actual-submitter",created_at:new Date("2026-11-16T01:02:03.456Z"),
    }]:[];
    return {rows:rows as unknown as T[]};
  }};
  const db:DatabasePort={async withTenant<T>(requested:OrgId,fn:(s:TenantSession)=>Promise<T>) {expect(requested).toBe(orgId);return fn(session);},async withoutTenant<T>():Promise<T> {throw new Error("forbidden");},async close() {}};
  const repo=new PgAidtRawFilesRepository(db);
  const decision=decide({decisionId:"test",action:"read.allHands",org:{role:"consultant",teamId:null},project:{role:"member",groupId:null,isHost:false},scope:{scope:"org-wide",ownerTeamId:null}});
  for(const userId of ["reader-one","reader-two"]) {
    const guarded=await repo.inProject({orgId,projectId:"p",userId},tx=>tx.content("run"));
    expect(guarded).not.toBeNull();
    const disclosed=discloseDecided(guarded!,decision);
    expect(isDisclosed(disclosed)).toBe(true);
    if(!isDisclosed(disclosed)) throw new Error("unexpected denial");
    expect(disclosed.payload).toMatchObject({submittedBy:"actual-submitter",submittedAt:"2026-11-16T01:02:03.456Z"});
    expect(disclosed.payload.submittedBy).not.toBe(userId);
  }
  expect(queries.filter(sql=>sql.includes("FROM aidt_raw_upload_runs r JOIN artifacts a")).every(sql=>sql.includes("r.created_by,r.created_at"))).toBe(true);
});
