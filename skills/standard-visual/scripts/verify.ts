import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {FileSkillStarterPackSource} from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..'),source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-visual','1.0.1'),{packId:'standard-visual',packVersion:'1.0.1'});
const previous=verifySkillStarterPack(await source.load('standard-visual','1.0.0'),{packId:'standard-visual',packVersion:'1.0.0'});assert.equal(previous.packDigest,'0cf62e26bee3787c0a579765616d47947ee69e45c6bcf877b2d09e7c5928c98d');
assert.equal(pack.skills.length,1);assert.equal(pack.skills[0]!.files.length,4);
for(const file of pack.skills[0]!.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,'visual-content',file.path)));
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-visual','1.0.1'),null);
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64='dGFtcGVy';assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-visual',packVersion:'1.0.1'}));
console.log('PASS complete four-file visual-content pack through actual FileSkillStarterPackSource; tampering refused. Not a live model G-SKILL.');

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
