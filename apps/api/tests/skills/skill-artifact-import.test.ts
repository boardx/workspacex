import {expect,it,vi} from 'vitest';
import {importSkillArtifact} from '../../src/application/skill-import/import-skill-artifact';
import type {SkillArtifactImportDeps} from '../../src/application/skill-import/import-skill-artifact';
import {SkillStarterImportIdempotencyConflictError} from '../../src/application/skill-import/import-skill-starter-pack';
import {toOrgId} from '../../src/domain/org-id';
import {sha256} from '../../src/domain/skill/starter-pack';
vi.mock('../../src/application/artifacts-steering/read-artifact',()=>({getArtifact:vi.fn(async()=>({versions:[{version:1,storageKey:'source',sizeBytes:bytes.length}]}))}));
const content=Buffer.from('# Example\n'),unsigned={schemaVersion:1,packId:'example',packVersion:'1.0.0',skills:[{stableName:'example',name:'Example',semanticVersion:'1.0.0',manifest:{},files:[{path:'SKILL.md',mediaType:'text/markdown',digest:sha256(content),contentBase64:content.toString('base64')}]}]};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))},bytes=Buffer.from(JSON.stringify(pack));
it('refuses a replay with the same coordinates but a different verified package digest',async()=>{
 const deps={identities:{findOrgMembership:async()=>({orgRole:'admin'})},objects:{head:async()=>({sizeBytes:bytes.length,mime:'application/json'}),get:async()=>bytes},imports:{findExisting:async()=>({kind:'replayed',result:{packDigest:'f'.repeat(64)}})}} as unknown as SkillArtifactImportDeps;
 await expect(importSkillArtifact(deps,{orgId:toOrgId('org'),userId:'admin'},{artifactId:'artifact',version:1,expectedDigest:sha256(bytes),idempotencyKey:'same'})).rejects.toBeInstanceOf(SkillStarterImportIdempotencyConflictError);
});
