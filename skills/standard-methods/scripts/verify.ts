import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FileSkillStarterPackSource } from '../../../apps/api/src/infrastructure/skill/file-skill-starter-pack-source';
import { verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
import { getTemplate, parseTemplateText } from '../../../packages/fabric-markdown/src/templates-entry';
import { resolveDiagramType } from '../../../apps/web/lib/mermaid-diagram-type';
async function main(){
const root=resolve(import.meta.dirname,'..');
const source=new FileSkillStarterPackSource(resolve(root,'../starter-packs'));
const pack=verifySkillStarterPack(await source.load('standard-methods','1.5.0'),{packId:'standard-methods',packVersion:'1.5.0'});
assert.equal(await new FileSkillStarterPackSource(undefined).load('standard-methods','1.5.0'),null);
assert.equal(await source.load('standard-methods','missing'),null);
const previous=verifySkillStarterPack(await source.load('standard-methods','1.4.0'),{packId:'standard-methods',packVersion:'1.4.0'});assert.equal(previous.packDigest,'a6f26404708f02c7fd9436e4a8db812a6f7716afc75df5cab04e8b3b9767cf52');
// 1.5.0 只改 design-methods（1.0.0 → 1.1.0，新增可执行模板，issue #4589）：另外三个已发货 skill 必须逐字节不变
// ——这条断言就是「我验证了 X」，不要求复核者自己去比对。
for(const stableName of ['interview-synthesis','user-research-planning','maau-canvas'])assert.deepEqual(pack.skills.find(s=>s.stableName===stableName),previous.skills.find(s=>s.stableName===stableName));
assert.equal(previous.skills.find(s=>s.stableName==='design-methods')!.semanticVersion,'1.0.0');
const design=pack.skills.find(s=>s.stableName==='design-methods')!;
assert.equal(design.semanticVersion,'1.1.0');assert.equal(design.manifest.capabilityId,'WX-S023');
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
// 可执行模板（issue #4589）：骨架里的 key / 表头字段 / 分区名必须逐字命中聊天画布**真实**注册的模板——
// 名字对不上的分区在画布上渲染成空白，而且没有报错。这里拿引擎自己的注册表比，不在 skill 里抄第二份分区名。
// 只允许无法务风险的通用模板；有明确权利人的（bmc、value-proposition 等）不在白名单里，等法务确认再加。
const templates=decode('references/templates.md');
const cleanTemplateKeys=new Set(['persona','pestel','swot','mvp','three-horizons','empathy','jtbd','journey-map','hmw','storyboard']);
const templateBlocks=templates.split(/^(?=### T-\d{2} )/m).slice(1);
assert.ok(templateBlocks.length>=10,`templates.md has only ${templateBlocks.length} templates`);
let canvasFences=0,mermaidFences=0;
for(const block of templateBlocks){
 const head=block.split('\n')[0]!;
 const methodId=/ · ((?:M[1-7]-\d{2}|X[1-3]-\d{2}))$/.exec(head)?.[1];
 assert.ok(methodId!==undefined&&indexIds.has(methodId),`template heading must end with a known method ID: ${head}`);
 for(const fence of block.matchAll(/^```canvas\n([\s\S]*?)^```$/gm)){
  canvasFences++;
  const parsed=parseTemplateText(fence[1]!);
  const key=parsed.templateKey??'';
  assert.ok(cleanTemplateKeys.has(key),`${head}: template key "${key}" is not an approved generic template`);
  const spec=getTemplate(key);assert.ok(spec,`${head}: template "${key}" is not registered in the chat canvas`);
  const fields=new Set(spec.fields??[]),sections=new Set(spec.sections.map(s=>s.name));
  for(const field of parsed.fields.keys())assert.ok(fields.has(field),`${head}: header field "${field}" is not a field of ${key}`);
  assert.ok(parsed.sections.size>0,`${head}: canvas fence has no sections`);
  for(const section of parsed.sections.keys())assert.ok(sections.has(section),`${head}: section "${section}" is not a section of ${key}`);
 }
 for(const fence of block.matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)){
  mermaidFences++;
  const resolved=resolveDiagramType(fence[1]!);
  assert.ok(resolved.inWhitelist,`${head}: mermaid type "${resolved.rawToken}" is outside the chat render whitelist`);
 }
}
assert.ok(canvasFences>=10&&mermaidFences>=5,`expected canvas and mermaid templates, got ${canvasFences} canvas / ${mermaidFences} mermaid`);
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
assert.throws(()=>verifySkillStarterPack(changed,{packId:'standard-methods',packVersion:'1.5.0'}));
console.log(`PASS: real FileSkillStarterPackSource reads shipped 1.5.0 and superseded 1.4.0; four skills verified per-file against the editing sources; 1.5.0 only bumps design-methods to 1.1.0 (WX-S023, ${indexIds.size} indexed methods, each with exactly one card, no dangling cross-references, no book attribution or trademarked framework names; ${templateBlocks.length} executable templates — ${canvasFences} canvas fences matched against the real chat template registry, ${mermaidFences} mermaid fences inside the render whitelist) and leaves the three shipped skills byte-identical; missing deployment root/version fail closed; tampering rejected.`);

}
main().catch(error=>{console.error(error);process.exitCode=1;});
