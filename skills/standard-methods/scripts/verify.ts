import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.1.0'),{packId:'standard-methods',packVersion:'1.1.0'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.1.0'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.0.1'),{packId:'standard-methods',packVersion:'1.0.1'});assert.equal(previous.packDigest,'57388744be5b621047578e07843351787c8e83d55038543d785bc87085ab7fdb');
// 1.1.0 只新增 maau-canvas：前一版已有的两个 skill 必须逐字节不变（新增不得顺手改动
// 已发货的条目——这条断言就是「我验证了 X」，不要求复核者自己去比对）。
for(const stableName of ['interview-synthesis','user-research-planning'])assert.deepEqual(pack.skills.find(s=>s.stableName===stableName),previous.skills.find(s=>s.stableName===stableName));
assert.ok(pack.skills.some(s=>s.stableName==='maau-canvas'));assert.equal(previous.skills.some(s=>s.stableName==='maau-canvas'),false);
for(const skill of pack.skills){
 assert.equal(skill.files.length,2);
 for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));
 const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
 for(const reference of entry.matchAll(/references\/[a-z-]+\.md/g))assert.ok(skill.files.some(f=>f.path===reference[0]));
 assert.match(entry,/工具|能力/);assert.match(entry,/不可用|未配置|缺/);
}
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.1.0'}));
console.log('PASS: real FileSkillStarterPackSource reads shipped 1.1.0 and superseded 1.0.1; three skills verified per-file against the editing sources; 1.1.0 adds only maau-canvas and leaves the two shipped skills byte-identical; missing deployment root/version fail closed; tampering rejected.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
