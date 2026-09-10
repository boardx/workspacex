import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.2.0'),{packId:'standard-methods',packVersion:'1.2.0'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.2.0'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.1.0'),{packId:'standard-methods',packVersion:'1.1.0'});assert.equal(previous.packDigest,'6c5e020801cd1534909db3a1adc8452613946c86ffab16b207c3e90099b46991');
// 1.2.0 只改 maau-canvas（出图→A3 HTML/PDF，2.0.0）：另外两个已发货 skill 必须逐字节不变
// ——这条断言就是「我验证了 X」，不要求复核者自己去比对。
for(const stableName of ['interview-synthesis','user-research-planning'])assert.deepEqual(pack.skills.find(s=>s.stableName===stableName),previous.skills.find(s=>s.stableName===stableName));
const maau=pack.skills.find(s=>s.stableName==='maau-canvas')!,maauPrev=previous.skills.find(s=>s.stableName==='maau-canvas')!;
assert.equal(maau.semanticVersion,'2.0.0');assert.equal(maauPrev.semanticVersion,'1.0.0');
// 换代的实质：不再调图像模型，改成 A3 版式 + 活动图 + PDF。钉正文里的关键词，不是钉版本号字符串。
const maauEntry=Buffer.from(maau.files[0]!.contentBase64,'base64').toString();
assert.match(maauEntry,/browser_take_screenshot/);assert.match(maauEntry,/A3/);assert.match(maauEntry,/mermaid/);
assert.equal(/wx_image_generate/.test(maauEntry),false);
for(const skill of pack.skills){
 assert.equal(skill.files.length,2);
 for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));
 const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
 for(const reference of entry.matchAll(/references\/[a-z-]+\.md/g))assert.ok(skill.files.some(f=>f.path===reference[0]));
 assert.match(entry,/工具|能力/);assert.match(entry,/不可用|未配置|缺/);
}
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.2.0'}));
console.log('PASS: real FileSkillStarterPackSource reads shipped 1.2.0 and superseded 1.1.0; three skills verified per-file against the editing sources; 1.2.0 changes only maau-canvas (image generation removed, A3 HTML/PDF added) and leaves the two shipped skills byte-identical; missing deployment root/version fail closed; tampering rejected.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
