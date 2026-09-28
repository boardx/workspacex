import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.4.0'),{packId:'standard-methods',packVersion:'1.4.0'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.4.0'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.3.0'),{packId:'standard-methods',packVersion:'1.3.0'});assert.equal(previous.packDigest,'2f894e5a57d9f609f015719235adb6b59e0c86f66909520ba096e656c7204e86');
// 1.4.0 只新增 design-methods（issue #4578）：已发货的三个 skill 必须逐字节不变
// ——这条断言就是「我验证了 X」，不要求复核者自己去比对。
for(const stableName of ['interview-synthesis','user-research-planning','maau-canvas'])assert.deepEqual(pack.skills.find(s=>s.stableName===stableName),previous.skills.find(s=>s.stableName===stableName));
assert.equal(previous.skills.some(s=>s.stableName==='design-methods'),false);
const design=pack.skills.find(s=>s.stableName==='design-methods')!;
assert.equal(design.semanticVersion,'1.0.0');assert.equal(design.manifest.capabilityId,'WX-S023');
const decode=(path:string)=>Buffer.from(design.files.find(f=>f.path===path)!.contentBase64,'base64').toString();
// 卡片库的实质：索引里的每个编号在四份卡片里恰好有一张卡，卡片间引用的编号都在索引里。
// 钉的是「编号是唯一抓手」这条 SKILL.md 承诺，不是钉卡片数量常量。
const idPattern=/\b(?:M[1-7]-\d{2}|X[1-3]-\d{2}|F-\d{2})\b/g;
const indexIds=new Set(decode('references/method-index.md').split('\n').filter(l=>l.startsWith('| ')).map(l=>/^\| ((?:M[1-7]-\d{2}|X[1-3]-\d{2}|F-\d{2})) \|/.exec(l)?.[1]).filter((id):id is string=>id!==undefined));
assert.ok(indexIds.size>=150,`index lists only ${indexIds.size} methods`);
const cardFiles=['references/cards-discover.md','references/cards-define.md','references/cards-develop.md','references/cards-deliver.md'];
const headings=new Map<string,number>();
for(const path of cardFiles){
 const body=decode(path);
 for(const m of body.matchAll(/^### ((?:M[1-7]-\d{2}|X[1-3]-\d{2}|F-\d{2})) /gm))headings.set(m[1]!,(headings.get(m[1]!)??0)+1);
 for(const m of body.matchAll(idPattern))assert.ok(indexIds.has(m[0]),`${path} references unknown method ${m[0]}`);
}
for(const id of indexIds)assert.equal(headings.get(id),1,`method ${id} must have exactly one card`);
assert.equal(headings.size,indexIds.size);
// 出处纪律（issue #4578）：本库是自有组织方式 + 自写说明，不以任何一本书为底本、不宣称获任何书或机构授权；
// 商标化的框架名改用通用叫法。这里机械拦住回潮——只靠「写的时候记得」迟早会被下一次编辑带回来。
const forbidden=/Kumar|101 Design Methods|Seven Modes|七模式|Sense Intent|Know Context|Know People|Frame Insights|Explore Concepts|Frame Solutions|Realize Offerings|POEMS|ERAF|Ten Types of Innovation|十种创新|Six Thinking Hats|六顶思考帽/i;
for(const file of design.files){const hit=forbidden.exec(Buffer.from(file.contentBase64,'base64').toString());assert.equal(hit,null,`design-methods/${file.path} mentions ${hit?.[0]}`);}
for(const m of decode('SKILL.md').matchAll(idPattern))assert.ok(indexIds.has(m[0]),`SKILL.md references unknown method ${m[0]}`);
for(const skill of pack.skills){
 assert.ok(skill.files.length>=2);
 for(const file of skill.files)assert.deepEqual(Buffer.from(file.contentBase64,'base64'),readFileSync(resolve(root,skill.stableName,file.path)));
 const entry=Buffer.from(skill.files[0]!.contentBase64,'base64').toString();
 for(const reference of entry.matchAll(/references\/[a-z-]+\.md/g))assert.ok(skill.files.some(f=>f.path===reference[0]));
 // 反向：包里打进去的每份参考文件都必须在入口里被点名，否则模型永远不会去读它。
 for(const file of skill.files.slice(1))assert.ok(entry.includes(file.path),`${skill.stableName} ships unreferenced ${file.path}`);
 assert.match(entry,/工具|能力/);assert.match(entry,/不可用|未配置|缺/);
}
const changed=structuredClone(pack);changed.skills[0]!.files[0]!.contentBase64=Buffer.from('tampered').toString('base64');
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.4.0'}));
console.log(`PASS: real FileSkillStarterPackSource reads shipped 1.4.0 and superseded 1.3.0; four skills verified per-file against the editing sources; 1.4.0 only adds design-methods (WX-S023, ${indexIds.size} indexed methods, each with exactly one card, no dangling cross-references, no book attribution or trademarked framework names) and leaves the three shipped skills byte-identical; missing deployment root/version fail closed; tampering rejected.`);

}
main().catch(error=>{console.error(error);process.exitCode=1;});
