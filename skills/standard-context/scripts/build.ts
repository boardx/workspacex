import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha256,verifySkillStarterPack} from '../../../apps/api/src/domain/skill/starter-pack';
const root=resolve(import.meta.dirname,'..');
const entries=[['knowledge-grounded-answer','WX-S001','组织知识问答'],['meeting-preparation','WX-S008','会议准备'],['internal-communications','WX-S011','组织沟通文稿'],['project-status-report','WX-S014','项目进展报告']] as const;
const skills=entries.map(([stableName,capabilityId,name])=>({stableName,name,semanticVersion:'1.0.0',manifest:{capabilityId},files:['SKILL.md','references/template.md','references/upstream.md','LICENSE.txt'].map(path=>{
 const bytes=readFileSync(resolve(root,stableName,path));return {path,mediaType:path==='LICENSE.txt'?'text/plain':'text/markdown',digest:sha256(bytes),contentBase64:bytes.toString('base64')};})}));
const unsigned={schemaVersion:1,packId:'standard-context',packVersion:'1.0.0',skills};const pack={...unsigned,packDigest:sha256(JSON.stringify(unsigned))};verifySkillStarterPack(pack,{packId:'standard-context',packVersion:'1.0.0'});
writeFileSync(resolve(root,'../starter-packs/standard-context/1.0.0.json'),JSON.stringify(pack,null,2)+'\n');
