import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.0.1'),{packId:'standard-methods',packVersion:'1.0.1'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.0.1'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.0.0'),{packId:'standard-methods',packVersion:'1.0.0'});assert.equal(previous.packDigest,'fdbf33f44187940aa88c9a5d43d16e5904d576dfd88efdc7a5bac61d4dea5c47');assert.deepEqual(pack.skills.find(s=>s.stableName==='interview-synthesis'),previous.skills.find(s=>s.stableName==='interview-synthesis'));
for(const skill of pack.skills){
 assert.equal(skill.files.length,2);
 for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));
 const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
 for(const reference of entry.matchAll(/references\/[a-z-]+\.md/g))assert.ok(skill.files.some(f=>f.path===reference[0]));
 assert.match(entry,/工具|能力/);assert.match(entry,/不可用|未配置|缺/);
}
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.0.1'}));
console.log('PASS: real FileSkillStarterPackSource reads both complete packages; per-file bytes/digests and pack digest verified; missing deployment root/version fail closed; tampering rejected.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
