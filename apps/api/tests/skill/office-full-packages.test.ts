import {it,expect,beforeAll} from 'vitest';
import {resolveSkillRiskLevel} from '../../src/domain/agent-run/skill-risk-level';
import {createHash} from 'node:crypto';
import {officeSkillPackage} from '../../scripts/office-skill-packages';
import {ensurePlatformOrgSeeded,ensurePlatformSkillsSeeded,OFFICIAL_SKILLS} from '../../src/infrastructure/skill/ensure-platform-skill-catalog';
import {ensureDatabase,migrateOnce,asApp} from '../support/db';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
beforeAll(async()=>{await ensureDatabase();await migrateOnce();await ensurePlatformOrgSeeded();});
it('packages original creation recipes and fixed immutable hashes without rewriting the engine',()=>{
 for(const spec of OFFICIAL_SKILLS){const result=officeSkillPackage(spec);expect(result.package.files).toHaveLength(4);
 expect(Buffer.from(result.package.files[0]!.contentBase64,'base64').toString()).toContain(spec.content);
 const body=Buffer.from(result.package.files[0]!.contentBase64,'base64').toString();
 expect(body).not.toContain('risk_level:');
 // A redistributed/renamed package must retain the original undeclared-risk default.
 expect(resolveSkillRiskLevel({stableName:'imported-office-copy',content:body})).toBe('L1');
 expect(resolveSkillRiskLevel({stableName:'imported-office-copy',content:spec.content})).toBe('L1');
 expect(officeSkillPackage(spec)).toEqual(result);
 for(const file of result.package.files)expect(createHash('sha256').update(Buffer.from(file.contentBase64,'base64')).digest('hex')).toBe(file.digest);
 }
});
it('upgrades legacy platform package transactionally and preserves immutable old version bytes on repeated seed',async()=>{
 const spec=OFFICIAL_SKILLS.find(s=>s.stableName==='docx-create')!;const old=`${spec.skillId}-legacy-office-test`;
 await asApp('org-platform',async c=>{
 await c.query("INSERT INTO skills(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,'org-platform',$2,$3,'enabled','svc-platform-templates',now(),now()) ON CONFLICT DO NOTHING",[spec.skillId,spec.stableName,spec.displayName]);
 await c.query("INSERT INTO skill_versions(id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published) VALUES($1,'org-platform',$2,'legacy-office-test',$3,'{}','svc-platform-templates',now(),false) ON CONFLICT DO NOTHING",[old,spec.skillId,hash('legacy')]);
 await c.query("INSERT INTO skill_version_files(org_id,version_id,path,content,media_type,digest) VALUES('org-platform',$1,'SKILL.md',$2,'text/markdown',$3) ON CONFLICT DO NOTHING",[old,Buffer.from('legacy'),hash('legacy')]);
 await c.query("SELECT wave2_publish_skill_version('org-platform',$1)",[old]);
 });
 await ensurePlatformSkillsSeeded();
 const snapshot=()=>asApp('org-platform',async c=>(await c.query("SELECT id,content_digest FROM skill_versions WHERE org_id='org-platform' AND skill_id=$1 ORDER BY id",[spec.skillId])).rows);
 const initial=await snapshot();await Promise.all([ensurePlatformSkillsSeeded(),ensurePlatformSkillsSeeded()]);expect(await snapshot()).toEqual(initial);
 await asApp('org-platform',async c=>{
 const rows=await c.query("SELECT f.path,f.content,f.digest FROM skill_version_files f JOIN skill_versions v ON v.id=f.version_id AND v.org_id=f.org_id WHERE f.org_id='org-platform' AND v.skill_id=$1 AND v.content_digest=$2 ORDER BY f.path",[spec.skillId,officeSkillPackage(spec).digest]);
 expect(rows.rows).toHaveLength(4);
 const legacy=await c.query("SELECT content FROM skill_version_files WHERE org_id='org-platform' AND version_id=$1",[old]);expect(legacy.rows[0].content.toString()).toBe('legacy');
 });
});
