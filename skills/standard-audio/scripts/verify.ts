import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
 const root=resolve(import.meta.dirname,'..');const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
 const pack=verifySkillStarterPack(await source.load('standard-audio','1.1.1'),{packId:'standard-audio',packVersion:'1.1.1'});
 const previous=verifySkillStarterPack(await source.load('standard-audio','1.1.0'),{packId:'standard-audio',packVersion:'1.1.0'});
 assert.equal(previous.packDigest,'55194bc70ad57482b905fbe893778809d4c2be8da62d72cbac55febf6de6a787');
 assert.deepEqual(pack.skills.find(s=>s.stableName==='audio-transcription'),previous.skills.find(s=>s.stableName==='audio-transcription'));
 assert.equal(pack.skills.find(s=>s.stableName==='meeting-minutes')?.semanticVersion,'1.1.1');
 assert.equal(pack.skills.length,2);
 for(const skill of pack.skills){assert.equal(skill.files.length,4);for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));}
 const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-audio',packVersion:'1.1.1'}));
 console.log('PASS two complete four-file skills through actual starter loader; tampering rejected. Not live-model G-SKILL.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
