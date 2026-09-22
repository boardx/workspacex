import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
import {parseSkillFrontmatter} from '../../../apps/api/src/domain/skill/skill-frontmatter';
const root=resolve(import.meta.dirname,'..');
// 只留构建侧独有的显示名；stable_name / version / capability_id 从 SKILL.md frontmatter 读（issue #3154）。
const entries=[['knowledge-grounded-answer','组织知识问答'],['meeting-preparation','会议准备'],['internal-communications','组织沟通文稿'],['project-status-report','项目进展报告']] as const;
const skills=entries.map(([directory,name])=>{
 const meta=parseSkillFrontmatter(readFileSync(resolve(root,directory,'SKILL.md'),'utf8'),directory);
 return {stableName:meta.stableName,name,semanticVersion:meta.semanticVersion,manifest:{capabilityId:meta.capabilityId},files:['SKILL.md','references/template.md','references/upstream.md','references/retrieval-scope.md','LICENSE.txt'].map(path=>{
 const bytes=readFileSync(path==='references/retrieval-scope.md'?resolve(root,path):resolve(root,directory,path));return {path,mediaType:path==='LICENSE.txt'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};})};
});
const unsigned={schemaVersion:1,packId:'standard-context',packVersion:'1.1.1',skills};const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-context',packVersion:'1.1.1'});
writeFileSync(resolve(root,'../starter-packs/standard-context/1.1.1.json'),JSON.stringify(pack,null,2)+'\n');
