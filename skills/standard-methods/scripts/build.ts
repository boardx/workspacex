import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, verifySkillStarterPack } from '../../../apps/api/src/domain/skill/starter-pack';
import { parseSkillFrontmatter } from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'..');
// 版本号跟着 skill 走，而且只写在 SKILL.md frontmatter 里（issue #3154）：这里曾经手抄一遍
// semanticVersion / capabilityId，「两处写、没人比对」正是本仓「同一事实不得声明在两处」点名的形态。
// 这张表现在只留构建侧独有的事实——显示名与参考文件名。
const entries=[['interview-synthesis','访谈与反馈综合','evidence-ledger.md'],['user-research-planning','用户研究规划','planning-template.md'],['maau-canvas','MAAU 模板','canvas-template.md']] as const;
const skills=entries.map(([directory,name,reference])=>{
 const meta=parseSkillFrontmatter(readFileSync(resolve(root,directory,'SKILL.md'),'utf8'),directory);
 return {stableName:meta.stableName,name,semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId},files:['SKILL.md',`references/${reference}`].map(path=>{
 const bytes=readFileSync(resolve(root,directory,path));return {path,mediaType:'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};
 })};
});
const unsigned={schemaVersion:1,packId:'standard-methods',packVersion:'1.3.0',skills};
const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};
verifySkillStarterPack(pack,{packId:'standard-methods',packVersion:'1.3.0'});
writeFileSync(resolve(root,'../starter-packs/standard-methods/1.3.0.json'),JSON.stringify(pack,null,2)+'\n');
