import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
 const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('standard-web','1.0.0'),{packId:'standard-web',packVersion:'1.0.0'});
 assert.equal(pack.skills.length,1);assert.equal(pack.skills[0]!.files.length,4);
 for(const file of pack.skills[0]!.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,'web-research',file.path)));
 assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-web','1.0.0'),null);
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-web',packVersion:'1.0.0'}));
 console.log('PASS actual FileSkillStarterPackSource complete4files/bytes/digests/license; missing deploymentroot unavailable; tampered package rejected. Not a live-model G-SKILL evaluation.');
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
