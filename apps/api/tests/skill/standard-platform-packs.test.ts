import { skills as SkillContracts } from "@repo/contracts";
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ensureDatabase, migrateOnce, asApp, seedOrg, addOrgMember, resetOrgs } from '../support/db';
import { ensurePlatformSkillCatalogSeeded } from '../../src/infrastructure/skill/ensure-platform-skill-catalog';
import { STANDARD_PLATFORM_PACKS } from '../../src/infrastructure/skill/ensure-standard-skill-packs';
import { PLATFORM_ORG_ID } from '../../src/domain/org-id';
it('publishes shipped complete workflow packages through the existing importer and replays without duplicate versions',async()=>{
  ensureDatabase();await migrateOnce();
  const first=await ensurePlatformSkillCatalogSeeded();expect(first.ok).toBe(true);
  if(!first.ok)throw first.error;
  expect(first.report.standardPacks.map(p=>p.packId)).toEqual(STANDARD_PLATFORM_PACKS.map(p=>p.packId));
  const rows=await asApp(PLATFORM_ORG_ID,c=>c.query(`SELECT s.stable_name,v.id,count(f.path)::int AS files
    FROM skills s JOIN skill_versions v ON v.skill_id=s.id AND v.org_id=s.org_id
    JOIN skill_version_files f ON f.version_id=v.id AND f.org_id=v.org_id
    WHERE s.org_id=$1 AND v.published=true AND s.stable_name='knowledge-grounded-answer'
    GROUP BY s.stable_name,v.id`,[PLATFORM_ORG_ID]));
  expect(rows.rows).toHaveLength(1);expect(rows.rows[0].files).toBe(4);
  const second=await ensurePlatformSkillCatalogSeeded();expect(second.ok).toBe(true);
  if(!second.ok)throw second.error;
  expect(second.report.standardPacks.every(p=>!p.created)).toBe(true);
  expect(second.report.standardPacks.map(p=>p.result)).toEqual(first.report.standardPacks.map(p=>p.result));
},30000);

it('exposes the published standard package through the actual Skills API to ordinary members in distinct organizations',async()=>{
  ensureDatabase();await migrateOnce();
  const seeded=await ensurePlatformSkillCatalogSeeded();if(!seeded.ok)throw seeded.error;
  const orgs=['standard-a-'+randomUUID(),'standard-b-'+randomUUID()];
  const keys={KERNEL_ALLOW_TEST_PRINCIPAL:'1',KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_QUIET:'1'};
  const previous=Object.fromEntries(Object.keys(keys).map(k=>[k,process.env[k]]));Object.assign(process.env,keys);
  for(const orgId of orgs){await seedOrg({orgId,projectId:'project-'+orgId});await addOrgMember(orgId,'reader','consultant',null);}
  const app=await (await import('../../src/main')).createApp();
  try {
    await app.listen(0,'127.0.0.1');const base=await app.getUrl();const ids=[];
    for(const orgId of orgs){
      const response=await fetch(`${base}/skills?entry=library&q=${encodeURIComponent('组织知识问答')}`,{headers:{'x-kernel-test-principal':`reader:${orgId}`}});
      expect(response.status).toBe(200);const result=SkillContracts.operations.listSkills.out.parse(await response.json());expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({name:'组织知识问答',status:'已启用'});expect(result.items[0]!.currentVersionId).toBeTruthy();ids.push(result.items[0]!.skillId);
    }
    expect(ids[0]).toBe(ids[1]);
  }finally{await app.close();for(const [k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await resetOrgs(...orgs);}
},30000);
