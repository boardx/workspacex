import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.3.0'),{packId:'standard-methods',packVersion:'1.3.0'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.3.0'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.2.0'),{packId:'standard-methods',packVersion:'1.2.0'});assert.equal(previous.packDigest,'d415c439eb0c5e53533a387e592750011d7604b6c5fa83925a43c7db6e4b179c');
// 1.2.0 只改 maau-canvas（出图→A3 HTML/PDF，2.0.0）：另外两个已发货 skill 必须逐字节不变
// ——这条断言就是「我验证了 X」，不要求复核者自己去比对。
for(const stableName of ['interview-synthesis','user-research-planning'])assert.deepEqual(pack.skills.find(s=>s.stableName===stableName),previous.skills.find(s=>s.stableName===stableName));
const maau=pack.skills.find(s=>s.stableName==='maau-canvas')!,maauPrev=previous.skills.find(s=>s.stableName==='maau-canvas')!;
assert.equal(maau.semanticVersion,'3.0.0');assert.equal(maauPrev.semanticVersion,'2.0.0');
// 换代的实质：不再调图像模型，改成 A3 版式 + 活动图 + PDF。钉正文里的关键词，不是钉版本号字符串。
const maauEntry=Buffer.from(maau.files[0]!.contentBase64,'base64').toString();
assert.match(maauEntry,/browser_take_screenshot/);assert.match(maauEntry,/A3/);
// 3.0.0 的换代实质：默认交付从「A3 文件」变成「两个围栏」——canvas 模板 + 顺序图。
assert.match(maauEntry,/模板: maau/);assert.match(maauEntry,/sequenceDiagram/);
assert.equal(/wx_image_generate/.test(maauEntry),false);
for(const skill of pack.skills){
 assert.equal(skill.files.length,2);
 for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));
 const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
 for(const reference of entry.matchAll(/references\/[a-z-]+\.md/g))assert.ok(skill.files.some(f=>f.path===reference[0]));
 assert.match(entry,/工具|能力/);assert.match(entry,/不可用|未配置|缺/);
}
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.3.0'}));
console.log('PASS: real FileSkillStarterPackSource reads shipped 1.3.0 and superseded 1.2.0; three skills verified per-file against the editing sources; 1.3.0 changes only maau-canvas (fabric canvas fence + sequence diagram become the default delivery) and leaves the two shipped skills byte-identical; missing deployment root/version fail closed; tampering rejected.');

}
main().catch(error=>{console.error(error);process.exitCode=1;});
