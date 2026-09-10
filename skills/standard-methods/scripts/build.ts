import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
// 版本号跟着 skill 走，不再用 stableName 的三元链推：加第四个 skill 时那条链会越来越长，
// 而且「忘了加分支 ⇒ 静默发成 1.0.0」是不会红的错。SKILL.md frontmatter 的 version 必须
// 与这里逐字相等，由 .harness/scripts/lint-skill-metadata-source.mjs 机械看住。
const skills=[['interview-synthesis','访谈与反馈综合','WX-S010','evidence-ledger.md','1.0.0'],['user-research-planning','用户研究规划','WX-S019','planning-template.md','1.0.1'],['maau-canvas','MAAU 模板','WX-S021','canvas-template.md','3.0.0']].map(([stableName,name,id,reference,semanticVersion])=>({
 stableName,name,semanticVersion,manifest:{capabilityId:id},files:['SKILL.md',`references/${reference}`].map(path=>{
 const bytes=readFileSync(resolve(root,stableName!,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};
 })
}));
const unsigned={schemaVersion:1,packId:'standard-methods',packVersion:'1.3.0',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};
verifySkillStarterPack(pack,{packId:'standard-methods',packVersion:'1.3.0'});
writeFileSync(resolve(root,'../starter-packs/standard-methods/1.3.0.json'),JSON.stringify(pack,null,2)+'\n');
