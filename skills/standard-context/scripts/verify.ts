import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
 const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('standard-context','1.1.0'),{packId:'standard-context',packVersion:'1.1.0'});
 verifySkillStarterPack(await source.load('standard-context','1.0.0'),{packId:'standard-context',packVersion:'1.0.0'});
 assert.equal(pack.skills.length,4);
 for(const skill of pack.skills){assert.equal(skill.files.length,5);for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(file.path==='references/retrieval-scope.md'?resolve(root,file.path):resolve(root,skill.stableName,file.path)));}
 assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-context','1.1.0'),null);
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-context',packVersion:'1.1.0'}));
 console.log('PASS actual FileSkillStarterPackSource four skills / twenty files, exact bytes + digests + license, missing deployment root unavailable, tamper rejected. Not a live-model G-SKILL evaluation.');
}void main().catch(e=>{console.error(e);process.exitCode=1;});
