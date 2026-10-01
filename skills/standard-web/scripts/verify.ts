import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
 const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('standard-web','1.1.2'),{packId:'standard-web',packVersion:'1.1.2'});
 const previous=verifySkillStarterPack(await source.load('standard-web','1.1.1'),{packId:'standard-web',packVersion:'1.1.1'});
 assert.equal(previous.packDigest,'ccb3c0341ade8f8f74f93f5858c65f7cad2aa93a0a202981f4a8a278439b08a8');
 assert.deepEqual(pack.skills.find(s=>s.stableName==='web-research'),previous.skills.find(s=>s.stableName==='web-research'));
 assert.deepEqual(pack.skills.map(skill=>skill.stableName),['web-research','web-artifact']);
 for(const skill of pack.skills){assert.equal(skill.files.length,4);for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));}
 const body=Buffer.from(pack.skills.find(s=>s.stableName==='web-artifact')!.files.find(f=>f.path==='SKILL.md')!.contentBase64,'base64').toString('utf8');
 for(const required of ['text/html','not_tested','旧 ref 被拒绝','Passed by absence','像素统计','not_published'])assert.ok(body.includes(required));
 assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-web','1.1.2'),null);
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-web',packVersion:'1.1.2'}));
 console.log('PASS actual FileSkillStarterPackSource two complete 4-file skills/bytes/digests/licenses; missing deploymentroot unavailable; tampered package rejected. Not a live-model G-SKILL evaluation.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
