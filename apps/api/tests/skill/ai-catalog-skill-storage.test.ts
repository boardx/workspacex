import { createHash } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import {
  ensureDatabase,
  migrateOnce,
  seedOrg,
  asApp,
  resetOrgs,
} from "../support/db";
import {
  appendCatalogSkillDraft,
  createCatalogSkill,
  publishCatalogSkill,
  readPublishedCatalogSkill,
  copyPublishedCatalogSkill,
} from "../../src/infrastructure/skill/ai-catalog-skill-storage";
const ORG = "org-ai-catalog-skill-test";
beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await seedOrg({ orgId: ORG, projectId: `${ORG}-project` });
}, 120000);
afterAll(async () => {
  await resetOrgs(ORG);
});
it("draft is invisible as a published public source and private versions cannot be reclassified by id", async () => {
  const draft = await asApp(ORG, (s) =>
    createCatalogSkill(s, ORG, "test-actor", {
      name: "Private draft",
      stableName: "private-draft",
      description: "Private",
      content: "# Private\n",
    }),
  );
  expect(
    await asApp(ORG, (s) =>
      readPublishedCatalogSkill(s, draft.id, draft.versionId),
    ),
  ).toBeNull();
  await asApp(ORG, (s) =>
    publishCatalogSkill(s, ORG, draft.id, draft.versionId),
  );
  expect(
    await asApp(ORG, (s) =>
      readPublishedCatalogSkill(s, draft.id, draft.versionId),
    ),
  ).toBeNull();
});
it("fixed snapshots copy exact bytes through the existing publisher", async () => {
  const content = Buffer.from("# Exact frozen Skill\n");
  const digest = createHash("sha256").update(content).digest("hex");
  const local = await asApp(ORG, (s) =>
    copyPublishedCatalogSkill(s, ORG, "actual-admin", {
      id: "public-origin",
      versionId: "fixed-v1",
      name: "Copied frozen Skill",
      stableName: "origin",
      semanticLabel: "v1",
      digest,
      manifest: { description: "Frozen" },
      files: [
        { path: "SKILL.md", content, mediaType: "text/markdown", digest },
      ],
    }),
  );
  const rows = await asApp(ORG, (s) =>
    s.query<{ content: Buffer; published: boolean }>(
      `SELECT f.content,v.published FROM skill_versions v JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id WHERE v.id=$1 AND v.org_id=$2`,
      [local.versionId, ORG],
    ),
  );
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0]?.content.equals(content)).toBe(true);
  expect(rows.rows[0]?.published).toBe(true);
});

it('legacy contract remains discoverable with typed readonly detail and other tenants cannot read it',async()=>{
 const {catalogEntries,catalogDefinition}=await import('../../src/infrastructure/ai-catalog/catalog-storage');
 const {Detail}=await import('@repo/contracts/ai-catalog-admin');
 await asApp(ORG,s=>s.query(`INSERT INTO skill_contracts(id,org_id,name,duty,source,status,visibility,created_by) VALUES('legacy-catalog-test',$1,'Legacy contract','Legacy purpose','自建','草稿','org-wide','test-actor')`,[ORG]));
 const rows=await asApp(ORG,s=>catalogEntries(s,ORG,'skill',100,0));
 const legacy=rows.find(r=>r.id==='legacy-catalog-test');expect(legacy?.entityType).toBe('skill-contract');
 await asApp(ORG,s=>s.query(`INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES('legacy-catalog-test',$1,'same-id-wave2','Distinct wave2','enabled','test-actor',now(),now())`,[ORG]));
 const selected=await asApp(ORG,s=>catalogEntries(s,ORG,'skill',1,0,'legacy-catalog-test','skill-contract'));expect(selected[0]?.name).toBe('Legacy contract');
 const wave2=await asApp(ORG,s=>catalogEntries(s,ORG,'skill',1,0,'legacy-catalog-test','skill'));expect(wave2[0]?.name).toBe('Distinct wave2');
 await asApp(ORG,s=>s.query(`INSERT INTO skill_contract_versions(id,org_id,skill_id,version_number,state,prompt_template,input_schema,output_schema,data_scope,reads_raw_transcript,fallback_declaration,model_ref,content_hash,created_by) VALUES('legacy-catalog-version',$1,'legacy-catalog-test',1,'草稿','Actual prompt','{}','{}','[]',false,'Fallback','model-test',$2,'test-actor')`,[ORG,'a'.repeat(64)]));
 const detail=await asApp(ORG,s=>catalogDefinition(s,ORG,legacy!));
 expect(Detail.parse({entry:legacy,definition:detail}).definition).toMatchObject({kind:'skill-contract',input:{name:'Legacy contract',status:'草稿',declaration:{promptTemplate:'Actual prompt',fallbackDeclaration:'Fallback'}}});
 const other='org-catalog-legacy-other';await seedOrg({orgId:other,projectId:`${other}-p`});
 try{expect(await asApp(other,s=>catalogEntries(s,ORG,'skill',100,0))).toHaveLength(0);}finally{await resetOrgs(other);}
});

it("editing a multifile Skill preserves supporting bytes and full manifest without mutating the original",async()=>{
 const root=Buffer.from('# Imported root');const supporting=Buffer.from([0,255,7,42]);
 const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
 const manifest={description:'Original',tools:['python'],nested:{entry:'scripts/run.py'},permissions:{network:false}};
 const original=await asApp(ORG,s=>copyPublishedCatalogSkill(s,ORG,'author',{id:'multifile-origin',versionId:'multifile-v1',name:'Multifile Skill',stableName:'multifile',semanticLabel:'v1',digest:hash(root),manifest,files:[{path:'SKILL.md',content:root,mediaType:'text/markdown',digest:hash(root)},{path:'scripts/data.bin',content:supporting,mediaType:'application/octet-stream',digest:hash(supporting)}]}));
 const revision=await asApp(ORG,s=>appendCatalogSkillDraft(s,ORG,'editor',original.id,{name:'Updated multifile',stableName:'ignored',description:'Updated',content:'# Edited root'}));
 const read=(version:string)=>asApp(ORG,s=>s.query<{manifest:typeof manifest;path:string;content:Buffer;media_type:string;digest:string}>(`SELECT v.manifest,f.path,f.content,f.media_type,f.digest FROM skill_versions v JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id WHERE v.org_id=$1 AND v.id=$2 ORDER BY f.path`,[ORG,version]));
 const next=await read(revision.versionId);expect(next.rows.map(r=>r.path).sort()).toEqual(['SKILL.md','scripts/data.bin']);expect(next.rows.find(r=>r.path==='scripts/data.bin')).toMatchObject({content:supporting,media_type:'application/octet-stream',digest:hash(supporting)});expect(next.rows.find(r=>r.path==='SKILL.md')?.manifest).toMatchObject({...manifest,description:'Updated',catalogName:'Updated multifile'});expect(next.rows.find(r=>r.path==='SKILL.md')?.content.toString()).toBe('# Edited root');
 const previous=await read(original.versionId);expect(previous.rows.find(r=>r.path==='SKILL.md')?.manifest).toEqual(manifest);expect(previous.rows.find(r=>r.path==='SKILL.md')?.content.equals(root)).toBe(true);expect(previous.rows.find(r=>r.path==='scripts/data.bin')?.content.equals(supporting)).toBe(true);
});
